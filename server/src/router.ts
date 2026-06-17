import { Router, type Request, type Response } from 'express';
import * as appData from './appData.js';
import * as cookies from './cookies.js';
import { applyEnvChanges, runRequest } from './execute.js';
import { pickFile, pickFolder } from './pickFolder.js';
import { importPostmanDir, importPostmanFile } from './importer.js';
import * as wsfs from './workspaceFs.js';
import { HttpError } from './workspaceFs.js';
import type { ApiRequest, WorkspaceMeta } from './types.js';

type Handler = (req: Request, res: Response) => void | Promise<void>;

const wrap =
  (fn: Handler) => (req: Request, res: Response, next: (e: unknown) => void) =>
    Promise.resolve(fn(req, res)).catch(next);

function getWorkspace(id: string): WorkspaceMeta {
  const entry = appData.findWorkspaceEntry(id);
  if (!entry) throw new HttpError(404, `Workspace "${id}" is not registered`);
  return wsfs.openWorkspace(entry.path);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `"${field}" is required`);
  }
  return value.trim();
}

/** A folder path is a slash-joined string of folder slugs ("" means root). */
function parseFolderPath(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  return value.split('/').filter(Boolean);
}

export const router = Router();

router.post(
  '/pick-folder',
  wrap(async (req, res) => {
    const title =
      typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title
        : 'Choose a folder';
    res.json({ path: await pickFolder(title) });
  })
);

router.post(
  '/pick-file',
  wrap(async (req, res) => {
    const title =
      typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title
        : 'Choose a file';
    res.json({ path: await pickFile(title) });
  })
);

router.get(
  '/workspaces',
  wrap((_req, res) => {
    const workspaces: WorkspaceMeta[] = [];
    for (const entry of appData.listWorkspaceEntries()) {
      try {
        workspaces.push(wsfs.openWorkspace(entry.path));
      } catch {
        console.warn(`Skipping unreadable workspace at ${entry.path}`);
      }
    }
    res.json(workspaces);
  })
);

router.post(
  '/workspaces',
  wrap((req, res) => {
    const name = requireString(req.body.name, 'name');
    const dirPath = requireString(req.body.path, 'path');
    const meta = wsfs.createWorkspace(name, dirPath);
    appData.addWorkspaceEntry({ id: meta.id, path: meta.path });
    res.status(201).json(meta);
  })
);

router.post(
  '/workspaces/open',
  wrap((req, res) => {
    const dirPath = requireString(req.body.path, 'path');
    const meta = wsfs.openWorkspace(dirPath);
    appData.addWorkspaceEntry({ id: meta.id, path: meta.path });
    res.json(meta);
  })
);

router.get(
  '/workspaces/:id',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    res.json(wsfs.readTree(ws, appData.getActiveEnvironmentId(ws.id)));
  })
);

router.delete(
  '/workspaces/:id',
  wrap((req, res) => {
    appData.removeWorkspaceEntry(req.params.id);
    res.status(204).end();
  })
);

router.put(
  '/workspaces/:id/active-environment',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const envId: string | null = req.body.environmentId ?? null;
    if (envId !== null && !wsfs.getEnvironment(ws, envId)) {
      throw new HttpError(404, `Environment "${envId}" not found`);
    }
    appData.setActiveEnvironmentId(ws.id, envId);
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/collections',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const name = requireString(req.body.name, 'name');
    res.status(201).json(wsfs.createCollection(ws, name));
  })
);

router.patch(
  '/workspaces/:id/collections/:cid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.updateCollection(ws, req.params.cid, {
      name: req.body.name,
      description: req.body.description,
      scripts: req.body.scripts,
    });
    res.status(204).end();
  })
);

router.delete(
  '/workspaces/:id/collections/:cid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.deleteCollection(ws, req.params.cid);
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/collections/:cid/folders',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const name = requireString(req.body.name, 'name');
    const parentPath = parseFolderPath(req.body.folderPath);
    res.status(201).json(wsfs.createFolder(ws, req.params.cid, parentPath, name));
  })
);

router.patch(
  '/workspaces/:id/collections/:cid/folders',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.updateFolder(ws, req.params.cid, parseFolderPath(req.query.folderPath), {
      name: req.body.name,
      description: req.body.description,
      scripts: req.body.scripts,
    });
    res.status(204).end();
  })
);

router.delete(
  '/workspaces/:id/collections/:cid/folders',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.deleteFolder(ws, req.params.cid, parseFolderPath(req.query.folderPath));
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/collections/:cid/requests',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const name = requireString(req.body.name, 'name');
    const allowed = ['http', 'graphql', 'websocket', 'socketio'] as const;
    const type = allowed.includes(req.body.type) ? req.body.type : 'http';
    const folderPath = parseFolderPath(req.body.folderPath);
    res
      .status(201)
      .json(wsfs.createRequest(ws, req.params.cid, folderPath, name, type));
  })
);

