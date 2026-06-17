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

export interface BatchImportSummary {
  kind: 'batch';
  /** JSON files found and considered. */
  files: number;
  collections: number;
  folders: number;
  requests: number;
  environments: number;
  variables: number;
  /** Files that were not a recognised export (or failed to parse). */
  skipped: number;
}

interface CollectionCounts {
  collections: number;
  folders: number;
  requests: number;
}

/** Imports an already-parsed Postman collection into the workspace. */
function importCollection(ws: WorkspaceMeta, json: unknown): CollectionCounts {
  const converted = convertCollection(json as never);
  const collection = wsfs.createCollection(ws, converted.name);
  if (converted.description || hasScripts(converted.scripts)) {
    wsfs.updateCollection(ws, collection.id, {
      description: converted.description || undefined,
      scripts: hasScripts(converted.scripts) ? converted.scripts : undefined,
    });
  }

  const counts = { collections: 1, folders: 0, requests: 0 };

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
      const created = wsfs.createFolder(ws, collection.id, parentPath, folder.name);
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
  return counts;
}

/** Imports an already-parsed Postman environment into the workspace. */
function importEnvironment(
  ws: WorkspaceMeta,
  json: unknown
): { name: string; variables: number } {
  const { name, variables } = convertEnvironment(json as never);
  const env = wsfs.createEnvironment(ws, name);
  wsfs.updateEnvironment(ws, env.id, { name, variables });
  return { name, variables: variables.length };
}

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
    const { collections, folders, requests } = importCollection(ws, json);
    return { kind, collections, folders, requests };
  }
  if (kind === 'environment') {
    const { name, variables } = importEnvironment(ws, json);
    return { kind, name, variables };
  }

  throw new HttpError(
    400,
    'This file is not a recognised Postman collection or environment export'
  );
}

/** Recursively lists every .json file under a directory, sorted for stability. */
function findJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJsonFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * Imports every Postman collection/environment export found under a directory
 * (recursively). Files that are not recognised exports — or fail to parse — are
 * skipped rather than aborting the batch. Returns aggregate counts.
 */
export function importPostmanDir(
  ws: WorkspaceMeta,
  dirPath: string
): BatchImportSummary {
  const resolved = path.resolve(expandHome(dirPath));
  let files: string[];
  try {
    files = findJsonFiles(resolved);
  } catch {
    throw new HttpError(400, `Could not read the folder "${dirPath}"`);
  }

  const summary: BatchImportSummary = {
    kind: 'batch',
    files: files.length,
    collections: 0,
    folders: 0,
    requests: 0,
    environments: 0,
    variables: 0,
    skipped: 0,
  };

  for (const file of files) {
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      summary.skipped += 1;
      continue;
    }
    const kind = detectPostmanKind(json);
    if (kind === 'collection') {
      const counts = importCollection(ws, json);
      summary.collections += counts.collections;
      summary.folders += counts.folders;
      summary.requests += counts.requests;
    } else if (kind === 'environment') {
      const { variables } = importEnvironment(ws, json);
      summary.environments += 1;
      summary.variables += variables;
    } else {
      summary.skipped += 1;
    }
  }

  return summary;
}
