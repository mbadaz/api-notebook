import { io, type Socket } from 'socket.io-client';
import { interpolate } from '../execute.js';
import { buildHandshakeHeaders } from './handshake.js';
import type { DriverContext, LiveDriver } from './driver.js';

/** Parses the optional JSON `auth` payload; throws with a clear message. */
function parseAuth(raw: string): Record<string, unknown> | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Socket.IO auth must be a JSON object');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Socket.IO auth must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function createSocketioDriver(ctx: DriverContext): LiveDriver {
  let socket: Socket | null = null;

  return {
    open() {
      const cfg = ctx.request.socketio;
      const raw = interpolate(cfg.url, ctx.vars).trim();
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new Error(`Invalid Socket.IO URL: "${raw}"`);
      }
      if (!/^https?:|^wss?:/.test(url.protocol)) {
        throw new Error('Socket.IO URL must start with http(s):// or ws(s)://');
      }

      const query: Record<string, string> = {};
      for (const q of cfg.query) {
        if (q.enabled && q.key) {
          query[interpolate(q.key, ctx.vars)] = interpolate(q.value, ctx.vars);
        }
      }
      const path = interpolate(cfg.path, ctx.vars).trim();
      const headers = buildHandshakeHeaders(ctx, url);
      const auth = parseAuth(interpolate(cfg.auth, ctx.vars));

      // Keep the URL pathname: Socket.IO reads it as the namespace (e.g.
      // /socketio). The engine.io mount point is the separate `path` option.
      const target = url.origin + url.pathname;
      socket = io(target, {
        path: path || undefined,
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        auth,
        query,
        extraHeaders: headers,
      });

      socket.on('connect', () => ctx.emit('open', { id: socket?.id }));
      socket.on('connect_error', (err: Error) => ctx.emit('error', err.message));
      socket.on('disconnect', (reason: string) => ctx.emit('closed', { reason }));

      const onEvent = (event: string, args: unknown[]) =>
        ctx.emit('message', { event, args });
      const listen = cfg.listenEvents.map((e) => e.trim()).filter(Boolean);
      if (listen.length > 0) {
        // Filtered mode: only the named events.
        for (const name of listen) socket.on(name, (...args: unknown[]) => onEvent(name, args));
      } else {
        // Catch-all: every inbound event.
        socket.onAny((event: string, ...args: unknown[]) => onEvent(event, args));
      }
    },

    send(payload: unknown) {
      const p = (payload as { event?: string; args?: unknown[] } | null) ?? {};
      const event = p.event?.trim();
      if (!socket || !event) return;
      const args = Array.isArray(p.args) ? p.args : p.args === undefined ? [] : [p.args];
      socket.emit(event, ...args);
    },

    close() {
      try {
        socket?.disconnect();
      } catch {
        // best-effort teardown
      }
      socket = null;
    },
  };
}
