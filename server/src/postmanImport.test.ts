import { describe, expect, it } from 'vitest';
import {
  convertCollection,
  convertEnvironment,
  detectPostmanKind,
  hasScripts,
} from './postmanImport.js';

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

describe('detectPostmanKind', () => {
  it('detects collections and environments', () => {
    expect(detectPostmanKind({ info: { schema: SCHEMA }, item: [] })).toBe('collection');
    expect(
      detectPostmanKind({ name: 'dev', _postman_variable_scope: 'environment', values: [] })
    ).toBe('environment');
    expect(detectPostmanKind({ values: [] })).toBe('environment');
    expect(detectPostmanKind({ hello: 'world' })).toBeNull();
    expect(detectPostmanKind(null)).toBeNull();
  });
});

describe('convertCollection', () => {
  const collection = {
    info: { name: 'My API', schema: SCHEMA },
    event: [{ listen: 'prerequest', script: { exec: ['rootPre()'] } }],
    item: [
      {
        name: 'Folder',
        event: [{ listen: 'test', script: { exec: ['folderTest()'] } }],
        item: [
          {
            name: 'Create thing',
            event: [{ listen: 'test', script: { exec: ['reqTest()'] } }],
            request: {
              method: 'POST',
              header: [{ key: 'X-A', value: '1' }],
              url: {
                raw: '{{base}}/things?q=1&page=2',
                host: ['{{base}}'],
                path: ['things'],
                query: [
                  { key: 'q', value: '1' },
                  { key: 'page', value: '2' },
                  { key: '', value: '', disabled: true },
                ],
              },
              auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}' }] },
              body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
              description: 'Creates a thing.',
            },
          },
        ],
      },
      { name: 'Root req', request: { method: 'GET', url: { raw: '{{base}}/root' } } },
    ],
  };

  const { groups } = convertCollection(collection as never);
  const folder = groups.find((g) => g.name === 'Folder')!;
  const root = groups.find((g) => g.name === 'My API')!;
  const req = folder.requests[0];

  it('groups folders into collections and root requests under the collection name', () => {
    expect(groups.map((g) => g.name).sort()).toEqual(['Folder', 'My API']);
    expect(root.requests[0].name).toBe('Root req');
  });

  it('inherits collection scripts into folders and keeps request scripts', () => {
    expect(folder.scripts.preRequest).toBe('rootPre()'); // inherited from collection root
    expect(folder.scripts.postResponse).toBe('folderTest()');
    expect(root.scripts.preRequest).toBe('rootPre()');
    expect(req.scripts.postResponse).toBe('reqTest()');
  });

  it('maps method, URL (query split out), headers, auth, body and docs', () => {
    expect(req.method).toBe('POST');
    expect(req.url).toBe('{{base}}/things');
    expect(req.params).toEqual([
      { key: 'q', value: '1', enabled: true },
      { key: 'page', value: '2', enabled: true },
    ]);
    expect(req.headers).toEqual([{ key: 'X-A', value: '1', enabled: true }]);
    expect(req.auth).toEqual({ type: 'bearer', bearer: { token: '{{tok}}' } });
    expect(req.body.mode).toBe('json');
    expect(req.body.content).toBe('{"a":1}');
    expect(req.docs).toBe('Creates a thing.');
  });

  it('maps the various body modes', () => {
    const bodies = {
      info: { name: 'B', schema: SCHEMA },
      item: [
        {
          name: 'form',
          request: {
            method: 'POST',
            url: { raw: 'http://x/' },
            body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] },
          },
        },
        {
          name: 'multipart',
          request: {
            method: 'POST',
            url: { raw: 'http://x/' },
            body: {
              mode: 'formdata',
              formdata: [
                { key: 'f', type: 'file', src: ['/tmp/a.png', '/tmp/b.png'] },
                { key: 't', type: 'text', value: 'v' },
              ],
            },
          },
        },
        {
          name: 'binary',
          request: {
            method: 'POST',
            url: { raw: 'http://x/' },
            body: { mode: 'file', file: { src: '/tmp/x.bin' } },
          },
        },
        {
          name: 'graphql',
          request: {
            method: 'POST',
            url: { raw: 'http://x/' },
            body: { mode: 'graphql', graphql: { query: 'query { me }', variables: '{}' } },
          },
        },
      ],
    };
    const reqs = convertCollection(bodies as never).groups[0].requests;
    const byName = Object.fromEntries(reqs.map((r) => [r.name, r]));
    expect(byName.form.body).toMatchObject({
      mode: 'form',
      form: [{ key: 'a', value: '1', enabled: true }],
    });
    expect(byName.multipart.body.formData).toEqual([
      { key: 'f', value: '/tmp/a.png', type: 'file', enabled: true },
      { key: 't', value: 'v', type: 'text', enabled: true },
    ]);
    expect(byName.binary.body).toMatchObject({ mode: 'binary', binaryPath: '/tmp/x.bin' });
    expect(byName.graphql.type).toBe('graphql');
    expect(byName.graphql.graphql).toEqual({ query: 'query { me }', variables: '{}' });
  });
});

describe('convertEnvironment', () => {
  it('maps values to variables and flags secrets', () => {
    const { name, variables } = convertEnvironment({
      name: 'dev',
      values: [
        { key: 'base', value: 'http://x', type: 'default', enabled: true },
        { key: 'tok', value: 'secret', type: 'secret', enabled: true },
        { key: '', value: 'skip', enabled: true },
      ],
    } as never);
    expect(name).toBe('dev');
    expect(variables).toEqual([
      { key: 'base', value: 'http://x', enabled: true },
      { key: 'tok', value: 'secret', enabled: true, secret: true },
    ]);
  });
});

describe('hasScripts', () => {
  it('is true only when a script is non-empty', () => {
    expect(hasScripts({ preRequest: 'x', postResponse: '' })).toBe(true);
    expect(hasScripts({ preRequest: '', postResponse: '' })).toBe(false);
  });
});
