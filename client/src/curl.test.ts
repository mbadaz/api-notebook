import { describe, expect, it } from 'vitest';
import { parseCurl, requestToCurl } from './curl';
import type { ApiRequest } from './types';

const baseReq = (over: Partial<ApiRequest> = {}): ApiRequest => ({
  id: '1',
  name: 'r',
  type: 'http',
  method: 'GET',
  url: 'https://api.example.com/users',
  params: [],
  headers: [],
  auth: { type: 'none' },
  body: { mode: 'none', content: '', form: [], formData: [], binaryPath: '' },
  graphql: { query: '', variables: '' },
  docs: '',
  scripts: { preRequest: '', postResponse: '' },
  ...over,
});

describe('parseCurl', () => {
  it('parses a simple GET', () => {
    const r = parseCurl('curl https://api.example.com/users');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://api.example.com/users');
    expect(r.name).toBe('users');
  });

  it('parses method, headers and a JSON body', () => {
    const r = parseCurl(
      `curl -X POST https://x/u -H 'Content-Type: application/json' -d '{"a":1}'`
    );
    expect(r.method).toBe('POST');
    expect(r.headers.find((h) => h.key === 'Content-Type')?.value).toBe('application/json');
    expect(r.body).toMatchObject({ mode: 'json', content: '{"a":1}' });
  });

  it('parses basic auth and a cookie', () => {
    const r = parseCurl(`curl https://x -u me:pw -b 'sid=1'`);
    expect(r.auth).toEqual({ type: 'basic', basic: { username: 'me', password: 'pw' } });
    expect(r.headers.find((h) => h.key === 'Cookie')?.value).toBe('sid=1');
  });

  it('parses multipart form-data with a file field', () => {
    const r = parseCurl(`curl https://x -F 'f=@/tmp/a.png' -F 't=v'`);
    expect(r.body.mode).toBe('formData');
    expect(r.body.formData).toEqual([
      { key: 'f', value: '/tmp/a.png', type: 'file', enabled: true },
      { key: 't', value: 'v', type: 'text', enabled: true },
    ]);
  });

  it('parses a binary body and defaults to POST when a body is present', () => {
    const r = parseCurl(`curl https://x --data-binary @/tmp/x.bin`);
    expect(r.body).toMatchObject({ mode: 'binary', binaryPath: '/tmp/x.bin' });
    expect(r.method).toBe('POST');
  });

  it('throws when there is no URL', () => {
    expect(() => parseCurl('curl -X GET')).toThrow(/URL/i);
  });
});

describe('requestToCurl', () => {
  it('renders method, query, headers, json body and resolves variables', () => {
    const curl = requestToCurl(
      baseReq({
        method: 'POST',
        params: [{ key: 'q', value: '1', enabled: true }],
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        body: { mode: 'json', content: '{"name":"a"}', form: [], formData: [], binaryPath: '' },
      }),
      {}
    );
    expect(curl).toContain('-X POST');
    expect(curl).toContain("'https://api.example.com/users?q=1'");
    expect(curl).toContain("-H 'Accept: application/json'");
    expect(curl).toContain("-H 'Content-Type: application/json'");
    expect(curl).toContain(`--data-raw '{"name":"a"}'`);
  });

  it('resolves {{variables}} and renders bearer auth', () => {
    const curl = requestToCurl(
      baseReq({ url: '{{base}}/x', auth: { type: 'bearer', bearer: { token: '{{tok}}' } } }),
      { base: 'https://h', tok: 'T' }
    );
    expect(curl).toContain("'https://h/x'");
    expect(curl).toContain("-H 'Authorization: Bearer T'");
  });
});

describe('round-trip', () => {
  it('parseCurl(requestToCurl(req)) preserves method, body and headers', () => {
    const req = baseReq({
      method: 'POST',
      params: [{ key: 'q', value: '1', enabled: true }],
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      body: { mode: 'json', content: '{"name":"a"}', form: [], formData: [], binaryPath: '' },
    });
    const parsed = parseCurl(requestToCurl(req, {}));
    expect(parsed.method).toBe('POST');
    expect(parsed.url).toContain('?q=1');
    expect(parsed.body).toMatchObject({ mode: 'json', content: '{"name":"a"}' });
    expect(parsed.headers.find((h) => h.key === 'Accept')?.value).toBe('application/json');
  });
});
