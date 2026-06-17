import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import * as appData from './appData.js';
import * as cookies from './cookies.js';
import { envToVars } from './execute.js';
import * as wsfs from './workspaceFs.js';
import type { ApiRequest } from './types.js';
import type { DriverContext, Emit, LiveDriver } from './live/driver.js';
import { createWsDriver } from './live/wsDriver.js';
import { createSocketioDriver } from './live/socketioDriver.js';

/**
 * The live channel: a single browser WebSocket (at /live) multiplexes many
 * streaming sessions (WebSocket/Socket.IO/MCP), each keyed by a sessionId. The
 * Node server owns every outbound connection so {{var}} interpolation, the
 * cookie jar, and auth stay consistent with HTTP requests.
 *
 * Server→client frames all share the shape { t, sessionId, payload, ts }:
 *   open    → payload: connection info (e.g. { protocol })
 *   message → payload: protocol-specific message
 *   error   → payload: { message }
 *   closed  → payload: { code?, reason? }
 */

const MAX_SESSIONS_PER_SOCKET = 16;
const MAX_SESSIONS_GLOBAL = 200;
// Bound resource leaks: a session is force-closed after this long.
const SESSION_MAX_MS = 60 * 60_000;

interface ConnectFrame {
  t: 'connect';
  sessionId: string;
  workspaceId: string;
  request: ApiRequest;
}
interface SendFrame {
  t: 'send';
  sessionId: string;
  payload: unknown;
}
interface CloseFrame {
  t: 'close';
  sessionId: string;
}
type ClientFrame = ConnectFrame | SendFrame | CloseFrame;

interface Session {
  driver: LiveDriver;
  lifetime: NodeJS.Timeout;
}

let globalSessions = 0;

function driverFor(type: ApiRequest['type'], ctx: DriverContext): LiveDriver {
  switch (type) {
    case 'websocket':
      return createWsDriver(ctx);
    case 'socketio':
      return createSocketioDriver(ctx);
    default:
      throw new Error(`Protocol "${type}" is not supported on the live channel`);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function attachLiveSessions(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/live', maxPayload: 1 << 20 });

  wss.on('connection', (socket: WebSocket) => {
    const sessions = new Map<string, Session>();

    const send = (sessionId: string, t: string, payload?: unknown) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ t, sessionId, payload, ts: Date.now() }));
      }
    };
    const fail = (sessionId: string, message: string) =>
      send(sessionId, 'error', { message });

    const cleanup = (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (!session) return;
      sessions.delete(sessionId);
      globalSessions--;
      clearTimeout(session.lifetime);
      try {
        session.driver.close();
      } catch {
        // best-effort teardown
      }
    };

    const startSession = (frame: ConnectFrame) => {
      const { sessionId, workspaceId, request } = frame;
      if (sessions.has(sessionId)) return;
      if (
        sessions.size >= MAX_SESSIONS_PER_SOCKET ||
        globalSessions >= MAX_SESSIONS_GLOBAL
      ) {
        fail(sessionId, 'Too many open connections');
        return;
      }

      let driver: LiveDriver;
      try {
        const entry = appData.findWorkspaceEntry(workspaceId);
        if (!entry) throw new Error(`Workspace "${workspaceId}" is not registered`);
        const ws = wsfs.openWorkspace(entry.path);
        const activeId = appData.getActiveEnvironmentId(ws.id);
        const env = activeId ? wsfs.getEnvironment(ws, activeId) : undefined;
        const emit: Emit = (kind, data) => {
          send(sessionId, kind, kind === 'error' ? { message: errMessage(data) } : data);
          if (kind === 'closed') cleanup(sessionId);
        };
        const ctx: DriverContext = {
          request,
          vars: envToVars(env),
          jar: cookies.loadJar(ws.id),
          emit,
        };
        driver = driverFor(request.type, ctx);
      } catch (err) {
        fail(sessionId, errMessage(err));
        return;
      }

      const lifetime = setTimeout(() => {
        fail(sessionId, 'Connection lifetime exceeded');
        cleanup(sessionId);
      }, SESSION_MAX_MS);
      sessions.set(sessionId, { driver, lifetime });
      globalSessions++;

      Promise.resolve()
        .then(() => driver.open())
        .catch((err) => {
          fail(sessionId, errMessage(err));
          cleanup(sessionId);
        });
    };

    socket.on('message', (raw) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw.toString()) as ClientFrame;
      } catch {
        return;
      }
      if (frame.t === 'connect') {
        startSession(frame);
      } else if (frame.t === 'send') {
        const session = sessions.get(frame.sessionId);
        if (!session) return;
        Promise.resolve()
          .then(() => session.driver.send(frame.payload))
          .catch((err) => fail(frame.sessionId, errMessage(err)));
      } else if (frame.t === 'close') {
        cleanup(frame.sessionId);
        send(frame.sessionId, 'closed', {});
      }
    });

    const teardownAll = () => {
      for (const id of [...sessions.keys()]) cleanup(id);
    };
    socket.on('close', teardownAll);
    socket.on('error', teardownAll);
  });

  return wss;
}
