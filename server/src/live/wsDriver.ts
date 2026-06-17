import WebSocket from 'ws';
import { interpolate } from '../execute.js';
import { buildHandshakeHeaders } from './handshake.js';
import type { DriverContext, LiveDriver } from './driver.js';

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
      const headers = buildHandshakeHeaders(ctx, url);
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
