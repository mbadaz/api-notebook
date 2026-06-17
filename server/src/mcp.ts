import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import * as appData from './appData.js';
import * as cookies from './cookies.js';
import { applyEnvChanges, runRequest } from './execute.js';
import { importPostmanDir, importPostmanFile } from './importer.js';
import type { ApiRequest, WorkspaceMeta } from './types.js';
import * as wsfs from './workspaceFs.js';

/**
 * Model Context Protocol server exposing the workspace over a Streamable-HTTP
 * endpoint, so AI agents can query, build, run, and manage requests. It is a
 * thin tool layer over the existing workspace/execution modules; all tools take
 * a `workspaceId` (use list_workspaces to discover them).
 */

const MAX_BODY_CHARS = 50_000;

function resolveWorkspace(workspaceId: string): WorkspaceMeta {
  const entry = appData.findWorkspaceEntry(workspaceId);
  if (!entry) throw new Error(`Workspace "${workspaceId}" is not registered`);
  return wsfs.openWorkspace(entry.path);
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/**
 * Guardrail for destructive tools: returns a confirmation prompt instead of
 * acting. The caller must surface this to the user and only re-invoke the tool
 * with `confirm: true` once the user agrees. `retry` echoes the exact arguments
 * to repeat (plus confirm: true).
 */
function needsConfirmation(message: string, retry: Record<string, unknown>) {
  return {
    confirmationRequired: true,
    message,
    retryWith: { ...retry, confirm: true },
  };
}

// Reusable zod pieces mirroring the request model.
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const keyValue = z.object({
  key: z.string(),
  value: z.string().default(''),
  enabled: z.boolean().default(true),
  secret: z.boolean().optional(),
});
const scripts = z.object({ preRequest: z.string(), postResponse: z.string() });
const body = z.object({
  mode: z.enum(['none', 'json', 'text', 'form', 'formData', 'binary']),
  content: z.string().default(''),
  form: z.array(keyValue).default([]),
  formData: z
    .array(
      z.object({
        key: z.string(),
        value: z.string().default(''),
        type: z.enum(['text', 'file']),
        enabled: z.boolean().default(true),
      })
    )
    .default([]),
  binaryPath: z.string().default(''),
});
const auth = z.object({
  type: z.enum(['none', 'bearer', 'basic', 'apiKey']),
  bearer: z.object({ token: z.string() }).optional(),
  basic: z.object({ username: z.string(), password: z.string() }).optional(),
  apiKey: z
    .object({
      key: z.string(),
      value: z.string(),
      placement: z.enum(['header', 'query']),
    })
    .optional(),
});
const graphql = z.object({ query: z.string(), variables: z.string() });
/** A request/folder's location inside a collection: folder slugs, outer→inner. */
const folderPath = z.array(z.string()).default([]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any;

interface NodeSummary {
  id?: string;
  name?: string;
  folders: NodeSummary[];
  requests: { id: string; name: string; type: string; method: string; url: string }[];
}

/** Compact, recursive view of a collection/folder's requests and subfolders. */
function summarizeNode(node: {
  folders: import('./types.js').Folder[];
  requests: ApiRequest[];
}): NodeSummary {
  return {
    requests: node.requests.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      method: r.method,
      url: r.url,
    })),
    folders: node.folders.map((f) => ({
      id: f.id,
      name: f.name,
      ...summarizeNode(f),
    })),
  };
}

