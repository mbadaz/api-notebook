import vm from 'node:vm';
import type { ScriptTestResult } from './types.js';

/**
 * A pragmatic Postman-compatible scripting sandbox. Scripts run in a fresh
 * `node:vm` context that exposes only `pm` and `console` — no `require`,
 * `process`, `fetch`, timers or other host globals — with a synchronous
 * execution timeout. This is NOT a hardened boundary against deliberately
 * malicious code; it is meant to safely run your own automation on your own
 * machine.
 */

const SCRIPT_TIMEOUT_MS = 2000;

export interface MutableRequest {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: string;
}

export interface ResponseView {
  code: number;
  status: string;
  responseTime: number;
  headers: Record<string, string>;
  text: string;
}

export interface ScriptRunState {
  /** Persistent scope, seeded from the active environment. */
  envVars: Record<string, string>;
  /** Transient scope for pm.variables.set, for this run only. */
  sessionVars: Record<string, string>;
  /** Env keys the scripts created, changed or removed. */
  changedEnvKeys: Set<string>;
  request: MutableRequest;
  hasActiveEnv: boolean;
  logs: string[];
  tests: ScriptTestResult[];
}

export function createRunState(
  envVars: Record<string, string>,
  request: MutableRequest,
  hasActiveEnv: boolean
): ScriptRunState {
  return {
    envVars: { ...envVars },
    sessionVars: {},
    changedEnvKeys: new Set(),
    request,
    hasActiveEnv,
    logs: [],
    tests: [],
  };
}

