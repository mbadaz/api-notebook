import type {
  ApiRequest,
  AuthConfig,
  HttpMethod,
  KeyValue,
  RequestBody,
  RequestType,
  Scripts,
} from './types.js';

/**
 * Converts Postman Collection v2.1.0 exports into our own request/collection
 * model, and Postman environment exports into our environments. The Postman
 * shapes are typed loosely here because exports vary across Postman versions;
 * we read defensively and fall back to sane defaults.
 */

const HTTP_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

interface PostmanDescription {
  content?: string;
}
type Described = string | PostmanDescription | undefined | null;

interface PostmanParam {
  key?: string;
  value?: string;
  src?: string | string[];
  type?: string;
  disabled?: boolean;
}

interface PostmanUrl {
  raw?: string;
  host?: string[];
  path?: string[] | string;
  query?: PostmanParam[];
}

interface PostmanAuth {
  type?: string;
  bearer?: PostmanParam[] | Record<string, string>;
  basic?: PostmanParam[] | Record<string, string>;
  apikey?: PostmanParam[] | Record<string, string>;
}

interface PostmanBody {
  mode?: string;
  raw?: string;
  urlencoded?: PostmanParam[];
  formdata?: PostmanParam[];
  file?: { src?: string | string[] };
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } };
}

interface PostmanRequest {
  method?: string;
  header?: PostmanParam[] | string;
  url?: PostmanUrl | string;
  auth?: PostmanAuth;
  body?: PostmanBody;
  description?: Described;
}

interface PostmanEvent {
  listen?: string;
  script?: { exec?: string[] | string };
}

interface PostmanItem {
  name?: string;
  description?: Described;
  item?: PostmanItem[];
  request?: PostmanRequest;
  event?: PostmanEvent[];
}

interface PostmanCollection {
  info?: { name?: string; schema?: string; description?: Described };
  item?: PostmanItem[];
  event?: PostmanEvent[];
}

interface PostmanEnvironment {
  name?: string;
  values?: PostmanParam[];
  _postman_variable_scope?: string;
}

export type PostmanKind = 'collection' | 'environment' | null;

export function detectPostmanKind(json: unknown): PostmanKind {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (obj._postman_variable_scope === 'environment' || Array.isArray(obj.values)) {
    return 'environment';
  }
  const info = obj.info as { schema?: string } | undefined;
  if (Array.isArray(obj.item) && info && typeof info.schema === 'string') {
    return 'collection';
  }
  return null;
}

function describe(d: Described): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  return d.content ?? '';
}

const emptyScripts = (): Scripts => ({ preRequest: '', postResponse: '' });

function execToString(event: PostmanEvent): string {
  const exec = event.script?.exec;
  if (Array.isArray(exec)) return exec.join('\n').trim();
  if (typeof exec === 'string') return exec.trim();
  return '';
}

/** Postman items carry pre-request/test scripts in an `event` array. */
function eventsToScripts(events: PostmanEvent[] | undefined): Scripts {
  const scripts = emptyScripts();
  for (const event of events ?? []) {
    const code = execToString(event);
    if (!code) continue;
    if (event.listen === 'prerequest') {
      scripts.preRequest = joinScript(scripts.preRequest, code);
    } else if (event.listen === 'test') {
      scripts.postResponse = joinScript(scripts.postResponse, code);
    }
  }
  return scripts;
}

function joinScript(a: string, b: string): string {
  if (a && b) return `${a}\n\n${b}`;
  return a || b;
}

export function hasScripts(scripts: Scripts): boolean {
  return Boolean(scripts.preRequest || scripts.postResponse);
}

function paramValue(
  source: PostmanParam[] | Record<string, string> | undefined,
  key: string
): string {
  if (!source) return '';
  if (Array.isArray(source)) {
    const found = source.find((p) => p.key === key);
    return found ? String(found.value ?? '') : '';
  }
  return String(source[key] ?? '');
}

function firstSrc(src: string | string[] | undefined): string {
  if (!src) return '';
  return Array.isArray(src) ? (src[0] ?? '') : src;
}

function convertAuth(auth: PostmanAuth | undefined): AuthConfig {
  if (!auth || !auth.type || auth.type === 'noauth') return { type: 'none' };
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', bearer: { token: paramValue(auth.bearer, 'token') } };
    case 'basic':
      return {
        type: 'basic',
        basic: {
          username: paramValue(auth.basic, 'username'),
          password: paramValue(auth.basic, 'password'),
        },
      };
    case 'apikey': {
      const placement = paramValue(auth.apikey, 'in') === 'query' ? 'query' : 'header';
      return {
        type: 'apiKey',
        apiKey: {
          key: paramValue(auth.apikey, 'key'),
          value: paramValue(auth.apikey, 'value'),
          placement,
        },
      };
    }
    default:
      return { type: 'none' };
  }
}

function emptyBody(): RequestBody {
  return { mode: 'none', content: '', form: [], formData: [], binaryPath: '' };
}

function toKeyValues(params: PostmanParam[] | undefined): KeyValue[] {
  return (params ?? [])
    .filter((p) => (p.key ?? '') !== '' || (p.value ?? '') !== '')
    .map((p) => ({
      key: p.key ?? '',
      value: p.value ?? '',
      enabled: p.disabled !== true,
    }));
}

