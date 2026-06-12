import fs from 'node:fs';
import path from 'node:path';
import { guessMime } from './mime.js';
import type {
  ApiRequest,
  Environment,
  ExecutionResult,
  KeyValue,
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

function envToVars(env: Environment | undefined): Record<string, string> {
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
  env: Environment | undefined
): Promise<ExecutionResult> {
  const r = resolveRequest(request, envToVars(env));

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
  let body: string | URLSearchParams | FormData | Buffer | undefined;
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
      body = await fs.promises.readFile(filePath);
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

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

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
