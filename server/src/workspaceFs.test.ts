import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as wsfs from './workspaceFs.js';
import type { WorkspaceMeta } from './types.js';

let dir: string;
let ws: WorkspaceMeta;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apinb-ws-'));
  ws = wsfs.createWorkspace('Test WS', dir);
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(wsfs.slugify('Admin Ops!')).toBe('admin-ops');
    expect(wsfs.slugify('  Hello   World  ')).toBe('hello-world');
    expect(wsfs.slugify('***')).toBe('item');
  });
});

describe('collections & requests (round-trip)', () => {
  it('uniquifies slugs for same-named collections', () => {
    const a = wsfs.createCollection(ws, 'Users');
    const b = wsfs.createCollection(ws, 'Users');
    expect(a.id).toBe('users');
    expect(b.id).toBe('users-2');
  });

  it('persists a request (incl. scripts and docs) and reads it back', () => {
    const col = wsfs.createCollection(ws, 'C');
    const created = wsfs.createRequest(ws, col.id, 'Get user', 'http');
    const full = {
      ...created,
      method: 'POST' as const,
      url: '{{base}}/users/1',
      headers: [{ key: 'X-A', value: '1', enabled: true }],
      scripts: { preRequest: 'a()', postResponse: 'b()' },
      docs: '# Title\n\nbody',
    };
    wsfs.updateRequest(ws, col.id, created.id, full);

    const read = wsfs.getRequest(ws, col.id, created.id);
    expect(read.method).toBe('POST');
    expect(read.url).toBe('{{base}}/users/1');
    expect(read.scripts).toEqual({ preRequest: 'a()', postResponse: 'b()' });
    expect(read.docs).toContain('# Title');
    // docs are stored as a sibling .md file
    expect(
      fs.existsSync(path.join(dir, 'collections', col.id, 'requests', `${created.id}.md`))
    ).toBe(true);

    const tree = wsfs.readTree(ws, null);
    expect(tree.collections[0].requests.map((r) => r.name)).toContain('Get user');
  });

  it('back-fills missing fields when reading an older request file', () => {
    const col = wsfs.createCollection(ws, 'Old');
    const reqDir = path.join(dir, 'collections', col.id, 'requests');
    // A request written before body/scripts/graphql fields existed.
    fs.writeFileSync(
      path.join(reqDir, 'legacy.json'),
      JSON.stringify({
        name: 'Legacy',
        type: 'http',
        method: 'GET',
        url: 'http://x/',
        params: [],
        headers: [],
        auth: { type: 'none' },
      })
    );
    const read = wsfs.getRequest(ws, col.id, 'legacy');
    expect(read.body).toEqual({
      mode: 'none',
      content: '',
      form: [],
      formData: [],
      binaryPath: '',
    });
    expect(read.scripts).toEqual({ preRequest: '', postResponse: '' });
    expect(read.graphql).toEqual({ query: '', variables: '' });
  });
});

describe('environment secret split', () => {
  it('keeps secret values out of the shared file and merges them back on read', () => {
    const env = wsfs.createEnvironment(ws, 'dev');
    wsfs.updateEnvironment(ws, env.id, {
      name: 'dev',
      variables: [
        { key: 'base', value: 'http://x', enabled: true },
        { key: 'tok', value: 'secret', enabled: true, secret: true },
      ],
    });

    const sharedFile = path.join(dir, 'environments', `${env.id}.json`);
    const localFile = path.join(dir, 'environments', `${env.id}.local.json`);
    const shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
    const tok = shared.variables.find((v: { key: string }) => v.key === 'tok');
    expect(tok).toMatchObject({ key: 'tok', value: '', secret: true }); // value blanked
    expect(JSON.parse(fs.readFileSync(localFile, 'utf8'))).toEqual({
      values: { tok: 'secret' },
    });

    const merged = wsfs.getEnvironment(ws, env.id);
    expect(merged?.variables.find((v) => v.key === 'tok')?.value).toBe('secret');
  });
});
