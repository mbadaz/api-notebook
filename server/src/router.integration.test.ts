import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';

// Redirect app-local state (~/.apinotebook) to a temp home before importing the
// router (appData computes its dir at module load).
let app: Express;
let tmpHome: string;
let wsDir: string;
let target: http.Server;
let targetBase: string;

let WID: string;
let CID: string;
let RID: string;

beforeAll(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'apinb-home-'));
  wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apinb-wsdir-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  vi.resetModules();

  const { router } = await import('./router.js');
  const { HttpError } = await import('./workspaceFs.js');
  app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', router);
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      if (err instanceof HttpError) res.status(err.status).json({ error: err.message });
      else res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  );

  target = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, body: b }));
    });
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const addr = target.address();
  targetBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(wsDir, { recursive: true, force: true });
  return new Promise<void>((r) => target.close(() => r()));
});

describe('workspace/collection/request endpoints', () => {
  it('creates a workspace, collection and request', async () => {
    const ws = await request(app)
      .post('/api/workspaces')
      .send({ name: 'Router WS', path: wsDir })
      .expect(201);
    WID = ws.body.id;
    const col = await request(app)
      .post(`/api/workspaces/${WID}/collections`)
      .send({ name: 'C' })
      .expect(201);
    CID = col.body.id;
    const r = await request(app)
      .post(`/api/workspaces/${WID}/collections/${CID}/requests`)
      .send({ name: 'login', type: 'http' })
      .expect(201);
    RID = r.body.id;
    expect(WID && CID && RID).toBeTruthy();
  });

  it('persists collection scripts via PATCH (regression guard)', async () => {
    await request(app)
      .patch(`/api/workspaces/${WID}/collections/${CID}`)
      .send({ scripts: { preRequest: 'p()', postResponse: 't()' } })
      .expect(204);
    const tree = await request(app).get(`/api/workspaces/${WID}`).expect(200);
    const col = tree.body.collections.find((c: { id: string }) => c.id === CID);
    expect(col.scripts).toEqual({ preRequest: 'p()', postResponse: 't()' });
  });

  it('lists an empty cookie jar', async () => {
    const res = await request(app).get(`/api/workspaces/${WID}/cookies`).expect(200);
    expect(res.body).toEqual([]);
  });

  it('executes a request through the proxy and returns script results', async () => {
    // reset collection scripts so they don't interfere
    await request(app)
      .patch(`/api/workspaces/${WID}/collections/${CID}`)
      .send({ scripts: { preRequest: '', postResponse: '' } })
      .expect(204);

    const full = {
      id: RID,
      name: 'login',
      type: 'http',
      method: 'POST',
      url: `${targetBase}/x`,
      params: [],
      headers: [],
      auth: { type: 'none' },
      body: { mode: 'none', content: '', form: [], formData: [], binaryPath: '' },
      graphql: { query: '', variables: '' },
      docs: '',
      scripts: {
        preRequest: '',
        postResponse: 'pm.test("ok", () => pm.expect(pm.response.code).to.equal(200));',
      },
    };
    const res = await request(app)
      .post(`/api/workspaces/${WID}/execute`)
      .send({ request: full, collectionId: CID })
      .expect(200);
    expect(res.body.status).toBe(200);
    expect(res.body.script.tests[0]).toMatchObject({ name: 'ok', passed: true });
  });
});
