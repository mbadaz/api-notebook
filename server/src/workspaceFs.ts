import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ApiRequest,
  Collection,
  Environment,
  ExecutionResult,
  Folder,
  RequestType,
  Scripts,
  WorkspaceMeta,
  WorkspaceTree,
} from './types.js';

const WORKSPACE_FILE = 'workspace.json';
const FOLDER_FILE = 'folder.json';
const COLLECTION_FILE = 'collection.json';
/**
 * Pre-folders workspaces stored a collection's requests in a `requests/`
 * subdirectory. We still read that layout, but never write to it.
 */
const LEGACY_REQUESTS_DIR = 'requests';
/** Suffix for the persisted response-history file kept beside each request. */
const RESPONSE_SUFFIX = '.response.json';
/** How many recent responses to keep per request (newest first). */
const RESPONSE_HISTORY = 3;
const emptyScripts = (): Scripts => ({ preRequest: '', postResponse: '' });
const LOCAL_ENV_IGNORE = 'environments/*.local.json';
/** Saved responses are a local cache (may hold tokens/PII) — never committed. */
const RESPONSE_IGNORE = '*.response.json';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/')
    ? path.join(os.homedir(), p.slice(1))
    : p;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function collectionsDir(ws: WorkspaceMeta): string {
  return path.join(ws.path, 'collections');
}

function environmentsDir(ws: WorkspaceMeta): string {
  return path.join(ws.path, 'environments');
}

function collectionDir(ws: WorkspaceMeta, collectionId: string): string {
  const dir = path.join(collectionsDir(ws), collectionId);
  if (!fs.existsSync(path.join(dir, COLLECTION_FILE))) {
    throw new HttpError(404, `Collection "${collectionId}" not found`);
  }
  return dir;
}

/**
 * Resolves the on-disk directory for a node (a collection root when folderPath
 * is empty, or a nested folder), validating that each folder in the path exists.
 */
function nodeDir(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[]
): string {
  let dir = collectionDir(ws, collectionId);
  for (const slug of folderPath) {
    dir = path.join(dir, slug);
    if (!fs.existsSync(path.join(dir, FOLDER_FILE))) {
      throw new HttpError(
        404,
        `Folder "${folderPath.join('/')}" not found in collection "${collectionId}"`
      );
    }
  }
  return dir;
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Names (without .json) of request files directly inside a node directory. */
function requestIdsIn(dir: string): string[] {
  return listJsonFiles(dir)
    .filter(
      (f) =>
        f !== COLLECTION_FILE &&
        f !== FOLDER_FILE &&
        !f.endsWith(RESPONSE_SUFFIX)
    )
    .map((f) => f.replace(/\.json$/, ''));
}

/** Slugs of the subfolders inside a node directory (dirs holding a folder.json). */
function subfolderSlugsIn(dir: string): string[] {
  return listDirs(dir).filter((d) =>
    fs.existsSync(path.join(dir, d, FOLDER_FILE))
  );
}

/**
 * Resolves the directory a request file lives in. Requests written by the
 * current version sit directly in their node directory; older root-level
 * requests may still live in a legacy `requests/` subdirectory.
 */
function requestFileDir(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[],
  id: string
): string {
  const dir = nodeDir(ws, collectionId, folderPath);
  if (fs.existsSync(path.join(dir, `${id}.json`))) return dir;
  if (folderPath.length === 0) {
    const legacy = path.join(dir, LEGACY_REQUESTS_DIR);
    if (fs.existsSync(path.join(legacy, `${id}.json`))) return legacy;
  }
  return dir;
}

export function createWorkspace(name: string, dirPath: string): WorkspaceMeta {
  const abs = path.resolve(expandHome(dirPath));
  const wsFile = path.join(abs, WORKSPACE_FILE);
  if (fs.existsSync(wsFile)) {
    throw new HttpError(409, `A workspace already exists at ${abs}`);
  }
  fs.mkdirSync(path.join(abs, 'collections'), { recursive: true });
  fs.mkdirSync(path.join(abs, 'environments'), { recursive: true });
  const meta = { id: crypto.randomUUID(), name };
  writeJson(wsFile, meta);
  const readme = path.join(abs, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      `# ${name}\n\nAn [API Notebook](https://github.com/) workspace. ` +
        `Open this folder with API Notebook to browse its collections, requests, and environments.\n`
    );
  }
  const gitignore = path.join(abs, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(
      gitignore,
      [
        '# Secret environment values — the shared environment files only',
        '# declare secret variable names; the values live here and stay local.',
        LOCAL_ENV_IGNORE,
        '',
        '# Saved responses are a local cache (may hold tokens/PII).',
        RESPONSE_IGNORE,
        '',
        '# OS cruft',
        '.DS_Store',
        'Thumbs.db',
        '',
      ].join('\n')
    );
  }
  return { ...meta, path: abs };
}

