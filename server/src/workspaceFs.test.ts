import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as wsfs from './workspaceFs.js';
import type { ExecutionResult, WorkspaceMeta } from './types.js';

const mkResult = (status: number): ExecutionResult => ({
  status,
  statusText: 'OK',
  headers: {},
  body: `{"n":${status}}`,
  bodyEncoding: 'text',
  timeMs: 1,
  sizeBytes: 8,
  resolvedUrl: 'http://x/',
});

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
    const created = wsfs.createRequest(ws, col.id, [], 'Get user', 'http');
    const full = {
      ...created,
      method: 'POST' as const,
      url: '{{base}}/users/1',
      headers: [{ key: 'X-A', value: '1', enabled: true }],
      scripts: { preRequest: 'a()', postResponse: 'b()' },
      docs: '# Title\n\nbody',
    };
    wsfs.updateRequest(ws, col.id, [], created.id, full);

    const read = wsfs.getRequest(ws, col.id, [], created.id);
    expect(read.method).toBe('POST');
    expect(read.url).toBe('{{base}}/users/1');
    expect(read.scripts).toEqual({ preRequest: 'a()', postResponse: 'b()' });
    expect(read.docs).toContain('# Title');
    // docs are stored as a sibling .md file in the collection directory
    expect(
      fs.existsSync(path.join(dir, 'collections', col.id, `${created.id}.md`))
    ).toBe(true);

    const tree = wsfs.readTree(ws, null);
    expect(tree.collections[0].requests.map((r) => r.name)).toContain('Get user');
  });

  it('round-trips folders, nesting and folder-level metadata', () => {
    const col = wsfs.createCollection(ws, 'API');
    const outer = wsfs.createFolder(ws, col.id, [], 'Outer');
    const inner = wsfs.createFolder(ws, col.id, [outer.id], 'Inner');
    wsfs.updateFolder(ws, col.id, [outer.id, inner.id], {
      description: 'inner docs',
      scripts: { preRequest: 'inPre()', postResponse: '' },
    });
    const req = wsfs.createRequest(ws, col.id, [outer.id, inner.id], 'Deep', 'http');

    expect(wsfs.getRequest(ws, col.id, [outer.id, inner.id], req.id).name).toBe('Deep');

    const collection = wsfs
      .readTree(ws, null)
      .collections.find((c) => c.id === col.id)!;
    const readInner = collection.folders[0].folders[0];
    expect(collection.folders[0].name).toBe('Outer');
    expect(readInner.name).toBe('Inner');
    expect(readInner.description).toBe('inner docs');
    expect(readInner.requests.map((r) => r.name)).toEqual(['Deep']);
  });

  it('combines collection and folder scripts down the chain', () => {
    const col = wsfs.createCollection(ws, 'Chain');
    wsfs.updateCollection(ws, col.id, {
      scripts: { preRequest: 'colPre()', postResponse: 'colTest()' },
    });
    const f = wsfs.createFolder(ws, col.id, [], 'F');
    wsfs.updateFolder(ws, col.id, [f.id], {
      scripts: { preRequest: 'fPre()', postResponse: '' },
    });
    const chain = wsfs.getScriptChain(ws, col.id, [f.id]);
    expect(chain.preRequest).toBe('colPre()\n\nfPre()');
    expect(chain.postResponse).toBe('colTest()');
  });

  it('deletes a folder and everything inside it', () => {
    const col = wsfs.createCollection(ws, 'Del');
    const f = wsfs.createFolder(ws, col.id, [], 'Gone');
    wsfs.createRequest(ws, col.id, [f.id], 'Doomed', 'http');
    wsfs.deleteFolder(ws, col.id, [f.id]);
    const collection = wsfs
      .readTree(ws, null)
      .collections.find((c) => c.id === col.id)!;
    expect(collection.folders).toEqual([]);
  });

  it('persists a websocket request with its config and saved messages', () => {
    const col = wsfs.createCollection(ws, 'WS');
    const created = wsfs.createRequest(ws, col.id, [], 'Socket', 'websocket');
    expect(created.websocket).toEqual({ url: '', subprotocols: '', messages: [] });
    wsfs.updateRequest(ws, col.id, [], created.id, {
      ...created,
      websocket: {
        url: 'wss://x/socket',
        subprotocols: 'json',
        messages: [{ name: 'ping', content: '{"op":"ping"}' }],
      },
    });
    const read = wsfs.getRequest(ws, col.id, [], created.id);
    expect(read.type).toBe('websocket');
    expect(read.websocket.url).toBe('wss://x/socket');
    expect(read.websocket.messages).toEqual([{ name: 'ping', content: '{"op":"ping"}' }]);
  });

  it('persists a socketio request with its config and saved emits', () => {
    const col = wsfs.createCollection(ws, 'IO');
    const created = wsfs.createRequest(ws, col.id, [], 'Live', 'socketio');
    expect(created.socketio).toEqual({
      url: '',
      path: '',
      auth: '',
      query: [],
      emitEvents: [],
      listenEvents: [],
    });
    wsfs.updateRequest(ws, col.id, [], created.id, {
      ...created,
      socketio: {
        url: 'https://x',
        path: '/ws',
        auth: '{"token":"t"}',
        query: [{ key: 'room', value: 'lobby', enabled: true }],
        emitEvents: [{ name: 'chat', content: '["hi"]' }],
        listenEvents: ['chat', 'pong'],
      },
    });
    const read = wsfs.getRequest(ws, col.id, [], created.id);
    expect(read.type).toBe('socketio');
    expect(read.socketio.url).toBe('https://x');
    expect(read.socketio.emitEvents).toEqual([{ name: 'chat', content: '["hi"]' }]);
    expect(read.socketio.listenEvents).toEqual(['chat', 'pong']);
  });

  it('persists an mcp request with its url', () => {
    const col = wsfs.createCollection(ws, 'MCP');
    const created = wsfs.createRequest(ws, col.id, [], 'Agent', 'mcp');
    expect(created.mcp).toEqual({ url: '' });
    wsfs.updateRequest(ws, col.id, [], created.id, {
      ...created,
      mcp: { url: 'https://mcp.example.com/mcp' },
    });
    const read = wsfs.getRequest(ws, col.id, [], created.id);
    expect(read.type).toBe('mcp');
    expect(read.mcp.url).toBe('https://mcp.example.com/mcp');
  });

  it('back-fills missing fields and reads a legacy requests/ subdir', () => {
    const col = wsfs.createCollection(ws, 'Old');
    // Pre-folders workspaces stored requests in a legacy requests/ subdir.
    const reqDir = path.join(dir, 'collections', col.id, 'requests');
    fs.mkdirSync(reqDir, { recursive: true });
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
    // The legacy request still surfaces at the collection root.
    const collection = wsfs
      .readTree(ws, null)
      .collections.find((c) => c.id === col.id)!;
    expect(collection.requests.map((r) => r.id)).toContain('legacy');

    const read = wsfs.getRequest(ws, col.id, [], 'legacy');
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

describe('move (reparent)', () => {
  it('moves a request into a folder and back out', () => {
    const col = wsfs.createCollection(ws, 'M');
    const folder = wsfs.createFolder(ws, col.id, [], 'Sub');
    const req = wsfs.createRequest(ws, col.id, [], 'Item', 'http');

    const moved = wsfs.moveRequest(
      ws,
      { collectionId: col.id, folderPath: [], requestId: req.id },
      { collectionId: col.id, folderPath: [folder.id] }
    );
    expect(moved.folderPath).toEqual([folder.id]);

    const collection = wsfs
      .readTree(ws, null)
      .collections.find((c) => c.id === col.id)!;
    expect(collection.requests).toEqual([]);
    expect(collection.folders[0].requests.map((r) => r.id)).toEqual([req.id]);
  });

  it('moves a request across collections, uniquifying a colliding slug', () => {
    const a = wsfs.createCollection(ws, 'A');
    const b = wsfs.createCollection(ws, 'B');
    const src = wsfs.createRequest(ws, a.id, [], 'Get', 'http');
    wsfs.createRequest(ws, b.id, [], 'Get', 'http'); // occupies the "get" slug in B

    const moved = wsfs.moveRequest(
      ws,
      { collectionId: a.id, folderPath: [], requestId: src.id },
      { collectionId: b.id, folderPath: [] }
    );
    expect(moved.collectionId).toBe(b.id);
    expect(moved.requestId).toBe('get-2');
    const bCol = wsfs.readTree(ws, null).collections.find((c) => c.id === b.id)!;
    expect(bCol.requests.map((r) => r.id).sort()).toEqual(['get', 'get-2']);
  });

  it('moves a folder under another folder', () => {
    const col = wsfs.createCollection(ws, 'F');
    const outer = wsfs.createFolder(ws, col.id, [], 'Outer');
    const loose = wsfs.createFolder(ws, col.id, [], 'Loose');
    wsfs.createRequest(ws, col.id, [loose.id], 'Inside', 'http');

    const moved = wsfs.moveFolder(
      ws,
      { collectionId: col.id, folderPath: [loose.id] },
      { collectionId: col.id, folderPath: [outer.id] }
    );
    expect(moved.folderPath).toEqual([outer.id, loose.id]);

    const collection = wsfs
      .readTree(ws, null)
      .collections.find((c) => c.id === col.id)!;
    expect(collection.folders.map((f) => f.id)).toEqual([outer.id]);
    const nested = collection.folders[0].folders[0];
    expect(nested.id).toBe(loose.id);
    expect(nested.requests.map((r) => r.name)).toEqual(['Inside']);
  });

  it('refuses to move a folder into its own descendant', () => {
    const col = wsfs.createCollection(ws, 'G');
    const parent = wsfs.createFolder(ws, col.id, [], 'Parent');
    const child = wsfs.createFolder(ws, col.id, [parent.id], 'Child');
    expect(() =>
      wsfs.moveFolder(
        ws,
        { collectionId: col.id, folderPath: [parent.id] },
        { collectionId: col.id, folderPath: [parent.id, child.id] }
      )
    ).toThrow(/itself or its own subfolder/);
  });
});

describe('response history', () => {
  it('keeps only the last 3 responses, newest first, with a savedAt', () => {
    const col = wsfs.createCollection(ws, 'R');
    const req = wsfs.createRequest(ws, col.id, [], 'Ping', 'http');
    for (const code of [200, 201, 202, 500]) {
      wsfs.saveResponse(ws, col.id, [], req.id, mkResult(code));
    }
    const history = wsfs.getResponses(ws, col.id, [], req.id);
    expect(history.map((r) => r.status)).toEqual([500, 202, 201]);
    expect(history[0].savedAt).toBeTruthy();
  });

  it('does not surface the response file as a request, and gitignores it', () => {
    const col = wsfs.createCollection(ws, 'R2');
    const req = wsfs.createRequest(ws, col.id, [], 'Once', 'http');
    wsfs.saveResponse(ws, col.id, [], req.id, mkResult(200));

    const collection = wsfs
      .readTree(ws, null)
      .collections.find((c) => c.id === col.id)!;
    expect(collection.requests.map((r) => r.id)).toEqual([req.id]);

    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('*.response.json');
  });

  it('drops the history when the request is deleted and moves it on reparent', () => {
    const col = wsfs.createCollection(ws, 'R3');
    const folder = wsfs.createFolder(ws, col.id, [], 'F');
    const req = wsfs.createRequest(ws, col.id, [], 'Move', 'http');
    wsfs.saveResponse(ws, col.id, [], req.id, mkResult(200));

    const moved = wsfs.moveRequest(
      ws,
      { collectionId: col.id, folderPath: [], requestId: req.id },
      { collectionId: col.id, folderPath: [folder.id] }
    );
    expect(wsfs.getResponses(ws, col.id, [], req.id)).toEqual([]);
    expect(
      wsfs.getResponses(ws, col.id, [folder.id], moved.requestId).map((r) => r.status)
    ).toEqual([200]);

    wsfs.deleteRequest(ws, col.id, [folder.id], moved.requestId);
    expect(wsfs.getResponses(ws, col.id, [folder.id], moved.requestId)).toEqual([]);
  });

  it('no-ops saving a response for a request that does not exist', () => {
    const col = wsfs.createCollection(ws, 'R4');
    wsfs.saveResponse(ws, col.id, [], 'ghost', mkResult(200));
    expect(wsfs.getResponses(ws, col.id, [], 'ghost')).toEqual([]);
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
