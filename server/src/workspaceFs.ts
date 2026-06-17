import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ApiRequest,
  Collection,
  Environment,
  RequestType,
  WorkspaceMeta,
  WorkspaceTree,
} from './types.js';

const WORKSPACE_FILE = 'workspace.json';
const LOCAL_ENV_IGNORE = 'environments/*.local.json';

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
  if (!fs.existsSync(path.join(dir, 'collection.json'))) {
    throw new HttpError(404, `Collection "${collectionId}" not found`);
  }
  return dir;
}

function requestsDir(ws: WorkspaceMeta, collectionId: string): string {
  return path.join(collectionDir(ws, collectionId), 'requests');
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
  // Files written by older versions may predate newer body/script/graphql fields.
  const storedBody: Partial<ApiRequest['body']> = stored.body ?? {};
  const storedScripts: Partial<ApiRequest['scripts']> = stored.scripts ?? {};
  const storedGraphql: Partial<ApiRequest['graphql']> = stored.graphql ?? {};
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
    id,
    docs,
  };
}

function readCollection(ws: WorkspaceMeta, id: string): Collection {
  const dir = path.join(collectionsDir(ws), id);
  const meta = readJson<{
    name: string;
    description?: string;
    scripts?: Partial<Collection['scripts']>;
  }>(path.join(dir, 'collection.json'));
  const reqDir = path.join(dir, 'requests');
  const requests = listJsonFiles(reqDir).map((f) =>
    readRequest(reqDir, f.replace(/\.json$/, ''))
  );
  return {
    id,
    name: meta.name,
    description: meta.description ?? '',
    scripts: { preRequest: '', postResponse: '', ...meta.scripts },
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
      fs.existsSync(path.join(collectionsDir(ws), d, 'collection.json'))
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
  const scripts = { preRequest: '', postResponse: '' };
  fs.mkdirSync(path.join(dir, 'requests'), { recursive: true });
  writeJson(path.join(dir, 'collection.json'), { name, description: '', scripts });
  return { id, name, description: '', scripts, requests: [] };
}

export function updateCollection(
  ws: WorkspaceMeta,
  id: string,
  changes: { name?: string; description?: string; scripts?: Collection['scripts'] }
): void {
  const file = path.join(collectionDir(ws, id), 'collection.json');
  const meta = readJson<{
    name: string;
    description?: string;
    scripts?: Collection['scripts'];
  }>(file);
  writeJson(file, {
    name: changes.name ?? meta.name,
    description: changes.description ?? meta.description ?? '',
    scripts: changes.scripts ??
      meta.scripts ?? { preRequest: '', postResponse: '' },
  });
}

export function deleteCollection(ws: WorkspaceMeta, id: string): void {
  fs.rmSync(collectionDir(ws, id), { recursive: true, force: true });
}

export function getCollectionScripts(
  ws: WorkspaceMeta,
  id: string
): Collection['scripts'] {
  const file = path.join(collectionDir(ws, id), 'collection.json');
  if (!fs.existsSync(file)) return { preRequest: '', postResponse: '' };
  const meta = readJson<{ scripts?: Partial<Collection['scripts']> }>(file);
  return { preRequest: '', postResponse: '', ...meta.scripts };
}

export function getCollection(ws: WorkspaceMeta, id: string): Collection {
  return readCollection(ws, id);
}

export function getRequest(
  ws: WorkspaceMeta,
  collectionId: string,
  id: string
): ApiRequest {
  const dir = requestsDir(ws, collectionId);
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
    docs: '',
    scripts: { preRequest: '', postResponse: '' },
  };
}

export function createRequest(
  ws: WorkspaceMeta,
  collectionId: string,
  name: string,
  type: RequestType
): ApiRequest {
  const dir = requestsDir(ws, collectionId);
  const taken = new Set(
    listJsonFiles(dir).map((f) => f.replace(/\.json$/, ''))
  );
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
  id: string,
  request: ApiRequest
): void {
  const dir = requestsDir(ws, collectionId);
  if (!fs.existsSync(path.join(dir, `${id}.json`))) {
    throw new HttpError(404, `Request "${id}" not found`);
  }
  writeRequestFiles(dir, { ...request, id });
}

export function deleteRequest(
  ws: WorkspaceMeta,
  collectionId: string,
  id: string
): void {
  const dir = requestsDir(ws, collectionId);
  fs.rmSync(path.join(dir, `${id}.json`), { force: true });
  fs.rmSync(path.join(dir, `${id}.md`), { force: true });
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
 * Make sure the workspace's .gitignore excludes <env>.local.json files,
 * so secret values can never be committed by accident. Appends the rule
 * to workspaces created before this feature existed.
 */
function ensureLocalEnvIgnored(ws: WorkspaceMeta): void {
  const file = path.join(ws.path, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = existing.split('\n').map((l) => l.trim());
  if (lines.includes(LOCAL_ENV_IGNORE) || lines.includes(`/${LOCAL_ENV_IGNORE}`)) {
    return;
  }
  const block = `# Secret environment values stay local\n${LOCAL_ENV_IGNORE}\n`;
  const content = existing
    ? existing.replace(/\n*$/, '\n\n') + block
    : block;
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
    ensureLocalEnvIgnored(ws);
  } else {
    fs.rmSync(localEnvFile(ws, id), { force: true });
  }
}

export function deleteEnvironment(ws: WorkspaceMeta, id: string): void {
  fs.rmSync(path.join(environmentsDir(ws), `${id}.json`), { force: true });
  fs.rmSync(localEnvFile(ws, id), { force: true });
}