export function openWorkspace(dirPath: string): WorkspaceMeta {
  const abs = path.resolve(expandHome(dirPath));
  const wsFile = path.join(abs, WORKSPACE_FILE);
  if (!fs.existsSync(wsFile)) {
    throw new HttpError(404, `No ${WORKSPACE_FILE} found in ${abs}`);
  }
  const data = readJson<{ id: string; name: string }>(wsFile);
  if (!data.id || !data.name) {
    throw new HttpError(400, `${wsFile} is not a valid workspace file`);
  }
  return { id: data.id, name: data.name, path: abs };
}

function readRequest(
  dir: string,
  id: string
): ApiRequest {
  const stored = readJson<Omit<ApiRequest, 'id' | 'docs'>>(
    path.join(dir, `${id}.json`)
  );
  const docsFile = path.join(dir, `${id}.md`);
  const docs = fs.existsSync(docsFile)
    ? fs.readFileSync(docsFile, 'utf8')
    : '';
  // Files written by older versions may predate newer body/script/graphql/
  // websocket fields, so back-fill each sub-object with its defaults.
  const storedBody: Partial<ApiRequest['body']> = stored.body ?? {};
  const storedScripts: Partial<ApiRequest['scripts']> = stored.scripts ?? {};
  const storedGraphql: Partial<ApiRequest['graphql']> = stored.graphql ?? {};
  const storedWebsocket: Partial<ApiRequest['websocket']> = stored.websocket ?? {};
  const storedSocketio: Partial<ApiRequest['socketio']> = stored.socketio ?? {};
  const storedMcp: Partial<ApiRequest['mcp']> = stored.mcp ?? {};
  return {
    ...stored,
    body: {
      mode: 'none',
      content: '',
      form: [],
      formData: [],
      binaryPath: '',
      ...storedBody,
    },
    scripts: { preRequest: '', postResponse: '', ...storedScripts },
    graphql: { query: '', variables: '', ...storedGraphql },
    websocket: { url: '', subprotocols: '', messages: [], ...storedWebsocket },
    socketio: {
      url: '',
      path: '',
      auth: '',
      query: [],
      emitEvents: [],
      listenEvents: [],
      ...storedSocketio,
    },
    mcp: { url: '', ...storedMcp },
    id,
    docs,
  };
}

/** Reads the requests and subfolders contained directly in a node directory. */
function readNodeChildren(dir: string): {
  folders: Folder[];
  requests: ApiRequest[];
} {
  const requests = requestIdsIn(dir).map((id) => readRequest(dir, id));
  // Older root-level requests may still live in a legacy `requests/` subdir.
  const legacy = path.join(dir, LEGACY_REQUESTS_DIR);
  if (!fs.existsSync(path.join(legacy, FOLDER_FILE))) {
    for (const id of requestIdsIn(legacy)) requests.push(readRequest(legacy, id));
  }
  requests.sort((a, b) => a.id.localeCompare(b.id));
  const folders = subfolderSlugsIn(dir).map((slug) =>
    readFolder(path.join(dir, slug), slug)
  );
  return { folders, requests };
}

function readFolder(dir: string, id: string): Folder {
  const meta = readJson<{
    name: string;
    description?: string;
    scripts?: Partial<Scripts>;
  }>(path.join(dir, FOLDER_FILE));
  const { folders, requests } = readNodeChildren(dir);
  return {
    id,
    name: meta.name,
    description: meta.description ?? '',
    scripts: { ...emptyScripts(), ...meta.scripts },
    folders,
    requests,
  };
}

