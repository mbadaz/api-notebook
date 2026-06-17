import { describe, expect, it } from 'vitest';
import { applyEnvChanges, envToVars, interpolate } from './execute.js';
import type { Environment } from './types.js';

const env = (variables: Environment['variables']): Environment => ({
  id: 'e',
  name: 'dev',
  variables,
});

describe('interpolate', () => {
  it('replaces known variables', () => {
    expect(interpolate('{{base}}/users/{{id}}', { base: 'http://x', id: '5' })).toBe(
      'http://x/users/5'
    );
  });

  it('leaves unknown variables as literal tokens', () => {
    expect(interpolate('{{missing}}', {})).toBe('{{missing}}');
  });

  it('is prototype-safe — "constructor" is not treated as a variable', () => {
    expect(interpolate('{{constructor}}', {})).toBe('{{constructor}}');
  });
});

describe('envToVars', () => {
  it('includes enabled vars and skips disabled / empty-keyed ones', () => {
    expect(
      envToVars(
        env([
          { key: 'a', value: '1', enabled: true },
          { key: 'b', value: '2', enabled: false },
          { key: '', value: 'x', enabled: true },
        ])
      )
    ).toEqual({ a: '1' });
  });

  it('omits secret vars with no value so their token stays literal', () => {
    expect(
      envToVars(
        env([
          { key: 's', value: '', enabled: true, secret: true },
          { key: 't', value: 'tok', enabled: true, secret: true },
        ])
      )
    ).toEqual({ t: 'tok' });
  });

  it('returns an empty map for no environment', () => {
    expect(envToVars(undefined)).toEqual({});
  });
});

describe('applyEnvChanges', () => {
  const base = (): Environment =>
    env([
      { key: 'base', value: 'x', enabled: true },
      { key: 'token', value: '', enabled: true, secret: true },
    ]);

  it('updates an existing variable, preserving its secret flag', () => {
    const out = applyEnvChanges(base(), { base: 'x', token: 'abc' }, ['token']);
    expect(out.find((v) => v.key === 'token')).toMatchObject({
      key: 'token',
      value: 'abc',
      secret: true,
    });
  });

  it('appends a newly-created variable', () => {
    const out = applyEnvChanges(base(), { base: 'x', token: '', uid: '42' }, ['uid']);
    expect(out.find((v) => v.key === 'uid')).toMatchObject({ key: 'uid', value: '42' });
  });

  it('removes a variable that a script unset', () => {
    const out = applyEnvChanges(base(), { base: 'x' }, ['token']);
    expect(out.find((v) => v.key === 'token')).toBeUndefined();
  });
});