function convertUrl(url: PostmanUrl | string | undefined): {
  url: string;
  params: KeyValue[];
} {
  if (!url) return { url: '', params: [] };
  if (typeof url === 'string') return { url: url.split('?')[0] ?? url, params: [] };
  const raw = url.raw ?? '';
  let base = raw.split('?')[0] ?? '';
  if (!base) {
    const host = Array.isArray(url.host) ? url.host.join('.') : '';
    const segments = Array.isArray(url.path) ? url.path.join('/') : url.path ?? '';
    base = segments ? `${host}/${segments}` : host;
  }
  return { url: base, params: toKeyValues(url.query) };
}

type ConvertedRequest = Omit<ApiRequest, 'id'>;

function convertRequest(item: PostmanItem): ConvertedRequest {
  const req = item.request ?? {};
  const methodRaw = (req.method ?? 'GET').toUpperCase();
  const method = (HTTP_METHODS.includes(methodRaw as HttpMethod)
    ? methodRaw
    : 'GET') as HttpMethod;

  const { url, params } = convertUrl(req.url);
  const headers = toKeyValues(Array.isArray(req.header) ? req.header : undefined);

  let type: RequestType = 'http';
  let body = emptyBody();
  const graphql = { query: '', variables: '' };

  const b = req.body;
  if (b && b.mode) {
    if (b.mode === 'graphql') {
      type = 'graphql';
      graphql.query = b.graphql?.query ?? '';
      graphql.variables = b.graphql?.variables ?? '';
    } else if (b.mode === 'raw') {
      const language = b.options?.raw?.language;
      if (language === 'graphql') {
        type = 'graphql';
        graphql.query = b.raw ?? '';
      } else {
        body = { ...emptyBody(), mode: language === 'json' ? 'json' : 'text', content: b.raw ?? '' };
      }
    } else if (b.mode === 'urlencoded') {
      body = { ...emptyBody(), mode: 'form', form: toKeyValues(b.urlencoded) };
    } else if (b.mode === 'formdata') {
      body = {
        ...emptyBody(),
        mode: 'formData',
        formData: (b.formdata ?? []).map((f) => ({
          key: f.key ?? '',
          value: f.type === 'file' ? firstSrc(f.src) : f.value ?? '',
          type: f.type === 'file' ? 'file' : 'text',
          enabled: f.disabled !== true,
        })),
      };
    } else if (b.mode === 'file') {
      body = { ...emptyBody(), mode: 'binary', binaryPath: firstSrc(b.file?.src) };
    }
  }

  return {
    name: item.name ?? 'Untitled',
    type,
    method,
    url,
    params,
    headers,
    auth: convertAuth(req.auth),
    body,
    graphql,
    docs: describe(req.description),
    scripts: eventsToScripts(item.event),
  };
}

export interface ConvertedFolder {
  name: string;
  description: string;
  scripts: Scripts;
  folders: ConvertedFolder[];
  requests: ConvertedRequest[];
}

export interface ConvertedCollection {
  name: string;
  description: string;
  scripts: Scripts;
  folders: ConvertedFolder[];
  requests: ConvertedRequest[];
}

interface ConvertedNode {
  folders: ConvertedFolder[];
  requests: ConvertedRequest[];
}

/**
 * Postman items are either folders (they have a nested `item` array) or
 * requests. We mirror that structure directly: folders become folders (keeping
 * their own pre-request/test scripts and description) and requests become
 * requests in the node that contains them. Postman runs collection- and
 * folder-level scripts around each request; we preserve them per node and the
 * runtime combines the chain at execution time.
 */
function convertNode(items: PostmanItem[]): ConvertedNode {
  const folders: ConvertedFolder[] = [];
  const requests: ConvertedRequest[] = [];
  for (const item of items) {
    if (Array.isArray(item.item)) {
      const child = convertNode(item.item);
      folders.push({
        name: item.name ?? 'Folder',
        description: describe(item.description),
        scripts: eventsToScripts(item.event),
        folders: child.folders,
        requests: child.requests,
      });
    } else if (item.request) {
      requests.push(convertRequest(item));
    }
  }
  return { folders, requests };
}

/** A whole Postman collection maps to one of our collections, nesting intact. */
export function convertCollection(json: PostmanCollection): ConvertedCollection {
  const { folders, requests } = convertNode(json.item ?? []);
  return {
    name: json.info?.name?.trim() || 'Imported',
    description: describe(json.info?.description),
    scripts: eventsToScripts(json.event),
    folders,
    requests,
  };
}

export interface ConvertedEnvironment {
  name: string;
  variables: KeyValue[];
}

export function convertEnvironment(
  json: PostmanEnvironment
): ConvertedEnvironment {
  const variables: KeyValue[] = (json.values ?? [])
    .filter((v) => (v.key ?? '') !== '')
    .map((v) => {
      const kv: KeyValue = {
        key: v.key ?? '',
        value: v.value ?? '',
        enabled: v.disabled !== true,
      };
      // Postman marks secret variables with type "secret"; map those to our
      // secret model (name in the shared file, value in <env>.local.json).
      if (v.type === 'secret') kv.secret = true;
      return kv;
    });
  return { name: json.name?.trim() || 'Imported', variables };
}