function readCollection(ws: WorkspaceMeta, id: string): Collection {
  const dir = path.join(collectionsDir(ws), id);
  const meta = readJson<{
    name: string;
    description?: string;
    scripts?: Partial<Scripts>;
  }>(path.join(dir, COLLECTION_FILE));
  const { folders, requests } = readNodeChildren(dir);
  return {
    id,
    name: meta.name,
    description: meta.description ?? '',
    scripts: { ...emptyScripts(), ...meta.scripts },
    folders,
    requests,
  };
}

function localEnvFile(ws: WorkspaceMeta, id: string): string {
  return path.join(environmentsDir(ws), `${id}.local.json`);
}

function readEnvironment(ws: WorkspaceMeta, id: string): Environment {
  const data = readJson<{ name: string; variables?: Environment['variables'] }>(
    path.join(environmentsDir(ws), `${id}.json`)
  );
  // Secret values live in the gitignored <id>.local.json; the shared file
  // only declares their names. Merge them back into one environment.
  let localValues: Record<string, string> = {};
  const localFile = localEnvFile(ws, id);
  if (fs.existsSync(localFile)) {
    try {
      localValues = readJson<{ values?: Record<string, string> }>(localFile).values ?? {};
    } catch {
      // A corrupt local file just means missing secret values.
    }
  }
  const variables = (data.variables ?? []).map((v) =>
    v.secret
      ? { ...v, value: Object.hasOwn(localValues, v.key) ? localValues[v.key] : '' }
      : v
  );
  return { id, name: data.name, variables };
}

export function readTree(
  ws: WorkspaceMeta,
  activeEnvironmentId: string | null
): WorkspaceTree {
  const collections = listDirs(collectionsDir(ws))
    .filter((d) =>
      fs.existsSync(path.join(collectionsDir(ws), d, COLLECTION_FILE))
    )
    .map((d) => readCollection(ws, d));
  const environments = listJsonFiles(environmentsDir(ws))
    .filter((f) => !f.endsWith('.local.json'))
    .map((f) => readEnvironment(ws, f.replace(/\.json$/, '')));
  const activeIsValid = environments.some((e) => e.id === activeEnvironmentId);
  return {
    meta: ws,
    collections,
    environments,
    activeEnvironmentId: activeIsValid ? activeEnvironmentId : null,
  };
}

export function createCollection(ws: WorkspaceMeta, name: string): Collection {
  const taken = new Set(listDirs(collectionsDir(ws)));
  const id = uniqueSlug(slugify(name), taken);
  const dir = path.join(collectionsDir(ws), id);
  const scripts = emptyScripts();
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, COLLECTION_FILE), { name, description: '', scripts });
  return { id, name, description: '', scripts, folders: [], requests: [] };
}

export function updateCollection(
  ws: WorkspaceMeta,
  id: string,
  changes: { name?: string; description?: string; scripts?: Collection['scripts'] }
): void {
  const file = path.join(collectionDir(ws, id), COLLECTION_FILE);
  const meta = readJson<{
    name: string;
    description?: string;
    scripts?: Scripts;
  }>(file);
  writeJson(file, {
    name: changes.name ?? meta.name,
    description: changes.description ?? meta.description ?? '',
    scripts: changes.scripts ?? meta.scripts ?? emptyScripts(),
  });
}

export function deleteCollection(ws: WorkspaceMeta, id: string): void {
  fs.rmSync(collectionDir(ws, id), { recursive: true, force: true });
}

export function getCollection(ws: WorkspaceMeta, id: string): Collection {
  return readCollection(ws, id);
}

// ----- folders -----

export function createFolder(
  ws: WorkspaceMeta,
  collectionId: string,
  parentPath: string[],
  name: string
): Folder {
  const parent = nodeDir(ws, collectionId, parentPath);
  const taken = new Set(subfolderSlugsIn(parent));
  const id = uniqueSlug(slugify(name), taken);
  const dir = path.join(parent, id);
  const scripts = emptyScripts();
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, FOLDER_FILE), { name, description: '', scripts });
  return { id, name, description: '', scripts, folders: [], requests: [] };
}

