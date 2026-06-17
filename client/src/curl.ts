import type { ApiRequest, FormDataField, HttpMethod, KeyValue } from './types';
import { HTTP_METHODS } from './types';

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, name: string) =>
    Object.hasOwn(vars, name) ? vars[name] : m
  );
}

/** Single-quote a string for a POSIX shell. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render a request as a runnable cURL command, with {{variables}}
 * resolved from the active environment.
 */
export function requestToCurl(
  req: ApiRequest,
  vars: Record<string, string>
): string {
  if (req.type !== 'http' && req.type !== 'graphql') {
    return `# Cannot export a ${req.type} request as cURL`;
  }
  const i = (t: string) => interpolate(t, vars);
  const method = req.type === 'graphql' ? 'POST' : req.method;

  const queryParts = req.params
    .filter((p) => p.enabled && p.key)
    .map(
      (p) => `${encodeURIComponent(i(p.key))}=${encodeURIComponent(i(p.value))}`
    );
  const headers: string[] = req.headers
    .filter((h) => h.enabled && h.key)
    .map((h) => `${i(h.key)}: ${i(h.value)}`);
  const hasHeader = (name: string) =>
    headers.some((h) => h.toLowerCase().startsWith(`${name.toLowerCase()}:`));

  const flags: string[] = [];

  switch (req.auth.type) {
    case 'bearer':
      headers.push(`Authorization: Bearer ${i(req.auth.bearer?.token ?? '')}`);
      break;
    case 'basic':
      flags.push(
        `-u ${shq(`${i(req.auth.basic?.username ?? '')}:${i(req.auth.basic?.password ?? '')}`)}`
      );
      break;
    case 'apiKey': {
      const k = req.auth.apiKey;
      if (k?.key) {
        if (k.placement === 'query') {
          queryParts.push(
            `${encodeURIComponent(i(k.key))}=${encodeURIComponent(i(k.value))}`
          );
        } else {
          headers.push(`${i(k.key)}: ${i(k.value)}`);
        }
      }
      break;
    }
  }

  if (req.type === 'graphql') {
    let variables: unknown = {};
    try {
      variables = req.graphql.variables.trim()
        ? JSON.parse(i(req.graphql.variables))
        : {};
    } catch {
      variables = i(req.graphql.variables);
    }
    if (!hasHeader('content-type')) headers.push('Content-Type: application/json');
    flags.push(
      `--data-raw ${shq(JSON.stringify({ query: i(req.graphql.query), variables }))}`
    );
  } else if (method !== 'GET' && method !== 'HEAD') {
    const b = req.body;
    if (b.mode === 'json' || b.mode === 'text') {
      if (b.mode === 'json' && !hasHeader('content-type')) {
        headers.push('Content-Type: application/json');
      }
      if (b.content) flags.push(`--data-raw ${shq(i(b.content))}`);
    } else if (b.mode === 'form') {
      for (const f of b.form.filter((f) => f.enabled && f.key)) {
        flags.push(`--data-urlencode ${shq(`${i(f.key)}=${i(f.value)}`)}`);
      }
    } else if (b.mode === 'formData') {
      for (const f of (b.formData ?? []).filter((f) => f.enabled && f.key)) {
        const value = f.type === 'file' ? `@${i(f.value)}` : i(f.value);
        flags.push(`-F ${shq(`${i(f.key)}=${value}`)}`);
      }
    } else if (b.mode === 'binary' && b.binaryPath) {
      flags.push(`--data-binary ${shq(`@${i(b.binaryPath)}`)}`);
    }
  }

  let url = i(req.url);
  if (queryParts.length) {
    url += (url.includes('?') ? '&' : '?') + queryParts.join('&');
  }

  const lines = [
    `curl -X ${method} ${shq(url)}`,
    ...headers.map((h) => `-H ${shq(h)}`),
    ...flags,
  ];
  return lines.join(' \\\n  ');
}

/** Split a shell command into tokens (quotes and line continuations). */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let hasToken = false;
  for (let idx = 0; idx < command.length; idx++) {
    const ch = command[idx];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && '"\\$`'.includes(command[idx + 1] ?? '')) {
        current += command[++idx];
      } else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === '\\') {
      if (command[idx + 1] === '\n') idx++;
      else current += command[++idx] ?? '';
      continue;
    }
    if (/\s/.test(ch)) {
      if (current || hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
  }
  if (current || hasToken) tokens.push(current);
  return tokens;
}

const NO_ARG_FLAGS = new Set([
  '--compressed', '-s', '--silent', '-S', '--show-error', '-k', '--insecure',
  '-L', '--location', '-v', '--verbose', '-i', '--include', '-g', '--globoff',
  '-G', '--get', '-f', '--fail',
]);
const SKIP_ARG_FLAGS = new Set([
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '--retry',
  '-w', '--write-out', '--cacert', '--cert', '--key',
]);

