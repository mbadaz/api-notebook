import type { CookieJar } from 'tough-cookie';
import { interpolate } from '../execute.js';
import type { AuthConfig } from '../types.js';
import type { DriverContext } from './driver.js';

/**
 * Applies the request's auth to outbound handshake headers (and, for an
 * apiKey placed in the query, to the URL). Shared by the live drivers so
 * WebSocket and Socket.IO connections authenticate like HTTP requests.
 */
export function applyAuth(
  headers: Record<string, string>,
  url: URL,
  auth: AuthConfig,
  vars: Record<string, string>
): void {
  switch (auth.type) {
    case 'bearer':
      headers['authorization'] = `Bearer ${interpolate(auth.bearer?.token ?? '', vars)}`;
      break;
    case 'basic': {
      const user = interpolate(auth.basic?.username ?? '', vars);
      const pass = interpolate(auth.basic?.password ?? '', vars);
      headers['authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
      break;
    }
    case 'apiKey': {
      const key = interpolate(auth.apiKey?.key ?? '', vars);
      const value = interpolate(auth.apiKey?.value ?? '', vars);
      if (key) {
        if (auth.apiKey?.placement === 'query') url.searchParams.append(key, value);
        else headers[key] = value;
      }
      break;
    }
  }
}

/** Looks up the workspace jar's Cookie header for a (ws/http) URL. */
export function cookieHeader(jar: CookieJar, url: URL): string {
  try {
    // Map ws→http so the jar matches; a no-op for http(s) URLs.
    const httpUrl = url.toString().replace(/^ws/, 'http');
    return jar.getCookieStringSync(httpUrl);
  } catch {
    return '';
  }
}

/** Builds handshake headers: interpolated request headers + auth + cookies. */
export function buildHandshakeHeaders(ctx: DriverContext, url: URL): Record<string, string> {
  const { request, vars, jar } = ctx;
  const headers: Record<string, string> = {};
  for (const h of request.headers) {
    if (h.enabled && h.key) headers[interpolate(h.key, vars)] = interpolate(h.value, vars);
  }
  applyAuth(headers, url, request.auth, vars);
  const cookie = cookieHeader(jar, url);
  if (cookie) headers['cookie'] = cookie;
  return headers;
}