export function updateFolder(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[],
  changes: { name?: string; description?: string; scripts?: Scripts }
): void {
  if (folderPath.length === 0) {
    throw new HttpError(400, 'A folder path is required');
  }
  const dir = nodeDir(ws, collectionId, folderPath);
  const file = path.join(dir, FOLDER_FILE);
  const meta = readJson<{
    name: string;
    description?: string;
    scripts?: Scripts;
  }>(file);
  writeJson(file, {
    name: changes.name ?? meta.name,
    description: changes.description ?? meta.description ?? '',
    scripts: changes.scripts ?? meta.scripts ?? emptyScripts(),
  });
}

export function deleteFolder(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[]
): void {
  if (folderPath.length === 0) {
    throw new HttpError(400, 'A folder path is required');
  }
  fs.rmSync(nodeDir(ws, collectionId, folderPath), {
    recursive: true,
    force: true,
  });
}

/**
 * Combines the pre-request/post-response scripts that wrap a request: the
 * collection's, then each folder's down the path. Postman runs these outer →
 * inner around every request.
 */
export function getScriptChain(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[]
): Scripts {
  const chain = emptyScripts();
  const append = (file: string) => {
    if (!fs.existsSync(file)) return;
    const meta = readJson<{ scripts?: Partial<Scripts> }>(file);
    const s = { ...emptyScripts(), ...meta.scripts };
    chain.preRequest = joinScripts(chain.preRequest, s.preRequest);
    chain.postResponse = joinScripts(chain.postResponse, s.postResponse);
  };
  let dir = collectionDir(ws, collectionId);
  append(path.join(dir, COLLECTION_FILE));
  for (const slug of folderPath) {
    dir = path.join(dir, slug);
    append(path.join(dir, FOLDER_FILE));
  }
  return chain;
}

function joinScripts(a: string, b: string): string {
  if (a.trim() && b.trim()) return `${a}\n\n${b}`;
  return a.trim() ? a : b;
}

export function getRequest(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[],
  id: string
): ApiRequest {
  const dir = requestFileDir(ws, collectionId, folderPath, id);
  if (!fs.existsSync(path.join(dir, `${id}.json`))) {
    throw new HttpError(404, `Request "${id}" not found`);
  }
  return readRequest(dir, id);
}

export function defaultRequest(
  id: string,
  name: string,
  type: RequestType
): ApiRequest {
  return {
    id,
    name,
    type,
    method: type === 'graphql' ? 'POST' : 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { mode: 'none', content: '', form: [], formData: [], binaryPath: '' },
    graphql: { query: '', variables: '' },
    websocket: { url: '', subprotocols: '', messages: [] },
    socketio: { url: '', path: '', auth: '', query: [], emitEvents: [], listenEvents: [] },
    mcp: { url: '' },
    docs: '',
    scripts: { preRequest: '', postResponse: '' },
  };
}

export function createRequest(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[],
  name: string,
  type: RequestType
): ApiRequest {
  const dir = nodeDir(ws, collectionId, folderPath);
  const taken = new Set(requestIdsIn(dir));
  // Avoid colliding with a root-level request still in the legacy requests/ dir.
  if (folderPath.length === 0) {
    const legacy = path.join(dir, LEGACY_REQUESTS_DIR);
    if (!fs.existsSync(path.join(legacy, FOLDER_FILE))) {
      for (const legacyId of requestIdsIn(legacy)) taken.add(legacyId);
    }
  }
  const id = uniqueSlug(slugify(name), taken);
  const request = defaultRequest(id, name, type);
  writeRequestFiles(dir, request);
  return request;
}

function writeRequestFiles(dir: string, request: ApiRequest): void {
  const { id, docs, ...stored } = request;
  writeJson(path.join(dir, `${id}.json`), stored);
  const docsFile = path.join(dir, `${id}.md`);
  if (docs.trim()) {
    fs.writeFileSync(docsFile, docs.endsWith('\n') ? docs : docs + '\n');
  } else if (fs.existsSync(docsFile)) {
    fs.rmSync(docsFile);
  }
}

