import fs from 'node:fs';
import path from 'node:path';
import type { CookieJar } from 'tough-cookie';
import {
  attachCookies,
  cookieMap,
  storeSetCookies,
} from './cookies.js';
import { guessMime } from './mime.js';
import {
  createRunState,
  effectiveVars,
  runScript,
  type MutableRequest,
  type ResponseView,
} from './scripting.js';
import type {
  ApiRequest,
  Environment,
  ExecutionResult,
  KeyValue,
  Scripts,
} from './types.js';
import { expandHome, HttpError } from './workspaceFs.js';

const REQUEST_TIMEOUT_MS = 30_000;

export function interpolate(
  text: string,
  vars: Record<string, string>
): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? vars[name] : match
  );
}

export function envToVars(env: Environment | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const v of env?.variables ?? []) {
    // A secret without a local value is treated as undefined so the token
    // stays literal (and visibly wrong) instead of resolving to "".
    if (v.enabled && v.key && !(v.secret && v.value === '')) {
      vars[v.key] = v.value;
    }
  }
  return vars;
}

function resolveKeyValues(
  items: KeyValue[],
  vars: Record<string, string>
): KeyValue[] {
  return items.map((kv) => ({
    ...kv,
    key: interpolate(kv.key, vars),
    value: interpolate(kv.value, vars),
  }));
}

function resolveRequest(
  req: ApiRequest,
  vars: Record<string, string>
): ApiRequest {
  return {
    ...req,
    url: interpolate(req.url, vars),
    params: resolveKeyValues(req.params, vars),
    headers: resolveKeyValues(req.headers, vars),
    auth: {
      type: req.auth.type,
      bearer: req.auth.bearer && {
        token: interpolate(req.auth.bearer.token, vars),
      },
      basic: req.auth.basic && {
        username: interpolate(req.auth.basic.username, vars),
        password: interpolate(req.auth.basic.password, vars),
      },
      apiKey: req.auth.apiKey && {
        ...req.auth.apiKey,
        key: interpolate(req.auth.apiKey.key, vars),
        value: interpolate(req.auth.apiKey.value, vars),
      },
    },
    body: {
      ...req.body,
      content: interpolate(req.body.content, vars),
      form: resolveKeyValues(req.body.form, vars),
      formData: (req.body.formData ?? []).map((f) => ({
        ...f,
        key: interpolate(f.key, vars),
        value: interpolate(f.value, vars),
      })),
      binaryPath: interpolate(req.body.binaryPath ?? '', vars),
    },
    graphql: {
      query: interpolate(req.graphql.query, vars),
      variables: interpolate(req.graphql.variables, vars),
    },
  };
}

