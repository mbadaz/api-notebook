import WebSocket from 'ws';
import { interpolate } from '../execute.js';
import type { AuthConfig } from '../types.js';
import type { DriverContext, LiveDriver } from './driver.js';

/** Builds the handshake headers (interpolated request headers + auth + cookies). */
function buildHeaders(ctx: DriverContext, url: URL): Record<string, string> {
  const { request, vars, jar } = ctx;
  const headers: Record<string, string> = {};
  for (const h of request.headers) {
    if (h.enabled && h.key) headers[interpolate(h.key, vars)] = interpolate(h.value, vars);
  }
  applyAuth(headers, url, request.auth, vars);
  // Reuse the workspace jar for the handshake (map ws→http for matching).
  try {
    const httpUrl = url.toString().replace(/^ws/, 'http');
    const cookie = jar.getCookieStringSync(httpUrl);
    if (cookie) headers['cookie'] = cookie;
  } catch {
    // No cookies for this URL.
  }
  return headers;
}

function applyAuth(
  headers: Record<string, string>,
  url: URL,
  auth: AuthConfig,
  vars: Record<string, string>
): void {
  switch (auth.type) {
    case 'bearer':
      headers['authorization'] = `Bearer ${interpolate(auth.bearer?.token ?? '', vars)}`;
      break;
    case 'basic': {
      const user = interpolate(auth.basic?.username ?? '', vars);
      const pass = interpolate(auth.basic?.password ?? '', vars);
      headers['authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
      break;
    }
    case 'apiKey': {
      const key = interpolate(auth.apiKey?.key ?? '', vars);
      const value = interpolate(auth.apiKey?.value ?? '', vars);
      if (key) {
        if (auth.apiKey?.placement === 'query') url.searchParams.append(key, value);
        else headers[key] = value;
      }
      break;
    }
  }
}

export function createWsDriver(ctx: DriverContext): LiveDriver {
  let socket: WebSocket | null = null;

  return {
    open() {
      const raw = interpolate(ctx.request.websocket.url, ctx.vars).trim();
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new Error(`Invalid WebSocket URL: "${raw}"`);
      }
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error('WebSocket URL must start with ws:// or wss://');
      }
      const headers = buildHeaders(ctx, url);
      const protocols = ctx.request.websocket.subprotocols
        .split(/[\s,]+/)
        .filter(Boolean);

      socket = new WebSocket(url.toString(), protocols, { headers });
      socket.on('open', () =>
        ctx.emit('open', { protocol: socket?.protocol || undefined })
      );
      socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        const buf = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
        if (isBinary) {
          ctx.emit('message', { data: buf.toString('base64'), binary: true });
        } else {
          ctx.emit('message', { data: buf.toString('utf8') });
        }
      });
      socket.on('error', (err: Error) => ctx.emit('error', err.message));
      socket.on('close', (code: number, reason: Buffer) =>
        ctx.emit('closed', { code, reason: reason.toString('utf8') })
      );
    },

    send(payload: unknown) {
      const data = (payload as { data?: string } | null)?.data ?? '';
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
    },

    close() {
      try {
        socket?.close();
      } catch {
        socket?.terminate();
      }
      socket = null;
    },
  };
}
