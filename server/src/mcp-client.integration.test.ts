import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { ApiRequest } from './types.js';

// Redirect app-local state (~/.apinotebook) to a temp home before importing the
// modules (appData/cookies compute their dirs at module load).
let tmpHome: string;
let wsDir: string;
let appServer: http.Server;
let liveUrl: string;
let mcpHttp: http.Server;
let mcpUrl: string;
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

  const meta = wsfs.createWorkspace('Live MCP', wsDir);
  appData.addWorkspaceEntry({ id: meta.id, path: meta.path });
  wsId = meta.id;
  makeRequest = (over) => ({ ...wsfs.defaultRequest('r', 'r', 'mcp'), ...over });

  // In-test MCP server (Streamable HTTP) exposing one echo tool.
  const mcpApp = express();
  mcpApp.use(express.json());
  mcpApp.post('/mcp', async (req, res) => {
    const server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
    server.registerTool(
      'echo',
      { description: 'Echoes the text back', inputSchema: { text: z.string() } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any) => ({ content: [{ type: 'text', text: args.text }] })) as never
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  mcpHttp = http.createServer(mcpApp);
  await listening(mcpHttp);
  mcpUrl = `http://127.0.0.1:${portOf(mcpHttp)}/mcp`;

  // Our server with the live channel attached.
  appServer = http.createServer();
  attachLiveSessions(appServer);
  await listening(appServer);
  liveUrl = `ws://127.0.0.1:${portOf(appServer)}/live`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((r) => mcpHttp.close(() => r()));
  await new Promise<void>((r) => appServer.close(() => r()));
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(wsDir, { recursive: true, force: true });
});

interface ToolInfo {
  name: string;
  description?: string;
}
interface Frame {
  t: string;
  sessionId: string;
  payload?: {
    kind?: string;
    tools?: ToolInfo[];
    callId?: string;
    result?: { isError?: boolean; content?: { type: string; text?: string }[] };
    message?: string;
  };
}

describe('live channel — MCP (HTTP)', () => {
  it('connects, lists tools, and calls a tool', async () => {
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

    const request = makeRequest({ mcp: { url: mcpUrl } });
    client.send(
      JSON.stringify({ t: 'connect', sessionId: 'M1', workspaceId: wsId, request })
    );
    await nextFrame((f) => f.t === 'open' && f.sessionId === 'M1');

    client.send(JSON.stringify({ t: 'send', sessionId: 'M1', payload: { op: 'listTools' } }));
    const tools = await nextFrame(
      (f) => f.t === 'message' && f.payload?.kind === 'tools'
    );
    expect(tools.payload?.tools?.map((t) => t.name)).toContain('echo');

    client.send(
      JSON.stringify({
        t: 'send',
        sessionId: 'M1',
        payload: { op: 'callTool', callId: 'c1', name: 'echo', args: { text: 'hi there' } },
      })
    );
    const result = await nextFrame(
      (f) => f.t === 'message' && f.payload?.kind === 'result' && f.payload?.callId === 'c1'
    );
    expect(result.payload?.result?.isError).toBeFalsy();
    expect(result.payload?.result?.content?.[0]?.text).toBe('hi there');

    client.send(JSON.stringify({ t: 'close', sessionId: 'M1' }));
    client.close();
  });

  it('reports an error for an invalid target URL', async () => {
    const client = new WebSocket(liveUrl);
    await new Promise<void>((r) => client.once('open', () => r()));
    const request = makeRequest({ mcp: { url: 'ftp://nope/' } });
    const errored = new Promise<Frame>((resolve) => {
      client.on('message', (d) => {
        const f = JSON.parse(d.toString()) as Frame;
        if (f.t === 'error' && f.sessionId === 'M2') resolve(f);
      });
    });
    client.send(
      JSON.stringify({ t: 'connect', sessionId: 'M2', workspaceId: wsId, request })
    );
    const f = await errored;
    expect(f.payload?.message).toMatch(/MCP URL/);
    client.close();
  });
});