export function updateRequest(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[],
  id: string,
  request: ApiRequest
): void {
  const dir = requestFileDir(ws, collectionId, folderPath, id);
  if (!fs.existsSync(path.join(dir, `${id}.json`))) {
    throw new HttpError(404, `Request "${id}" not found`);
  }
  writeRequestFiles(dir, { ...request, id });
}

export function deleteRequest(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[],
  id: string
): void {
  const dir = requestFileDir(ws, collectionId, folderPath, id);
  fs.rmSync(path.join(dir, `${id}.json`), { force: true });
  fs.rmSync(path.join(dir, `${id}.md`), { force: true });
  fs.rmSync(path.join(dir, `${id}${RESPONSE_SUFFIX}`), { force: true });
}

// ----- persisted response history -----

/**
 * Saves a response into the request's history (newest first, capped at
 * RESPONSE_HISTORY). The history is a local cache beside the request file and
 * is never committed (see RESPONSE_IGNORE). No-ops if the request file is gone.
 */
export function saveResponse(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[],
  id: string,
  result: ExecutionResult
): void {
  const dir = requestFileDir(ws, collectionId, folderPath, id);
  if (!fs.existsSync(path.join(dir, `${id}.json`))) return;
  const file = path.join(dir, `${id}${RESPONSE_SUFFIX}`);
  const entry: ExecutionResult = { ...result, savedAt: new Date().toISOString() };
  const history = [entry, ...readResponseHistory(file)].slice(0, RESPONSE_HISTORY);
  writeJson(file, history);
  ensureIgnored(ws, RESPONSE_IGNORE, 'Saved responses stay local');
}

function readResponseHistory(file: string): ExecutionResult[] {
  if (!fs.existsSync(file)) return [];
  try {
    const data = readJson<unknown>(file);
    return Array.isArray(data) ? (data as ExecutionResult[]) : [];
  } catch {
    return [];
  }
}

export function getResponses(
  ws: WorkspaceMeta,
  collectionId: string,
  folderPath: string[],
  id: string
): ExecutionResult[] {
  const dir = requestFileDir(ws, collectionId, folderPath, id);
  return readResponseHistory(path.join(dir, `${id}${RESPONSE_SUFFIX}`));
}

// ----- move (reparent) -----

export interface RequestLocation {
  collectionId: string;
  folderPath: string[];
  requestId: string;
}

export interface FolderLocation {
  collectionId: string;
  folderPath: string[];
}

/** Request ids already taken in a node (incl. a legacy requests/ dir at root). */
function takenRequestIds(dir: string, isRoot: boolean): Set<string> {
  const taken = new Set(requestIdsIn(dir));
  if (isRoot) {
    const legacy = path.join(dir, LEGACY_REQUESTS_DIR);
    if (!fs.existsSync(path.join(legacy, FOLDER_FILE))) {
      for (const id of requestIdsIn(legacy)) taken.add(id);
    }
  }
  return taken;
}

/**
 * Moves a request (its .json and any .md sibling) into another node, possibly
 * in another collection. The slug is kept unless it collides at the
 * destination, in which case it is uniquified. Returns the new location.
 */
export function moveRequest(
  ws: WorkspaceMeta,
  from: RequestLocation,
  to: FolderLocation
): RequestLocation {
  const srcDir = requestFileDir(ws, from.collectionId, from.folderPath, from.requestId);
  const srcJson = path.join(srcDir, `${from.requestId}.json`);
  if (!fs.existsSync(srcJson)) {
    throw new HttpError(404, `Request "${from.requestId}" not found`);
  }
  const destDir = nodeDir(ws, to.collectionId, to.folderPath);
  if (path.resolve(srcDir) === path.resolve(destDir)) {
    return { ...to, requestId: from.requestId };
  }
  const newId = uniqueSlug(
    from.requestId,
    takenRequestIds(destDir, to.folderPath.length === 0)
  );
  fs.renameSync(srcJson, path.join(destDir, `${newId}.json`));
  const srcMd = path.join(srcDir, `${from.requestId}.md`);
  if (fs.existsSync(srcMd)) {
    fs.renameSync(srcMd, path.join(destDir, `${newId}.md`));
  }
  const srcResp = path.join(srcDir, `${from.requestId}${RESPONSE_SUFFIX}`);
  if (fs.existsSync(srcResp)) {
    fs.renameSync(srcResp, path.join(destDir, `${newId}${RESPONSE_SUFFIX}`));
  }
  return { ...to, requestId: newId };
}

