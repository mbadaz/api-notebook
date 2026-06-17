import fs from 'node:fs';
import path from 'node:path';
import {
  convertCollection,
  convertEnvironment,
  detectPostmanKind,
  hasScripts,
  type ConvertedFolder,
} from './postmanImport.js';
import type { Scripts, WorkspaceMeta } from './types.js';
import * as wsfs from './workspaceFs.js';
import { expandHome, HttpError } from './workspaceFs.js';

export type PostmanImportSummary =
  | { kind: 'collection'; collections: number; folders: number; requests: number }
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
    const converted = convertCollection(json as never);
    const collection = wsfs.createCollection(ws, converted.name);
    if (converted.description || hasScripts(converted.scripts)) {
      wsfs.updateCollection(ws, collection.id, {
        description: converted.description || undefined,
        scripts: hasScripts(converted.scripts) ? converted.scripts : undefined,
      });
    }

    const counts = { folders: 0, requests: 0 };

    const writeRequests = (
      folderPath: string[],
      requests: ReturnType<typeof convertCollection>['requests']
    ) => {
      for (const request of requests) {
        const created = wsfs.createRequest(
          ws,
          collection.id,
          folderPath,
          request.name,
          request.type
        );
        wsfs.updateRequest(ws, collection.id, folderPath, created.id, {
          ...request,
          id: created.id,
        });
        counts.requests += 1;
      }
    };

    const writeFolders = (parentPath: string[], folders: ConvertedFolder[]) => {
      for (const folder of folders) {
        const created = wsfs.createFolder(
          ws,
          collection.id,
          parentPath,
          folder.name
        );
        counts.folders += 1;
        const folderPath = [...parentPath, created.id];
        const scripts: Scripts | undefined = hasScripts(folder.scripts)
          ? folder.scripts
          : undefined;
        if (folder.description || scripts) {
          wsfs.updateFolder(ws, collection.id, folderPath, {
            description: folder.description || undefined,
            scripts,
          });
        }
        writeRequests(folderPath, folder.requests);
        writeFolders(folderPath, folder.folders);
      }
    };

    writeRequests([], converted.requests);
    writeFolders([], converted.folders);
    return {
      kind,
      collections: 1,
      folders: counts.folders,
      requests: counts.requests,
    };
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
