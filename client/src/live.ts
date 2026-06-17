import type { ApiRequest } from './types';

/**
 * Browser side of the live channel. A single WebSocket to our own server (/live)
 * is shared by every live session; each session is keyed by a sessionId. The
 * server owns the real outbound connection (WebSocket/Socket.IO/MCP).
 */

interface ServerFrame {
  t: 'open' | 'message' | 'error' | 'closed';
  sessionId: string;
  payload?: unknown;
  ts?: number;
}

export interface LiveSessionHandlers {
  workspaceId: string;
  collectionId: string;
  folderPath: string[];
  request: ApiRequest;
  onOpen?: (info: unknown) => void;
  onMessage?: (payload: unknown, ts: number) => void;
  onError?: (message: string) => void;
  onClosed?: (payload: unknown) => void;
}

export interface LiveSession {
  send: (payload: unknown) => void;
  close: () => void;
}

type Handlers = Map<string, LiveSessionHandlers>;

let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
const handlers: Handlers = new Map();
const pending: string[] = [];

function liveUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/live`;
}

function ensureSocket(): Promise<WebSocket> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    const s = new WebSocket(liveUrl());
    s.onopen = () => {
      socket = s;
      connecting = null;
      while (pending.length) s.send(pending.shift()!);
      resolve(s);
    };
    s.onerror = () => {
      connecting = null;
      reject(new Error('Live channel connection failed'));
    };
    s.onclose = () => {
      socket = null;
      // Notify every active session so editors can reflect the drop.
      for (const [, h] of handlers) h.onClosed?.({ reason: 'channel closed' });
      handlers.clear();
    };
    s.onmessage = (ev) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(ev.data as string) as ServerFrame;
      } catch {
        return;
      }
      const h = handlers.get(frame.sessionId);
      if (!h) return;
      if (frame.t === 'open') h.onOpen?.(frame.payload);
      else if (frame.t === 'message') h.onMessage?.(frame.payload, frame.ts ?? Date.now());
      else if (frame.t === 'error')
        h.onError?.((frame.payload as { message?: string })?.message ?? 'Error');
      else if (frame.t === 'closed') {
        h.onClosed?.(frame.payload);
        handlers.delete(frame.sessionId);
      }
    };
  });
  return connecting;
}

function rawSend(frame: Record<string, unknown>): void {
  const text = JSON.stringify(frame);
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(text);
  else pending.push(text);
}

export function createLiveSession(h: LiveSessionHandlers): LiveSession {
  const sessionId = crypto.randomUUID();
  handlers.set(sessionId, h);
  void ensureSocket().catch((err) => {
    h.onError?.(err instanceof Error ? err.message : String(err));
  });
  rawSend({
    t: 'connect',
    sessionId,
    workspaceId: h.workspaceId,
    collectionId: h.collectionId,
    folderPath: h.folderPath.join('/'),
    request: h.request,
  });
  return {
    send: (payload: unknown) => rawSend({ t: 'send', sessionId, payload }),
    close: () => {
      rawSend({ t: 'close', sessionId });
      handlers.delete(sessionId);
    },
  };
}
