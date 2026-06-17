import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CookieJar as CookieJarType } from 'tough-cookie';

// Redirect the cookie jar's storage dir to a temp home so tests never touch the
// real ~/.apinotebook. os.homedir() is spied *before* the module is imported,
// because cookies.ts computes its storage path at module-load time.
let tmpHome: string;
let cookies: typeof import('./cookies.js');
let CookieJar: typeof CookieJarType;

beforeAll(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'apinb-cookies-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  vi.resetModules();
  cookies = await import('./cookies.js');
  ({ CookieJar } = await import('tough-cookie'));
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('storeSetCookies / cookieMap (in-memory)', () => {
  it('stores a normal cookie and reads it back for the host', () => {
    const jar = new CookieJar();
    cookies.storeSetCookies(jar, 'http://localhost:3000/login', [
      'session=abc; Path=/; HttpOnly',
      'theme=dark; Path=/',
    ]);
    expect(cookies.cookieMap(jar, 'http://localhost:3000/me')).toEqual({
      session: 'abc',
      theme: 'dark',
    });
  });

  it('recovers a cookie whose Domain is an IP as host-only (the regression fix)', () => {
    const jar = new CookieJar();
    cookies.storeSetCookies(jar, 'http://127.0.0.1:8080/login', [
      'session=abc; Path=/; Domain=127.0.0.1; HttpOnly',
    ]);
    expect(cookies.cookieMap(jar, 'http://127.0.0.1:8080/me').session).toBe('abc');
  });
});

describe('attachCookies', () => {
  it('attaches jar cookies, with an explicit Cookie header winning per-name', () => {
    const jar = new CookieJar();
    cookies.storeSetCookies(jar, 'http://x.test/login', [
      'session=jar; Path=/',
      'theme=dark; Path=/',
    ]);
    const headers = new Headers();
    headers.set('cookie', 'session=explicit');
    cookies.attachCookies(jar, 'http://x.test/api', headers);
    const cookie = headers.get('cookie') ?? '';
    expect(cookie).toContain('session=explicit'); // explicit wins
    expect(cookie).toContain('theme=dark'); // jar adds the rest
    expect(cookie).not.toContain('session=jar');
  });
});

describe('persistence (temp home)', () => {
  it('saves, loads, lists, removes and clears', () => {
    expect(os.homedir()).toBe(tmpHome); // guard: never touch the real home

    const jar = new CookieJar();
    jar.setCookieSync('a=1; Path=/', 'http://example.com/');
    jar.setCookieSync('b=2; Path=/', 'http://example.com/');
    cookies.saveJar('ws1', jar);

    expect(cookies.listCookies('ws1').map((c) => c.key).sort()).toEqual(['a', 'b']);
    expect(cookies.loadJar('ws1').getCookieStringSync('http://example.com/')).toContain('a=1');

    cookies.removeCookie('ws1', { domain: 'example.com', path: '/', key: 'a' });
    expect(cookies.listCookies('ws1').map((c) => c.key)).toEqual(['b']);

    cookies.clearCookies('ws1');
    expect(cookies.listCookies('ws1')).toEqual([]);
  });
});
