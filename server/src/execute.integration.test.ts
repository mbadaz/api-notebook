import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CookieJar } from 'tough-cookie';
import { executeRequest, runRequest } from './execute.js';
import { defaultRequest } from './workspaceFs.js';
import type { Environment, Scripts } from './types.js';

let server: http.Server;
let base: string;
const NO_SCRIPTS: Scripts = { preRequest: '', postResponse: '' };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/login')) {
        res.setHeader('Set-Cookie', ['session=s1; Path=/', 'theme=dark; Path=/']);
        res.end(JSON.stringify({ token: 'tok-1' }));
        return;
      }
      res.end(
        JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('executeRequest', () => {
  it('interpolates vars, appends query params, and applies auth headers', async () => {
    const req = {
      ...defaultRequest('r', 'echo', 'http'),
      url: '{{base}}/echo',
      method: 'GET' as const,
      params: [{ key: 'q', value: '1', enabled: true }],
      headers: [{ key: 'X-Test', value: 'yes', enabled: true }],
      auth: { type: 'bearer' as const, bearer: { token: '{{tok}}' } },
    };
    const result = await executeRequest(req, { base, tok: 'sekret' });
    expect(result.status).toBe(200);
    expect(result.bodyEncoding).toBe('text');
    const body = JSON.parse(result.body);
    expect(body.url).toContain('/echo?q=1');
    expect(body.headers['x-test']).toBe('yes');
    expect(body.headers['authorization']).toBe('Bearer sekret');
  });
});

describe('runRequest with scripts and a cookie jar', () => {
  const env = (): Environment => ({
    id: 'e',
    name: 'dev',
    variables: [
      { key: 'base', value: base, enabled: true },
      { key: 'token', value: '', enabled: true, secret: true },
    ],
  });

  it('runs the post-response script, captures Set-Cookie, and attaches cookies next time', async () => {
    const jar = new CookieJar();

    const login = {
      ...defaultRequest('r', 'login', 'http'),
      url: '{{base}}/login',
      method: 'POST' as const,
      scripts: {
        preRequest: '',
        postResponse:
          'pm.environment.set("token", pm.response.json().token); pm.test("ok", () => pm.expect(pm.response.code).to.equal(200));',
      },
    };
    const out = await runRequest(login, NO_SCRIPTS, env(), jar);
    expect(out.result.status).toBe(200);
    expect(out.changedEnvKeys).toContain('token');
    expect(out.envVars.token).toBe('tok-1');
    expect(out.result.script?.tests[0]).toMatchObject({ name: 'ok', passed: true });
    // both Set-Cookie headers preserved (not flattened into one)
    expect(out.result.headers['set-cookie'].split('\n')).toHaveLength(2);

    // a later request to the same host gets the captured cookies attached
    const echo = { ...defaultRequest('r2', 'echo', 'http'), url: '{{base}}/echo' };
    const out2 = await runRequest(echo, NO_SCRIPTS, env(), jar);
    const body = JSON.parse(out2.result.body);
    expect(body.headers.cookie).toContain('session=s1');
  });
});