function countRequests(node: {
  folders: import('./types.js').Folder[];
  requests: ApiRequest[];
}): number {
  return (
    node.requests.length +
    node.folders.reduce((sum, f) => sum + countRequests(f), 0)
  );
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'api-notebook', version: '0.1.0' });

  const reg = (
    name: string,
    config: { description: string; inputSchema?: z.ZodRawShape; annotations?: unknown },
    handler: (args: Args) => unknown | Promise<unknown>
  ): void => {
    // Casts bridge our loose handler signature to the SDK's inferred generics.
    server.registerTool(name, config as never, (async (args: Args) => {
      try {
        return ok(await handler(args ?? {}));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }) as never);
  };

  const readonly = { readOnlyHint: true };
  const destructive = { destructiveHint: true };

  // ---- query ----

  reg(
    'list_workspaces',
    { description: 'List all registered workspaces (id, name, path).', annotations: readonly },
    () =>
      appData
        .listWorkspaceEntries()
        .map((e) => {
          try {
            return wsfs.openWorkspace(e.path);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
  );

  reg(
    'get_workspace_tree',
    {
      description:
        'Get a workspace overview: its collections (with request summaries) and environments.',
      inputSchema: { workspaceId: z.string() },
      annotations: readonly,
    },
    ({ workspaceId }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      const activeId = appData.getActiveEnvironmentId(ws.id);
      const tree = wsfs.readTree(ws, activeId);
      return {
        workspace: tree.meta,
        activeEnvironmentId: tree.activeEnvironmentId,
        collections: tree.collections.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          ...summarizeNode(c),
        })),
        environments: tree.environments.map((e) => ({
          id: e.id,
          name: e.name,
          active: e.id === tree.activeEnvironmentId,
          variableCount: e.variables.length,
        })),
      };
    }
  );

  reg(
    'get_request',
    {
      description:
        'Get a request in full (method, url, params, headers, auth, body, scripts, docs). Pass folderPath (folder slugs from the tree) when the request lives inside a folder.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        requestId: z.string(),
      },
      annotations: readonly,
    },
    ({ workspaceId, collectionId, folderPath: fp, requestId }: Args) =>
      wsfs.getRequest(resolveWorkspace(workspaceId), collectionId, fp ?? [], requestId)
  );

  reg(
    'get_collection',
    {
      description: 'Get a collection: name, description, collection-level scripts, and its requests.',
      inputSchema: { workspaceId: z.string(), collectionId: z.string() },
      annotations: readonly,
    },
    ({ workspaceId, collectionId }: Args) => {
      const c = wsfs.getCollection(resolveWorkspace(workspaceId), collectionId);
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        scripts: c.scripts,
        ...summarizeNode(c),
      };
    }
  );

  reg(
    'get_environment',
    {
      description:
        'Get an environment with its variables (secret values are included from the local file).',
      inputSchema: { workspaceId: z.string(), environmentId: z.string() },
      annotations: readonly,
    },
    ({ workspaceId, environmentId }: Args) => {
      const env = wsfs.getEnvironment(resolveWorkspace(workspaceId), environmentId);
      if (!env) throw new Error(`Environment "${environmentId}" not found`);
      return env;
    }
  );

  reg(
    'list_cookies',
    {
      description: "List the workspace's stored cookies (jar) by domain.",
      inputSchema: { workspaceId: z.string() },
      annotations: readonly,
    },
    ({ workspaceId }: Args) => cookies.listCookies(resolveWorkspace(workspaceId).id)
  );

  // ---- create / edit ----

  reg(
    'create_collection',
    {
      description: 'Create a new collection in the workspace.',
      inputSchema: { workspaceId: z.string(), name: z.string() },
    },
    ({ workspaceId, name }: Args) =>
      wsfs.createCollection(resolveWorkspace(workspaceId), name)
  );

  reg(
    'update_collection',
    {
      description: "Update a collection's name, description, or collection-level scripts.",
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        scripts: scripts.optional(),
      },
    },
    ({ workspaceId, collectionId, name, description, scripts: s }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      wsfs.updateCollection(ws, collectionId, { name, description, scripts: s });
      return wsfs.getCollection(ws, collectionId);
    }
  );

  reg(
    'create_folder',
    {
      description:
        'Create a folder inside a collection (pass folderPath to nest it inside an existing folder; omit or [] for the collection root). Returns the created folder.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        name: z.string(),
      },
    },
    ({ workspaceId, collectionId, folderPath: fp, name }: Args) =>
      wsfs.createFolder(resolveWorkspace(workspaceId), collectionId, fp ?? [], name)
  );

  reg(
    'update_folder',
    {
      description:
        "Update a folder's name, description, or folder-level scripts (which run around every request inside it).",
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        name: z.string().optional(),
        description: z.string().optional(),
        scripts: scripts.optional(),
      },
    },
    ({ workspaceId, collectionId, folderPath: fp, name, description, scripts: s }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      wsfs.updateFolder(ws, collectionId, fp ?? [], { name, description, scripts: s });
      return wsfs.getCollection(ws, collectionId);
    }
  );

  reg(
    'create_request',
    {
      description:
        'Create a new request in a collection (optionally inside a folder via folderPath). Returns the created request.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        name: z.string(),
        type: z.enum(['http', 'graphql']).default('http'),
      },
    },
    ({ workspaceId, collectionId, folderPath: fp, name, type }: Args) =>
      wsfs.createRequest(resolveWorkspace(workspaceId), collectionId, fp ?? [], name, type)
  );

  reg(
    'update_request',
    {
      description:
        'Update fields of an existing request. Only provided fields change; nested objects (auth, body, graphql) are replaced wholesale. Use {{variable}} for environment interpolation.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        requestId: z.string(),
        name: z.string().optional(),
        method: z.enum(METHODS).optional(),
        url: z.string().optional(),
        params: z.array(keyValue).optional(),
        headers: z.array(keyValue).optional(),
        auth: auth.optional(),
        body: body.optional(),
        graphql: graphql.optional(),
        docs: z.string().optional(),
        scripts: scripts.optional(),
      },
    },
    (a: Args) => {
      const ws = resolveWorkspace(a.workspaceId);
      const fp = a.folderPath ?? [];
      const existing = wsfs.getRequest(ws, a.collectionId, fp, a.requestId);
      const merged: ApiRequest = {
        ...existing,
        ...(a.name !== undefined && { name: a.name }),
        ...(a.method !== undefined && { method: a.method }),
        ...(a.url !== undefined && { url: a.url }),
        ...(a.params !== undefined && { params: a.params }),
        ...(a.headers !== undefined && { headers: a.headers }),
        ...(a.auth !== undefined && { auth: a.auth }),
        ...(a.body !== undefined && { body: a.body }),
        ...(a.graphql !== undefined && { graphql: a.graphql }),
        ...(a.docs !== undefined && { docs: a.docs }),
        ...(a.scripts !== undefined && { scripts: a.scripts }),
      };
      wsfs.updateRequest(ws, a.collectionId, fp, a.requestId, merged);
      return wsfs.getRequest(ws, a.collectionId, fp, a.requestId);
    }
  );

  reg(
    'move_request',
    {
      description:
        'Move a request into another folder or collection. folderPath/toFolderPath are folder slugs (omit or [] for a collection root); toCollectionId defaults to the source collection. Returns the new location (the id may change if it collided).',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        requestId: z.string(),
        toCollectionId: z.string().optional(),
        toFolderPath: z.array(z.string()).default([]),
      },
    },
    (a: Args) => {
      const ws = resolveWorkspace(a.workspaceId);
      return wsfs.moveRequest(
        ws,
        { collectionId: a.collectionId, folderPath: a.folderPath ?? [], requestId: a.requestId },
        { collectionId: a.toCollectionId ?? a.collectionId, folderPath: a.toFolderPath ?? [] }
      );
    }
  );

  reg(
    'move_folder',
    {
      description:
        'Move a folder (with everything inside it) under a new parent folder or collection. Cannot move a folder into itself or its own subfolder. Returns the new folder path.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        toCollectionId: z.string().optional(),
        toFolderPath: z.array(z.string()).default([]),
      },
    },
    (a: Args) => {
      const ws = resolveWorkspace(a.workspaceId);
      return wsfs.moveFolder(
        ws,
        { collectionId: a.collectionId, folderPath: a.folderPath ?? [] },
        { collectionId: a.toCollectionId ?? a.collectionId, folderPath: a.toFolderPath ?? [] }
      );
    }
  );

  // ---- execute ----

  reg(
    'execute_request',
    {
      description:
        'Send a saved request through the local proxy — with variable interpolation, pre-request/test scripts, and the cookie jar — and return the response (status, headers, body, script results).',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        requestId: z.string(),
      },
    },
    async ({ workspaceId, collectionId, folderPath: fp, requestId }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      const path = fp ?? [];
      const request = wsfs.getRequest(ws, collectionId, path, requestId);
      const collectionScripts = wsfs.getScriptChain(ws, collectionId, path);
      const activeId = appData.getActiveEnvironmentId(ws.id);
      const env = activeId ? wsfs.getEnvironment(ws, activeId) : undefined;
      const jar = cookies.loadJar(ws.id);
      const outcome = await runRequest(request, collectionScripts, env, jar);
      cookies.saveJar(ws.id, jar);
      if (env && outcome.changedEnvKeys.length > 0) {
        wsfs.updateEnvironment(ws, env.id, {
          name: env.name,
          variables: applyEnvChanges(env, outcome.envVars, outcome.changedEnvKeys),
        });
      }
      wsfs.saveResponse(ws, collectionId, path, requestId, outcome.result);
      const r = outcome.result;
      const truncated = r.body.length > MAX_BODY_CHARS;
      return {
        status: r.status,
        statusText: r.statusText,
        timeMs: r.timeMs,
        sizeBytes: r.sizeBytes,
        bodyEncoding: r.bodyEncoding,
        resolvedUrl: r.resolvedUrl,
        headers: r.headers,
        body: truncated
          ? `${r.body.slice(0, MAX_BODY_CHARS)}\n…[truncated ${r.body.length - MAX_BODY_CHARS} chars]`
          : r.body,
        script: r.script,
      };
    }
  );

  // ---- environments ----

  reg(
    'create_environment',
    {
      description: 'Create a new environment in the workspace.',
      inputSchema: { workspaceId: z.string(), name: z.string() },
    },
    ({ workspaceId, name }: Args) =>
      wsfs.createEnvironment(resolveWorkspace(workspaceId), name)
  );

  reg(
    'update_environment',
    {
      description:
        "Replace an environment's name and variables. Mark a variable secret:true to keep its value in the gitignored local file.",
      inputSchema: {
        workspaceId: z.string(),
        environmentId: z.string(),
        name: z.string(),
        variables: z.array(keyValue),
      },
    },
    ({ workspaceId, environmentId, name, variables }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      wsfs.updateEnvironment(ws, environmentId, { name, variables });
      return wsfs.getEnvironment(ws, environmentId);
    }
  );

  reg(
    'set_active_environment',
    {
      description: 'Set (or clear, with null) the active environment used for request execution.',
      inputSchema: { workspaceId: z.string(), environmentId: z.string().nullable() },
    },
    ({ workspaceId, environmentId }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      if (environmentId !== null && !wsfs.getEnvironment(ws, environmentId)) {
        throw new Error(`Environment "${environmentId}" not found`);
      }
      appData.setActiveEnvironmentId(ws.id, environmentId);
      return { activeEnvironmentId: environmentId };
    }
  );

  reg(
    'set_variable',
    {
      description:
        'Set a single variable on the active environment (creates it if missing). Convenient for tokens captured during a flow.',
      inputSchema: { workspaceId: z.string(), name: z.string(), value: z.string() },
    },
    ({ workspaceId, name, value }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      const activeId = appData.getActiveEnvironmentId(ws.id);
      if (!activeId) throw new Error('This workspace has no active environment');
      const env = wsfs.getEnvironment(ws, activeId);
      if (!env) throw new Error('Active environment not found');
      const exists = env.variables.some((v) => v.key === name);
      const variables = exists
        ? env.variables.map((v) => (v.key === name ? { ...v, value, enabled: true } : v))
        : [...env.variables, { key: name, value, enabled: true }];
      wsfs.updateEnvironment(ws, activeId, { name: env.name, variables });
      return { environment: env.name, name, value };
    }
  );

  // ---- import ----

  reg(
    'import_postman',
    {
      description:
        'Import a Postman collection or environment export (Collection v2.1.0) from a file path on this machine into the workspace.',
      inputSchema: { workspaceId: z.string(), path: z.string() },
    },
    ({ workspaceId, path }: Args) =>
      importPostmanFile(resolveWorkspace(workspaceId), path)
  );

  reg(
    'import_postman_dir',
    {
      description:
        'Batch-import every Postman collection/environment export found under a folder on this machine (recursively). Unrecognised or unparseable JSON files are skipped. Returns aggregate counts.',
      inputSchema: { workspaceId: z.string(), path: z.string() },
    },
    ({ workspaceId, path }: Args) =>
      importPostmanDir(resolveWorkspace(workspaceId), path)
  );

  // ---- destructive ----

  reg(
    'delete_request',
    {
      description:
        'Delete a request from a collection. This cannot be undone. Two-step: call without confirm to get a summary of what will be deleted, then call again with confirm: true to actually delete.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        requestId: z.string(),
        confirm: z.boolean().default(false),
      },
      annotations: destructive,
    },
    ({ workspaceId, collectionId, folderPath: fp, requestId, confirm }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      const path = fp ?? [];
      const req = wsfs.getRequest(ws, collectionId, path, requestId);
      if (!confirm) {
        return needsConfirmation(
          `Delete request "${req.name}" (${req.method})? This cannot be undone.`,
          { tool: 'delete_request', workspaceId, collectionId, folderPath: path, requestId }
        );
      }
      wsfs.deleteRequest(ws, collectionId, path, requestId);
      return { deleted: requestId };
    }
  );

  reg(
    'delete_collection',
    {
      description:
        'Delete a collection and all its requests. This cannot be undone. Two-step: call without confirm to get a summary, then call again with confirm: true to actually delete.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        confirm: z.boolean().default(false),
      },
      annotations: destructive,
    },
    ({ workspaceId, collectionId, confirm }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      const col = wsfs.getCollection(ws, collectionId);
      if (!confirm) {
        return needsConfirmation(
          `Delete collection "${col.name}" and its ${countRequests(col)} request(s)? This cannot be undone.`,
          { tool: 'delete_collection', workspaceId, collectionId }
        );
      }
      wsfs.deleteCollection(ws, collectionId);
      return { deleted: collectionId };
    }
  );

  reg(
    'delete_folder',
    {
      description:
        'Delete a folder and everything inside it (subfolders and requests). This cannot be undone. Two-step: call without confirm to get a summary, then call again with confirm: true to actually delete.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        folderPath,
        confirm: z.boolean().default(false),
      },
      annotations: destructive,
    },
    ({ workspaceId, collectionId, folderPath: fp, confirm }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      const path = fp ?? [];
      if (path.length === 0) throw new Error('A folderPath is required');
      const col = wsfs.getCollection(ws, collectionId);
      let node: { folders: import('./types.js').Folder[] } = col;
      for (const slug of path) {
        const next = node.folders.find((f) => f.id === slug);
        if (!next) throw new Error(`Folder "${path.join('/')}" not found`);
        node = next;
      }
      if (!confirm) {
        return needsConfirmation(
          `Delete folder "${path.join('/')}" and its ${countRequests(node as never)} request(s)? This cannot be undone.`,
          { tool: 'delete_folder', workspaceId, collectionId, folderPath: path }
        );
      }
      wsfs.deleteFolder(ws, collectionId, path);
      return { deleted: path.join('/') };
    }
  );

  reg(
    'clear_cookies',
    {
      description:
        "Clear all stored cookies in the workspace's jar. Two-step: call without confirm to get the count, then call again with confirm: true to actually clear.",
      inputSchema: {
        workspaceId: z.string(),
        confirm: z.boolean().default(false),
      },
      annotations: destructive,
    },
    ({ workspaceId, confirm }: Args) => {
      const ws = resolveWorkspace(workspaceId);
      if (!confirm) {
        const count = cookies.listCookies(ws.id).length;
        return needsConfirmation(
          `Clear all ${count} stored cookie(s) for this workspace? This cannot be undone.`,
          { tool: 'clear_cookies', workspaceId }
        );
      }
      cookies.clearCookies(ws.id);
      return { cleared: true };
    }
  );

  return server;
}

/**
 * Mounts the MCP endpoint on the Express app. Stateless: a fresh server and
 * transport are created per request (no session state to track).
 */
export function registerMcp(app: Express): void {
  app.post('/mcp', async (req: Request, res: Response) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
