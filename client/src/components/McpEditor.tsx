import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { createLiveSession, type LiveSession } from '../live';
import type { ApiRequest } from '../types';
import { AuthEditor } from './AuthEditor';
import { DocsEditor } from './DocsEditor';
import { JsonSchemaForm, type JsonSchema } from './JsonSchemaForm';
import { KeyValueEditor } from './KeyValueEditor';
import { VarField } from './VarField';

interface Props {
  workspaceId: string;
  collectionId: string;
  folderPath: string[];
  request: ApiRequest;
  onSaved: (request: ApiRequest) => void;
  onDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

type Tab = 'tools' | 'headers' | 'auth' | 'docs';
type Status = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/** A tool as returned by the MCP server (wire-only, not persisted). */
interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
}

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}
interface ToolResult {
  isError?: boolean;
  content?: ContentBlock[];
  structuredContent?: unknown;
}

export function McpEditor({
  workspaceId,
  collectionId,
  folderPath,
  request,
  onSaved,
  onDelete,
  onDirtyChange,
}: Props) {
  const [saved, setSaved] = useState(request);
  const [draft, setDraft] = useState(request);
  const [tab, setTab] = useState<Tab>('tools');
  const [status, setStatus] = useState<Status>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<ToolResult | null>(null);
  const [calling, setCalling] = useState(false);
  const sessionRef = useRef<LiveSession | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const connected = status === 'open';
  const selectedTool = tools?.find((t) => t.name === selected) ?? null;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      sessionRef.current?.close();
      sessionRef.current = null;
      onDirtyChange(false);
    },
    [onDirtyChange]
  );

  const patch = (changes: Partial<ApiRequest>) => setDraft((d) => ({ ...d, ...changes }));
  const patchMcp = (changes: Partial<ApiRequest['mcp']>) =>
    setDraft((d) => ({ ...d, mcp: { ...d.mcp, ...changes } }));

  async function save() {
    setSaveError(null);
    try {
      await api.updateRequest(workspaceId, collectionId, folderPath, draft);
      setSaved(draft);
      onSaved(draft);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function connect() {
    if (sessionRef.current) return;
    setStatus('connecting');
    setStatusText(`Connecting to ${draft.mcp.url}…`);
    setTools(null);
    setResult(null);
    sessionRef.current = createLiveSession({
      workspaceId,
      collectionId,
      folderPath,
      request: draft,
      onOpen: () => {
        setStatus('open');
        setStatusText('Connected. Loading tools…');
        sessionRef.current?.send({ op: 'listTools' });
      },
      onMessage: (payload) => {
        const p = payload as
          | { kind: 'tools'; tools: McpTool[] }
          | { kind: 'result'; callId: string; result: ToolResult };
        if (p.kind === 'tools') {
          setTools(p.tools);
          setStatusText(`${p.tools.length} tool${p.tools.length === 1 ? '' : 's'} available.`);
        } else if (p.kind === 'result') {
          setResult(p.result);
          setCalling(false);
        }
      },
      onError: (message) => {
        setStatus('error');
        setStatusText(`Error: ${message}`);
        setCalling(false);
      },
      onClosed: () => {
        setStatus('closed');
        setStatusText('Disconnected.');
        sessionRef.current = null;
      },
    });
  }

  function disconnect() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus('closed');
    setStatusText('Disconnected.');
  }

  function selectTool(name: string) {
    setSelected(name);
    setArgs({});
    setResult(null);
  }

  function callTool() {
    if (!selected || !connected) return;
    setResult(null);
    setCalling(true);
    sessionRef.current?.send({
      op: 'callTool',
      callId: crypto.randomUUID(),
      name: selected,
      args,
    });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="request-editor">
      <div className="editor-title-row">
        <span className="type-badge type-mcp">MCP</span>
        <input
          className="name-input"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <button
          className={dirty ? 'btn btn-primary' : 'btn'}
          title={dirty ? 'You have unsaved changes' : 'No unsaved changes'}
          onClick={save}
        >
          Save
        </button>
        <button className="btn btn-danger-ghost" onClick={onDelete}>
          Delete
        </button>
      </div>
      {saveError && <p className="error-text">{saveError}</p>}

      <div className="url-row">
        <span className={`conn-status conn-${status}`}>{status}</span>
        <VarField
          className="url-input"
          wrapClassName="url-wrap"
          value={draft.mcp.url}
          placeholder="https://mcp.example.com/mcp"
          onChange={(url) => patchMcp({ url })}
        />
        {connected || status === 'connecting' ? (
          <button className="btn" onClick={disconnect}>
            Disconnect
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={connect}
            disabled={!draft.mcp.url.trim()}
          >
            Connect
          </button>
        )}
      </div>

      <div className="tab-group editor-tabs">
        {(
          [
            ['tools', 'Tools'],
            ['headers', 'Headers'],
            ['auth', 'Auth'],
            ['docs', 'Docs'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? 'tab active' : 'tab'}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="tab-content mcp-content">
        {tab === 'tools' &&
          (!connected ? (
            <p className="muted">{statusText ?? 'Connect to list this server’s tools.'}</p>
          ) : (
            <div className="mcp-tools">
              <div className="mcp-tool-list">
                {statusText && <p className="muted">{statusText}</p>}
                {(tools ?? []).map((t) => (
                  <button
                    key={t.name}
                    className={selected === t.name ? 'mcp-tool selected' : 'mcp-tool'}
                    onClick={() => selectTool(t.name)}
                    title={t.description}
                  >
                    {t.title || t.name}
                  </button>
                ))}
              </div>

              <div className="mcp-tool-detail">
                {selectedTool ? (
                  <>
                    <h3 className="mcp-tool-name">{selectedTool.name}</h3>
                    {selectedTool.description && (
                      <p className="muted">{selectedTool.description}</p>
                    )}
                    <JsonSchemaForm
                      schema={selectedTool.inputSchema}
                      value={args}
                      onChange={setArgs}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={callTool}
                      disabled={calling}
                    >
                      {calling ? 'Calling…' : 'Call tool'}
                    </button>
                    {result && <ResultPanel result={result} />}
                  </>
                ) : (
                  <p className="muted">Select a tool to call it.</p>
                )}
              </div>
            </div>
          ))}

        {tab === 'headers' && (
          <KeyValueEditor
            items={draft.headers}
            onChange={(headers) => patch({ headers })}
            keyPlaceholder="Header"
            addLabel="Header"
          />
        )}

        {tab === 'auth' && (
          <AuthEditor auth={draft.auth} onChange={(auth) => patch({ auth })} />
        )}

        {tab === 'docs' && (
          <DocsEditor
            value={draft.docs}
            onChange={(docs) => patch({ docs })}
            placeholder="Document this MCP connection in Markdown…"
          />
        )}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: ToolResult }) {
  return (
    <div className={`mcp-result ${result.isError ? 'mcp-result-error' : ''}`}>
      <div className="mcp-result-head">{result.isError ? 'Error' : 'Result'}</div>
      {(result.content ?? []).map((block, i) =>
        block.type === 'text' ? (
          <pre key={i} className="mcp-result-text">{block.text}</pre>
        ) : (
          <pre key={i} className="mcp-result-text">{JSON.stringify(block, null, 2)}</pre>
        )
      )}
      {result.structuredContent !== undefined && (
        <pre className="mcp-result-text">{JSON.stringify(result.structuredContent, null, 2)}</pre>
      )}
    </div>
  );
}
