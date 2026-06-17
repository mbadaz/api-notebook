import { describe, expect, it } from 'vitest';
import {
  createRunState,
  effectiveVars,
  runScript,
  type MutableRequest,
  type ResponseView,
} from './scripting.js';

const mkReq = (over: Partial<MutableRequest> = {}): MutableRequest => ({
  method: 'GET',
  url: 'http://x/',
  headers: [],
  body: '',
  ...over,
});

describe('pm.environment / pm.variables', () => {
  it('sets, reads, unsets env vars and tracks changed keys', () => {
    const st = createRunState({ a: '1' }, mkReq(), true);
    const err = runScript(
      'pm.environment.set("b", "2"); pm.environment.unset("a");',
      st,
      null
    );
    expect(err).toBeUndefined();
    expect(st.envVars).toEqual({ b: '2' });
    expect([...st.changedEnvKeys].sort()).toEqual(['a', 'b']);
  });

  it('session vars overlay env vars for interpolation', () => {
    const st = createRunState({ a: 'env', c: '3' }, mkReq(), true);
    runScript('pm.variables.set("a", "sess"); pm.variables.set("b", "2");', st, null);
    expect(st.sessionVars).toEqual({ a: 'sess', b: '2' });
    expect(effectiveVars(st)).toEqual({ a: 'sess', b: '2', c: '3' });
  });

  it('records an error when setting an env var with no active environment', () => {
    const st = createRunState({}, mkReq(), false);
    const err = runScript('pm.environment.set("x", "1")', st, null);
    expect(err).toBeTruthy();
    expect(st.envVars.x).toBeUndefined();
  });
});

describe('pm.request mutation', () => {
  it('upserts/adds headers and sets method/url/body', () => {
    const st = createRunState({}, mkReq({ headers: [{ key: 'X', value: '1' }] }), true);
    runScript(
      [
        'pm.request.headers.upsert({ key: "X", value: "2" });',
        'pm.request.headers.add({ key: "X-Trace", value: "t" });',
        'pm.request.method = "POST";',
        'pm.request.url = "http://y/";',
        'pm.request.body.raw = "hi";',
      ].join('\n'),
      st,
      null
    );
    expect(st.request.method).toBe('POST');
    expect(st.request.url).toBe('http://y/');
    expect(st.request.body).toBe('hi');
    expect(st.request.headers).toEqual(
      expect.arrayContaining([
        { key: 'X', value: '2' },
        { key: 'X-Trace', value: 't' },
      ])
    );
  });
});

describe('pm.response, pm.test and pm.expect', () => {
  const resp: ResponseView = {
    code: 200,
    status: 'OK',
    responseTime: 5,
    headers: { 'content-type': 'application/json' },
    text: '{"token":"abc","n":2}',
  };

  it('reads the response, sets vars, and captures test pass/fail + logs', () => {
    const st = createRunState({}, mkReq(), true);
    const err = runScript(
      [
        'const d = pm.response.json();',
        'pm.environment.set("token", d.token);',
        'pm.test("status", () => pm.expect(pm.response.code).to.equal(200));',
        'pm.test("hasProp", () => pm.expect(d).to.have.property("n"));',
        'pm.test("textIncludes", () => pm.expect(pm.response.text()).to.include("abc"));',
        'pm.test("ctHeader", () => pm.expect(pm.response.headers.get("content-type")).to.include("json"));',
        'pm.test("notEqual", () => pm.expect(d.n).to.not.equal(3));',
        'pm.test("fails", () => pm.expect(d.n).to.equal(3));',
        'console.log("hi", 1);',
      ].join('\n'),
      st,
      resp
    );
    expect(err).toBeUndefined();
    expect(st.envVars.token).toBe('abc');
    const byName = Object.fromEntries(st.tests.map((t) => [t.name, t.passed]));
    expect(byName).toEqual({
      status: true,
      hasProp: true,
      textIncludes: true,
      ctHeader: true,
      notEqual: true,
      fails: false,
    });
    expect(st.tests.find((t) => t.name === 'fails')?.error).toMatch(/equal/);
    expect(st.logs).toContain('hi 1');
  });
});

describe('pm.cookies', () => {
  it('reads cookies for the request domain', () => {
    const st = createRunState({}, mkReq(), true);
    st.cookies = { session: 'abc' };
    runScript(
      'pm.test("c", () => pm.expect(pm.cookies.get("session")).to.equal("abc"));',
      st,
      null
    );
    expect(st.tests[0].passed).toBe(true);
  });
});

describe('sandbox containment', () => {
  it('does not expose require/process/fetch', () => {
    for (const code of ['require("fs")', 'process.env.HOME', 'fetch("http://x")']) {
      const st = createRunState({}, mkReq(), true);
      expect(runScript(code, st, null)).toBeTruthy();
    }
  });

  it('times out an infinite loop instead of hanging', () => {
    const st = createRunState({}, mkReq(), true);
    const err = runScript('while (true) {}', st, null);
    expect(err).toMatch(/timed out/i);
  }, 10_000);
});
