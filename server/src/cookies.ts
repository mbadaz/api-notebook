import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CookieJar } from 'tough-cookie';

/**
 * Per-workspace cookie jar, persisted machine-local in ~/.apinotebook/cookies/
 * (never inside the workspace folder, so session cookies are not committed).
 * The jar captures Set-Cookie from responses and attaches matching cookies to
 * later requests, honoring domain/path/expiry/secure rules via tough-cookie.
 */

const COOKIE_DIR = path.join(os.homedir(), '.apinotebook', 'cookies');

function jarFile(workspaceId: string): string {
  return path.join(COOKIE_DIR, `${workspaceId}.json`);
}

export function loadJar(workspaceId: string): CookieJar {
  try {
    return CookieJar.fromJSON(fs.readFileSync(jarFile(workspaceId), 'utf8'));
  } catch {
    return new CookieJar();
  }
}

export function saveJar(workspaceId: string, jar: CookieJar): void {
  fs.mkdirSync(COOKIE_DIR, { recursive: true });
  fs.writeFileSync(jarFile(workspaceId), JSON.stringify(jar.toJSON()));
}

function parseCookieHeader(header: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key) map.set(key, part.slice(eq + 1).trim());
  }
  return map;
}

/**
 * Attaches the jar's matching cookies to the outgoing request. An explicit
 * Cookie header on the request wins for any cookie of the same name.
 */
export function attachCookies(jar: CookieJar, url: string, headers: Headers): void {
  let fromJar = '';
  try {
    fromJar = jar.getCookieStringSync(url);
  } catch {
    return;
  }
  const explicit = headers.get('cookie');
  if (!fromJar && !explicit) return;
  const merged = parseCookieHeader(fromJar);
  if (explicit) {
    for (const [k, v] of parseCookieHeader(explicit)) merged.set(k, v);
  }
  const value = [...merged].map(([k, v]) => `${k}=${v}`).join('; ');
  if (value) headers.set('cookie', value);
}

export function storeSetCookies(
  jar: CookieJar,
  url: string,
  setCookies: string[]
): void {
  for (const raw of setCookies) {
    try {
      jar.setCookieSync(raw, url, { ignoreError: true });
    } catch {
      // Skip cookies we can't parse or that don't match the URL.
    }
  }
}

/** Name→value map of cookies the jar would send to `url` (for pm.cookies). */
export function cookieMap(jar: CookieJar, url: string): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    for (const c of jar.getCookiesSync(url)) map[c.key] = c.value ?? '';
  } catch {
    // Invalid URL → no cookies.
  }
  return map;
}

export interface StoredCookie {
  domain: string;
  path: string;
  key: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
  expires: string | null;
}

interface SerializedCookie {
  domain?: string;
  path?: string;
  key?: string;
  value?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: string;
}

function readSerializedJar(workspaceId: string): { cookies?: SerializedCookie[] } {
  try {
    const data = JSON.parse(fs.readFileSync(jarFile(workspaceId), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function readCookies(workspaceId: string): SerializedCookie[] {
  const data = readSerializedJar(workspaceId);
  return Array.isArray(data.cookies) ? data.cookies : [];
}

export function listCookies(workspaceId: string): StoredCookie[] {
  return readCookies(workspaceId).map((c) => ({
    domain: c.domain ?? '',
    path: c.path ?? '/',
    key: c.key ?? '',
    value: c.value ?? '',
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    expires: c.expires && c.expires !== 'Infinity' ? c.expires : null,
  }));
}

export function removeCookie(
  workspaceId: string,
  target: { domain: string; path: string; key: string }
): void {
  const data = readSerializedJar(workspaceId);
  data.cookies = (data.cookies ?? []).filter(
    (c) =>
      !(c.domain === target.domain && c.path === target.path && c.key === target.key)
  );
  fs.mkdirSync(COOKIE_DIR, { recursive: true });
  fs.writeFileSync(jarFile(workspaceId), JSON.stringify(data));
}

export function clearCookies(workspaceId: string): void {
  saveJar(workspaceId, new CookieJar());
}