/** The variable map used for interpolation: environment overlaid by session. */
export function effectiveVars(state: ScriptRunState): Record<string, string> {
  return { ...state.envVars, ...state.sessionVars };
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function fmt(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

// A compact chai-like assertion. Chain words (to/be/have/…) are no-op getters;
// terminal checks are methods, except a few boolean getters (ok/true/…).
// Documented as a subset of chai.
function makeAssertion(actual: unknown, negated: boolean): Record<string, unknown> {
  const check = (cond: boolean, msg: string): void => {
    if (cond === negated) {
      throw new Error(`expected ${fmt(actual)} ${negated ? 'not ' : ''}${msg}`);
    }
  };
  const self: Record<string, unknown> = {};
  const chain = ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'of', 'same'];
  for (const word of chain) Object.defineProperty(self, word, { get: () => self });
  Object.defineProperty(self, 'not', {
    get: () => makeAssertion(actual, !negated),
  });
  Object.defineProperty(self, 'ok', { get: () => check(Boolean(actual), 'to be ok') });
  Object.defineProperty(self, 'true', { get: () => check(actual === true, 'to be true') });
  Object.defineProperty(self, 'false', { get: () => check(actual === false, 'to be false') });
  Object.defineProperty(self, 'null', { get: () => check(actual === null, 'to be null') });
  Object.defineProperty(self, 'undefined', {
    get: () => check(actual === undefined, 'to be undefined'),
  });
  Object.assign(self, {
    equal: (exp: unknown) => check(actual === exp, `to equal ${fmt(exp)}`),
    eql: (exp: unknown) => check(deepEqual(actual, exp), `to deeply equal ${fmt(exp)}`),
    a: (type: string) => check(typeof actual === type, `to be a ${type}`),
    an: (type: string) => check(typeof actual === type, `to be an ${type}`),
    above: (n: number) => check(Number(actual) > n, `to be above ${n}`),
    below: (n: number) => check(Number(actual) < n, `to be below ${n}`),
    status: (code: number) => check(actual === code, `to have status ${code}`),
    include: (sub: unknown) =>
      check(
        typeof actual === 'string'
          ? actual.includes(String(sub))
          : Array.isArray(actual) && actual.includes(sub),
        `to include ${fmt(sub)}`
      ),
    property: (name: string) =>
      check(
        actual != null && Object.prototype.hasOwnProperty.call(actual, name),
        `to have property ${name}`
      ),
  });
  return self;
}

function buildPm(state: ScriptRunState, response: ResponseView | null): unknown {
  const findHeader = (key: string) =>
    state.request.headers.find(
      (h) => h.key.toLowerCase() === key.toLowerCase()
    );

  const environment = {
    get: (key: string) => state.envVars[key],
    set: (key: string, value: unknown) => {
      if (!state.hasActiveEnv) {
        throw new Error(
          'pm.environment.set: no active environment is selected for this workspace'
        );
      }
      state.envVars[String(key)] = toStr(value);
      state.changedEnvKeys.add(String(key));
    },
    unset: (key: string) => {
      delete state.envVars[String(key)];
      state.changedEnvKeys.add(String(key));
    },
    has: (key: string) => Object.hasOwn(state.envVars, String(key)),
    toObject: () => ({ ...state.envVars }),
  };

  const variables = {
    get: (key: string) =>
      Object.hasOwn(state.sessionVars, key)
        ? state.sessionVars[key]
        : state.envVars[key],
    set: (key: string, value: unknown) => {
      state.sessionVars[String(key)] = toStr(value);
    },
    has: (key: string) =>
      Object.hasOwn(state.sessionVars, key) || Object.hasOwn(state.envVars, key),
  };

  const request = {
    get method() {
      return state.request.method;
    },
    set method(m: string) {
      state.request.method = String(m);
    },
    get url() {
      return state.request.url;
    },
    set url(u: string) {
      state.request.url = String(u);
    },
    headers: {
      add: (h: { key: string; value: string }) =>
        state.request.headers.push({ key: String(h.key), value: String(h.value) }),
      upsert: (h: { key: string; value: string }) => {
        const found = findHeader(h.key);
        if (found) found.value = String(h.value);
        else state.request.headers.push({ key: String(h.key), value: String(h.value) });
      },
      remove: (key: string) => {
        state.request.headers = state.request.headers.filter(
          (h) => h.key.toLowerCase() !== key.toLowerCase()
        );
      },
      get: (key: string) => findHeader(key)?.value,
    },
    body: {
      get raw() {
        return state.request.body;
      },
      set raw(v: string) {
        state.request.body = String(v);
      },
    },
  };

  const pmResponse = response
    ? {
        code: response.code,
        status: response.status,
        responseTime: response.responseTime,
        json: () => JSON.parse(response.text),
        text: () => response.text,
        headers: {
          get: (key: string) => response.headers[String(key).toLowerCase()],
        },
        to: makeAssertion(response.code, false),
      }
    : undefined;

  return {
    environment,
    variables,
    request,
    response: pmResponse,
    test: (name: string, fn: () => void) => {
      try {
        fn();
        state.tests.push({ name: String(name), passed: true });
      } catch (e) {
        state.tests.push({ name: String(name), passed: false, error: errMsg(e) });
      }
    },
    expect: (actual: unknown) => makeAssertion(actual, false),
  };
}

/**
 * Runs one script in the given phase. Returns an error message if the script
 * threw outside of a pm.test (the run otherwise continues).
 */
export function runScript(
  code: string,
  state: ScriptRunState,
  response: ResponseView | null
): string | undefined {
  if (!code.trim()) return undefined;
  const console = {
    log: (...args: unknown[]) => state.logs.push(args.map(fmt).join(' ')),
    info: (...args: unknown[]) => state.logs.push(args.map(fmt).join(' ')),
    warn: (...args: unknown[]) => state.logs.push(args.map(fmt).join(' ')),
    error: (...args: unknown[]) => state.logs.push(args.map(fmt).join(' ')),
  };
  const sandbox = { pm: buildPm(state, response), console };
  try {
    vm.runInNewContext(code, sandbox, { timeout: SCRIPT_TIMEOUT_MS });
    return undefined;
  } catch (e) {
    return errMsg(e);
  }
}