router.put(
  '/workspaces/:id/collections/:cid/requests/:rid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.updateRequest(
      ws,
      req.params.cid,
      parseFolderPath(req.query.folderPath),
      req.params.rid,
      req.body as ApiRequest
    );
    res.status(204).end();
  })
);

router.delete(
  '/workspaces/:id/collections/:cid/requests/:rid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.deleteRequest(
      ws,
      req.params.cid,
      parseFolderPath(req.query.folderPath),
      req.params.rid
    );
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/environments',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const name = requireString(req.body.name, 'name');
    res.status(201).json(wsfs.createEnvironment(ws, name));
  })
);

router.put(
  '/workspaces/:id/environments/:eid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.updateEnvironment(ws, req.params.eid, {
      name: requireString(req.body.name, 'name'),
      variables: req.body.variables ?? [],
    });
    res.status(204).end();
  })
);

router.delete(
  '/workspaces/:id/environments/:eid',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    wsfs.deleteEnvironment(ws, req.params.eid);
    if (appData.getActiveEnvironmentId(ws.id) === req.params.eid) {
      appData.setActiveEnvironmentId(ws.id, null);
    }
    res.status(204).end();
  })
);

router.post(
  '/workspaces/:id/move',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    const from = req.body.from ?? {};
    const to = req.body.to ?? {};
    const dest = {
      collectionId: requireString(to.collectionId, 'to.collectionId'),
      folderPath: parseFolderPath(to.folderPath),
    };
    if (req.body.kind === 'folder') {
      res.json(
        wsfs.moveFolder(
          ws,
          {
            collectionId: requireString(from.collectionId, 'from.collectionId'),
            folderPath: parseFolderPath(from.folderPath),
          },
          dest
        )
      );
    } else {
      res.json(
        wsfs.moveRequest(
          ws,
          {
            collectionId: requireString(from.collectionId, 'from.collectionId'),
            folderPath: parseFolderPath(from.folderPath),
            requestId: requireString(from.requestId, 'from.requestId'),
          },
          dest
        )
      );
    }
  })
);

router.post(
  '/workspaces/:id/import/postman',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    res.json(importPostmanFile(ws, requireString(req.body.path, 'path')));
  })
);

router.post(
  '/workspaces/:id/import/postman-dir',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    res.json(importPostmanDir(ws, requireString(req.body.path, 'path')));
  })
);

router.post(
  '/workspaces/:id/execute',
  wrap(async (req, res) => {
    const ws = getWorkspace(req.params.id);
    const request = req.body.request as ApiRequest;
    if (!request || typeof request.url !== 'string') {
      throw new HttpError(400, '"request" is required');
    }
    const collectionId =
      typeof req.body.collectionId === 'string' ? req.body.collectionId : null;
    const folderPath = parseFolderPath(req.body.folderPath);
    const collectionScripts = collectionId
      ? wsfs.getScriptChain(ws, collectionId, folderPath)
      : { preRequest: '', postResponse: '' };

    const activeId = appData.getActiveEnvironmentId(ws.id);
    const env = activeId ? wsfs.getEnvironment(ws, activeId) : undefined;

    const jar = cookies.loadJar(ws.id);
    const outcome = await runRequest(request, collectionScripts, env, jar);
    cookies.saveJar(ws.id, jar);

    // Persist any environment variables the scripts set (secret-aware).
    if (env && outcome.changedEnvKeys.length > 0) {
      wsfs.updateEnvironment(ws, env.id, {
        name: env.name,
        variables: applyEnvChanges(env, outcome.envVars, outcome.changedEnvKeys),
      });
    }

    // Keep the request's recent-response history (no-ops for unsaved requests).
    if (collectionId && typeof request.id === 'string') {
      wsfs.saveResponse(ws, collectionId, folderPath, request.id, outcome.result);
    }

    res.json(outcome.result);
  })
);

router.get(
  '/workspaces/:id/collections/:cid/requests/:rid/responses',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    res.json(
      wsfs.getResponses(
        ws,
        req.params.cid,
        parseFolderPath(req.query.folderPath),
        req.params.rid
      )
    );
  })
);

router.get(
  '/workspaces/:id/cookies',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    res.json(cookies.listCookies(ws.id));
  })
);

router.post(
  '/workspaces/:id/cookies/delete',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    cookies.removeCookie(ws.id, {
      domain: requireString(req.body.domain, 'domain'),
      path: requireString(req.body.path, 'path'),
      key: requireString(req.body.key, 'key'),
    });
    res.status(204).end();
  })
);

router.delete(
  '/workspaces/:id/cookies',
  wrap((req, res) => {
    const ws = getWorkspace(req.params.id);
    cookies.clearCookies(ws.id);
    res.status(204).end();
  })
);