/**
 * Moves a folder (with everything inside it) under a new parent, possibly in
 * another collection. Rejects moving a folder into itself or a descendant.
 * Returns the new folder path.
 */
export function moveFolder(
  ws: WorkspaceMeta,
  from: FolderLocation,
  to: FolderLocation
): FolderLocation {
  if (from.folderPath.length === 0) {
    throw new HttpError(400, 'No folder to move');
  }
  const srcDir = nodeDir(ws, from.collectionId, from.folderPath);
  const parentPath = from.folderPath.slice(0, -1);

  if (from.collectionId === to.collectionId) {
    // Into the same parent — nothing to do.
    if (parentPath.join('/') === to.folderPath.join('/')) return from;
    // Into itself or one of its own descendants — not allowed.
    const fromKey = from.folderPath.join('/');
    const destKey = to.folderPath.slice(0, from.folderPath.length).join('/');
    if (
      to.folderPath.length >= from.folderPath.length &&
      destKey === fromKey
    ) {
      throw new HttpError(400, 'Cannot move a folder into itself or its own subfolder');
    }
  }

  const destParent = nodeDir(ws, to.collectionId, to.folderPath);
  const slug = from.folderPath[from.folderPath.length - 1];
  const newSlug = uniqueSlug(slug, new Set(subfolderSlugsIn(destParent)));
  fs.renameSync(srcDir, path.join(destParent, newSlug));
  return { collectionId: to.collectionId, folderPath: [...to.folderPath, newSlug] };
}

export function createEnvironment(ws: WorkspaceMeta, name: string): Environment {
  const dir = environmentsDir(ws);
  const taken = new Set(
    listJsonFiles(dir).map((f) => f.replace(/\.json$/, ''))
  );
  const id = uniqueSlug(slugify(name), taken);
  writeJson(path.join(dir, `${id}.json`), { name, variables: [] });
  return { id, name, variables: [] };
}

export function getEnvironment(
  ws: WorkspaceMeta,
  id: string
): Environment | undefined {
  const file = path.join(environmentsDir(ws), `${id}.json`);
  if (!fs.existsSync(file)) return undefined;
  return readEnvironment(ws, id);
}

/**
 * Make sure the workspace's .gitignore contains a pattern, appending it (with a
 * comment) when missing. Used to keep local-only artifacts — secret env values
 * and saved responses — out of Git even in workspaces created before the
 * feature existed.
 */
function ensureIgnored(ws: WorkspaceMeta, pattern: string, comment: string): void {
  const file = path.join(ws.path, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = existing.split('\n').map((l) => l.trim());
  if (lines.includes(pattern) || lines.includes(`/${pattern}`)) return;
  const block = `# ${comment}\n${pattern}\n`;
  const content = existing ? existing.replace(/\n*$/, '\n\n') + block : block;
  fs.writeFileSync(file, content);
}

export function updateEnvironment(
  ws: WorkspaceMeta,
  id: string,
  changes: { name: string; variables: Environment['variables'] }
): void {
  const file = path.join(environmentsDir(ws), `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new HttpError(404, `Environment "${id}" not found`);
  }
  // Shared file keeps secret variable names but never their values.
  const shared = changes.variables.map((v) =>
    v.secret ? { ...v, value: '' } : v
  );
  writeJson(file, { name: changes.name, variables: shared });

  const secrets = changes.variables.filter((v) => v.secret && v.key);
  if (secrets.length > 0) {
    writeJson(localEnvFile(ws, id), {
      values: Object.fromEntries(secrets.map((v) => [v.key, v.value])),
    });
    ensureIgnored(ws, LOCAL_ENV_IGNORE, 'Secret environment values stay local');
  } else {
    fs.rmSync(localEnvFile(ws, id), { force: true });
  }
}

export function deleteEnvironment(ws: WorkspaceMeta, id: string): void {
  fs.rmSync(path.join(environmentsDir(ws), `${id}.json`), { force: true });
  fs.rmSync(localEnvFile(ws, id), { force: true });
}
