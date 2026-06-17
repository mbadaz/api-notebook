import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { interpolate } from '../execute.js';
import { buildHandshakeHeaders } from './handshake.js';
import type { DriverContext, LiveDriver } from './driver.js';

/**
 * MCP client driver (Streamable HTTP transport only for now). Unlike the
 * WebSocket/Socket.IO drivers this is request/response rather than a free
 * stream: the browser sends control ops over `send` and gets correlated
 * `message` frames back.
 *   { op: 'listTools' }                     → { kind: 'tools', tools }
 *   { op: 'callTool', callId, name, args }  → { kind: 'result', callId, result }
 */

interface ListToolsOp {
  op: 'listTools';
}
interface CallToolOp {
  op: 'callTool';
  callId: string;
  name: string;
  args?: Record<string, unknown>;
}
type McpOp = ListToolsOp | CallToolOp;

export function createMcpDriver(ctx: DriverContext): LiveDriver {
  let client: Client | null = null;

  return {
    async open() {
      const raw = interpolate(ctx.request.mcp.url, ctx.vars).trim();
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new Error(`Invalid MCP URL: "${raw}"`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('MCP URL must start with http:// or https://');
      }
      const headers = buildHandshakeHeaders(ctx, url);
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
      });
      client = new Client({ name: 'api-notebook', version: '1.0.0' });
      await client.connect(transport);
      ctx.emit('open', { server: client.getServerVersion() ?? undefined });
    },

    async send(payload: unknown) {
      if (!client) return;
      const op = payload as McpOp;
      if (op.op === 'listTools') {
        const res = await client.listTools();
        ctx.emit('message', { kind: 'tools', tools: res.tools });
      } else if (op.op === 'callTool') {
        try {
          const result = await client.callTool({
            name: op.name,
            arguments: op.args ?? {},
          });
          ctx.emit('message', { kind: 'result', callId: op.callId, result });
        } catch (err) {
          // Surface the failure inline against its call rather than as a
          // channel-level error, so the UI can show it next to the tool.
          ctx.emit('message', {
            kind: 'result',
            callId: op.callId,
            result: {
              isError: true,
              content: [
                { type: 'text', text: err instanceof Error ? err.message : String(err) },
              ],
            },
          });
        }
      }
    },

    close() {
      void client?.close();
      client = null;
    },
  };
}