export async function executeRequest(
  request: ApiRequest,
  vars: Record<string, string>,
  jar?: CookieJar
): Promise<ExecutionResult> {
  const r = resolveRequest(request, vars);

  let url: URL;
  try {
    url = new URL(r.url);
  } catch {
    throw new HttpError(400, `Invalid URL: "${r.url}"`);
  }
  for (const p of r.params) {
    if (p.enabled && p.key) url.searchParams.append(p.key, p.value);
  }

  const headers = new Headers();
  for (const h of r.headers) {
    if (h.enabled && h.key) headers.set(h.key, h.value);
  }

  switch (r.auth.type) {
    case 'bearer':
      headers.set('authorization', `Bearer ${r.auth.bearer?.token ?? ''}`);
      break;
    case 'basic': {
      const { username = '', password = '' } = r.auth.basic ?? {};
      const encoded = Buffer.from(`${username}:${password}`).toString('base64');
      headers.set('authorization', `Basic ${encoded}`);
      break;
    }
    case 'apiKey': {
      const apiKey = r.auth.apiKey;
      if (apiKey?.key) {
        if (apiKey.placement === 'query') {
          url.searchParams.append(apiKey.key, apiKey.value);
        } else {
          headers.set(apiKey.key, apiKey.value);
        }
      }
      break;
    }
  }

  const method = r.type === 'graphql' ? 'POST' : r.method;
  let body: BodyInit | undefined;
  if (r.type === 'graphql') {
    let variables: unknown = {};
    if (r.graphql.variables.trim()) {
      try {
        variables = JSON.parse(r.graphql.variables);
      } catch {
        throw new HttpError(400, 'GraphQL variables are not valid JSON');
      }
    }
    body = JSON.stringify({ query: r.graphql.query, variables });
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  } else if (method !== 'GET' && method !== 'HEAD' && r.body.mode !== 'none') {
    if (r.body.mode === 'form') {
      const form = new URLSearchParams();
      for (const f of r.body.form) {
        if (f.enabled && f.key) form.append(f.key, f.value);
      }
      body = form;
    } else if (r.body.mode === 'formData') {
      const fd = new FormData();
      for (const f of r.body.formData ?? []) {
        if (!f.enabled || !f.key) continue;
        if (f.type === 'file') {
          const filePath = path.resolve(expandHome(f.value));
          if (!f.value.trim() || !fs.existsSync(filePath)) {
            throw new HttpError(400, `Form field "${f.key}": file not found: ${f.value || '(empty)'}`);
          }
          const data = await fs.promises.readFile(filePath);
          fd.append(
            f.key,
            new Blob([data], {
              type: guessMime(filePath) ?? 'application/octet-stream',
            }),
            path.basename(filePath)
          );
        } else {
          fd.append(f.key, f.value);
        }
      }
      // fetch must generate the multipart boundary itself; a manually set
      // content-type would not match it.
      headers.delete('content-type');
      body = fd;
    } else if (r.body.mode === 'binary') {
      if (!r.body.binaryPath?.trim()) {
        throw new HttpError(400, 'Binary body: no file selected');
      }
      const filePath = path.resolve(expandHome(r.body.binaryPath));
      if (!fs.existsSync(filePath)) {
        throw new HttpError(400, `File not found: ${r.body.binaryPath}`);
      }
      // Valid at runtime; @types/node's BodyInit doesn't admit
      // Uint8Array<ArrayBufferLike>, hence the cast.
      body = new Uint8Array(
        await fs.promises.readFile(filePath)
      ) as unknown as BodyInit;
      if (!headers.has('content-type')) {
        headers.set(
          'content-type',
          guessMime(filePath) ?? 'application/octet-stream'
        );
      }
    } else {
      body = r.body.content;
      if (!headers.has('content-type')) {
        headers.set(
          'content-type',
          r.body.mode === 'json' ? 'application/json' : 'text/plain'
        );
      }
    }
  }

  if (jar) attachCookies(jar, url.toString(), headers);

  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const cause = err instanceof Error ? (err.cause ?? err) : err;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `Request failed: ${detail}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  const timeMs = Math.round(performance.now() - started);

  // getSetCookie() preserves each Set-Cookie separately; forEach would merge
  // them into one comma-joined string and corrupt cookies with dates.
  const setCookies = response.headers.getSetCookie();
  if (jar) storeSetCookies(jar, url.toString(), setCookies);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') responseHeaders[key] = value;
  });
  if (setCookies.length > 0) responseHeaders['set-cookie'] = setCookies.join('\n');

  // Keep valid UTF-8 as text; anything else (images, archives, PDFs…)
  // travels as base64 so it survives JSON transport unmangled.
  let bodyText: string;
  let bodyEncoding: 'text' | 'base64';
  try {
    bodyText = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    bodyEncoding = 'text';
  } catch {
    bodyText = buf.toString('base64');
    bodyEncoding = 'base64';
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: bodyText,
    bodyEncoding,
    timeMs,
    sizeBytes: buf.length,
    resolvedUrl: url.toString(),
  };
}

export interface RunOutcome {
  result: ExecutionResult;
  envVars: Record<string, string>;
  changedEnvKeys: string[];
}

function hasAnyScript(collectionScripts: Scripts, request: ApiRequest): boolean {
  return [
    collectionScripts.preRequest,
    collectionScripts.postResponse,
    request.scripts.preRequest,
    request.scripts.postResponse,
  ].some((s) => s.trim());
}

/**
 * Runs a request with its collection's and its own pre-request and
 * post-response scripts around the fetch. Pre-request scripts can mutate the
 * request and variables; post-response scripts read the response and set
 * variables. Returns the execution result (with a `script` outcome) plus the
 * final environment variables for the caller to persist.
 */
export async function runRequest(
  request: ApiRequest,
  collectionScripts: Scripts,
  env: Environment | undefined,
  jar?: CookieJar
): Promise<RunOutcome> {
  const baseVars = envToVars(env);

  // Without scripts, behave exactly as before — one interpolated fetch.
  if (!hasAnyScript(collectionScripts, request)) {
    const result = await executeRequest(request, baseVars, jar);
    return { result, envVars: baseVars, changedEnvKeys: [] };
  }

  const mutable: MutableRequest = {
    method: request.method,
    url: request.url,
    headers: request.headers
      .filter((h) => h.enabled && h.key)
      .map((h) => ({ key: h.key, value: h.value })),
    body: request.body.content,
  };
  const state = createRunState(baseVars, mutable, env !== undefined);
  const errors: string[] = [];

  // Snapshot cookies the request would send, for pm.cookies in pre-request.
  if (jar) state.cookies = cookieMap(jar, interpolate(mutable.url, baseVars));

  for (const code of [collectionScripts.preRequest, request.scripts.preRequest]) {
    const err = runScript(code, state, null);
    if (err) errors.push(`Pre-request: ${err}`);
  }

  // Apply pre-request mutations onto the request we actually send.
  const sendRequest: ApiRequest = {
    ...request,
    method: state.request.method as ApiRequest['method'],
    url: state.request.url,
    headers: state.request.headers.map((h) => ({
      key: h.key,
      value: h.value,
      enabled: true,
    })),
    body: { ...request.body, content: state.request.body },
  };

  const result = await executeRequest(sendRequest, effectiveVars(state), jar);

  // Refresh the cookie snapshot so post-response scripts see Set-Cookie values.
  if (jar) {
    state.cookies = cookieMap(jar, interpolate(sendRequest.url, effectiveVars(state)));
  }

  const responseView: ResponseView = {
    code: result.status,
    status: result.statusText,
    responseTime: result.timeMs,
    headers: result.headers,
    text: result.bodyEncoding === 'text' ? result.body : '',
  };
  for (const code of [
    collectionScripts.postResponse,
    request.scripts.postResponse,
  ]) {
    const err = runScript(code, state, responseView);
    if (err) errors.push(`Post-response: ${err}`);
  }

  result.script = {
    logs: state.logs,
    tests: state.tests,
    variablesSet: [...state.changedEnvKeys],
    error: errors.length ? errors.join('\n') : undefined,
  };

  return {
    result,
    envVars: state.envVars,
    changedEnvKeys: [...state.changedEnvKeys],
  };
}

/**
 * Merges script-driven variable changes back into an environment's variable
 * list, preserving each variable's secret flag (so secret values still land in
 * the gitignored local file via updateEnvironment).
 */
export function applyEnvChanges(
  env: Environment,
  envVars: Record<string, string>,
  changedKeys: string[]
): KeyValue[] {
  const changed = new Set(changedKeys);
  const existing = new Set(env.variables.map((v) => v.key));
  const variables = env.variables
    // Drop variables a script unset.
    .filter((v) => !(changed.has(v.key) && !Object.hasOwn(envVars, v.key)))
    .map((v) =>
      changed.has(v.key) ? { ...v, value: envVars[v.key], enabled: true } : v
    );
  for (const key of changedKeys) {
    if (!existing.has(key) && Object.hasOwn(envVars, key)) {
      variables.push({ key, value: envVars[key], enabled: true });
    }
  }
  return variables;
}
