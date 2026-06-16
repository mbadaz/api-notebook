import fs from 'node:fs';
import path from 'node:path';
import {
  convertCollection,
  convertEnvironment,
  detectPostmanKind,
  hasScripts,
} from './postmanImport.js';
import type { WorkspaceMeta } from './types.js';
import * as wsfs from './workspaceFs.js';
import { expandHome, HttpError } from './workspaceFs.js';

export type PostmanImportSummary =
  | { kind: 'collection'; collections: number; requests: number }
  | { kind: 'environment'; name: string; variables: number };

/**
 * Reads a Postman collection/environment export from disk and imports it into
 * the workspace. Shared by the REST endpoint and the MCP server.
 */
export function importPostmanFile(
  ws: WorkspaceMeta,
  filePath: string
): PostmanImportSummary {
  const resolved = path.resolve(expandHome(filePath));
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    throw new HttpError(400, 'Could not read the file or parse it as JSON');
  }

  const kind = detectPostmanKind(json);
  if (kind === 'collection') {
    const { groups } = convertCollection(json as never);
    let requests = 0;
    for (const group of groups) {
      const collection = wsfs.createCollection(ws, group.name);
      if (group.description || hasScripts(group.scripts)) {
        wsfs.updateCollection(ws, collection.id, {
          description: group.description,
          scripts: hasScripts(group.scripts) ? group.scripts : undefined,
        });
      }
      for (const request of group.requests) {
        const created = wsfs.createRequest(
          ws,
          collection.id,
          request.name,
          request.type
        );
        wsfs.updateRequest(ws, collection.id, created.id, {
          ...request,
          id: created.id,
        });
        requests += 1;
      }
    }
    return { kind, collections: groups.length, requests };
  }

  if (kind === 'environment') {
    const { name, variables } = convertEnvironment(json as never);
    const env = wsfs.createEnvironment(ws, name);
    wsfs.updateEnvironment(ws, env.id, { name, variables });
    return { kind, name, variables: variables.length };
  }

  throw new HttpError(
    400,
    'This file is not a recognised Postman collection or environment export'
  );
}