/**
 * Parse a cURL command into request fields. Throws if no URL is found.
 */
export function parseCurl(command: string): Omit<ApiRequest, 'id'> {
  const tokens = tokenize(command.trim());
  if (tokens[0] === 'curl') tokens.shift();

  let method: HttpMethod | null = null;
  let url = '';
  const headers: KeyValue[] = [];
  const formData: FormDataField[] = [];
  const form: KeyValue[] = [];
  let data: string | null = null;
  let binaryPath = '';
  let basic: { username: string; password: string } | null = null;

  const next = (idx: number): string => tokens[idx + 1] ?? '';

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    if (t === '-X' || t === '--request') {
      const m = next(idx).toUpperCase();
      if ((HTTP_METHODS as string[]).includes(m)) method = m as HttpMethod;
      idx++;
    } else if (t === '-H' || t === '--header') {
      const raw = next(idx);
      const colon = raw.indexOf(':');
      if (colon > 0) {
        headers.push({
          key: raw.slice(0, colon).trim(),
          value: raw.slice(colon + 1).trim(),
          enabled: true,
        });
      }
      idx++;
    } else if (t === '-A' || t === '--user-agent') {
      headers.push({ key: 'User-Agent', value: next(idx), enabled: true });
      idx++;
    } else if (t === '-b' || t === '--cookie') {
      headers.push({ key: 'Cookie', value: next(idx), enabled: true });
      idx++;
    } else if (t === '-e' || t === '--referer') {
      headers.push({ key: 'Referer', value: next(idx), enabled: true });
      idx++;
    } else if (t === '-u' || t === '--user') {
      const raw = next(idx);
      const colon = raw.indexOf(':');
      basic =
        colon === -1
          ? { username: raw, password: '' }
          : { username: raw.slice(0, colon), password: raw.slice(colon + 1) };
      idx++;
    } else if (t === '-F' || t === '--form') {
      const raw = next(idx);
      const eq = raw.indexOf('=');
      if (eq > 0) {
        const value = raw.slice(eq + 1);
        formData.push(
          value.startsWith('@')
            ? { key: raw.slice(0, eq), value: value.slice(1), type: 'file', enabled: true }
            : { key: raw.slice(0, eq), value, type: 'text', enabled: true }
        );
      }
      idx++;
    } else if (t === '--data-urlencode') {
      const raw = next(idx);
      const eq = raw.indexOf('=');
      if (eq > 0) {
        form.push({ key: raw.slice(0, eq), value: raw.slice(eq + 1), enabled: true });
      }
      idx++;
    } else if (
      t === '-d' || t === '--data' || t === '--data-raw' ||
      t === '--data-ascii' || t === '--data-binary' || t === '--json'
    ) {
      const raw = next(idx);
      if (t === '--data-binary' && raw.startsWith('@')) binaryPath = raw.slice(1);
      else data = data === null ? raw : `${data}&${raw}`;
      if (t === '--json') {
        headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
      }
      idx++;
    } else if (t === '--url') {
      url = next(idx);
      idx++;
    } else if (SKIP_ARG_FLAGS.has(t)) {
      idx++;
    } else if (NO_ARG_FLAGS.has(t)) {
      // ignored
    } else if (!t.startsWith('-') && !url) {
      url = t;
    }
  }

  if (!url) throw new Error('Could not find a URL in that cURL command.');

  const contentType =
    headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
  const hasBody =
    data !== null || formData.length > 0 || form.length > 0 || binaryPath !== '';

  let mode: ApiRequest['body']['mode'] = 'none';
  let content = '';
  if (formData.length > 0) mode = 'formData';
  else if (binaryPath) mode = 'binary';
  else if (form.length > 0) mode = 'form';
  else if (data !== null) {
    mode = contentType.includes('json') ? 'json' : 'text';
    content = data;
  }

  let name = url;
  try {
    const u = new URL(url);
    name = u.pathname !== '/' ? u.pathname.split('/').filter(Boolean).pop() ?? u.hostname : u.hostname;
  } catch {
    // keep raw url as name
  }

  return {
    name,
    type: 'http',
    method: method ?? (hasBody ? 'POST' : 'GET'),
    url,
    params: [],
    headers,
    auth: basic ? { type: 'basic', basic } : { type: 'none' },
    body: { mode, content, form, formData, binaryPath },
    graphql: { query: '', variables: '' },
    websocket: { url: '', subprotocols: '', messages: [] },
    socketio: { url: '', path: '', auth: '', query: [], emitEvents: [], listenEvents: [] },
    docs: '',
    scripts: { preRequest: '', postResponse: '' },
  };
}
