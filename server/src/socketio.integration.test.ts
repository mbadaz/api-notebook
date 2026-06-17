import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { Server as IOServer } from 'socket.io';
import type { ApiRequest } from './types.js';

// Redirect app-local state (~/.apinotebook) to a temp home before importing the
// modules (appData/cookies compute their dirs at module load).
let tmpHome: string;
let wsDir: string;
let appServer: http.Server;
let liveUrl: string;
let echoHttp: http.Server;
let echo: IOServer;
let echoUrl: string;
let wsId: string;
let makeRequest: (over: Partial<ApiRequest>) => ApiRequest;

function listening(server: http.Server): Promise<void> {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r()));
}
function portOf(server: { address(): unknown }): number {
  const addr = server.address();
  return typeof addr === 'object' && addr ? (addr as { port: number }).port : 0;
}

beforeAll(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'apinb-home-'));
  wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apinb-wsdir-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  vi.resetModules();

  const wsfs = await import('./workspaceFs.js');
  const appData = await import('./appData.js');
  const { attachLiveSessions } = await import('./liveSessions.js');

  const meta = wsfs.createWorkspace('Live IO', wsDir);
  appData.addWorkspaceEntry({ id: meta.id, path: meta.path });
  wsId = meta.id;
  makeRequest = (over) => ({ ...wsfs.defaultRequest('r', 'r', 'socketio'), ...over });

  // In-test Socket.IO echo server (the "target"). Only the /chat namespace
  // echoes — the default namespace stays silent — so the test fails unless the
  // driver preserves the URL pathname as the namespace.
  echoHttp = http.createServer();
  echo = new IOServer(echoHttp);
  echo.of('/chat').on('connection', (socket) => {
    socket.onAny((event: string, ...args: unknown[]) => socket.emit(event, ...args));
  });
  await listening(echoHttp);
  echoUrl = `http://127.0.0.1:${portOf(echoHttp)}/chat`;

  // Our server with the live channel attached.
  appServer = http.createServer();
  attachLiveSessions(appServer);
  await listening(appServer);
  liveUrl = `ws://127.0.0.1:${portOf(appServer)}/live`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await echo.close();
  await new Promise<void>((r) => echoHttp.close(() => r()));
  await new Promise<void>((r) => appServer.close(() => r()));
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(wsDir, { recursive: true, force: true });
});

interface Frame {
  t: string;
  sessionId: string;
  payload?: { event?: string; args?: unknown[]; message?: string };
}

describe('live channel — Socket.IO', () => {
  it('connects, emits an event, and echoes it back', async () => {
    const client = new WebSocket(liveUrl);
    await new Promise<void>((r) => client.once('open', () => r()));

    const nextFrame = (pred: (f: Frame) => boolean): Promise<Frame> =>
      new Promise((resolve) => {
        const onMsg = (d: WebSocket.RawData) => {
          const f = JSON.parse(d.toString()) as Frame;
          if (pred(f)) {
            client.off('message', onMsg);
            resolve(f);
          }
        };
        client.on('message', onMsg);
      });

    const request = makeRequest({
      socketio: { url: echoUrl, path: '', auth: '', query: [], emitEvents: [], listenEvents: [] },
    });
    client.send(
      JSON.stringify({ t: 'connect', sessionId: 'S1', workspaceId: wsId, request })
    );
    const opened = await nextFrame((f) => f.t === 'open' && f.sessionId === 'S1');
    expect(opened.t).toBe('open');

    client.send(
      JSON.stringify({ t: 'send', sessionId: 'S1', payload: { event: 'chat', args: ['hello'] } })
    );
    const msg = await nextFrame((f) => f.t === 'message' && f.sessionId === 'S1');
    expect(msg.payload?.event).toBe('chat');
    expect(msg.payload?.args).toEqual(['hello']);

    client.send(JSON.stringify({ t: 'close', sessionId: 'S1' }));
    const closed = await nextFrame((f) => f.t === 'closed' && f.sessionId === 'S1');
    expect(closed.t).toBe('closed');

    client.close();
  });

  it('reports an error for an invalid target URL', async () => {
    const client = new WebSocket(liveUrl);
    await new Promise<void>((r) => client.once('open', () => r()));
    const request = makeRequest({
      socketio: { url: 'ftp://nope/', path: '', auth: '', query: [], emitEvents: [], listenEvents: [] },
    });
    const errored = new Promise<Frame>((resolve) => {
      client.on('message', (d) => {
        const f = JSON.parse(d.toString()) as Frame;
        if (f.t === 'error' && f.sessionId === 'S2') resolve(f);
      });
    });
    client.send(
      JSON.stringify({ t: 'connect', sessionId: 'S2', workspaceId: wsId, request })
    );
    const f = await errored;
    expect(f.payload?.message).toMatch(/Socket\.IO URL/);
    client.close();
  });
});
