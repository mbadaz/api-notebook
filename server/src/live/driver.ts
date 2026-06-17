import type { CookieJar } from 'tough-cookie';
import type { ApiRequest } from '../types.js';

/** Events a driver pushes back toward the browser for its session. */
export type EmitKind = 'open' | 'message' | 'error' | 'closed';
export type Emit = (kind: EmitKind, data?: unknown) => void;

export interface DriverContext {
  /** The request as sent by the client (drivers interpolate their own fields). */
  request: ApiRequest;
  /** Active-environment variables for {{var}} interpolation. */
  vars: Record<string, string>;
  /** Workspace cookie jar (for the handshake Cookie header). */
  jar: CookieJar;
  emit: Emit;
}

/**
 * A driver owns one outbound connection (WebSocket, Socket.IO, MCP, …) for a
 * single live session. The session manager calls open() once, forwards send()
 * for each client message, and calls close() on teardown.
 */
export interface LiveDriver {
  open(): Promise<void> | void;
  send(payload: unknown): void | Promise<void>;
  close(): void;
}

export type DriverFactory = (ctx: DriverContext) => LiveDriver;
