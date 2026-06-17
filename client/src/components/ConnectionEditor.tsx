import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { createLiveSession, type LiveSession } from '../live';
import type { ApiRequest, SavedMessage } from '../types';
import { AuthEditor } from './AuthEditor';
import { DocsEditor } from './DocsEditor';
import { KeyValueEditor } from './KeyValueEditor';
import { MessageLogPanel, type LogEntry } from './MessageLogPanel';
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

type Tab = 'connection' | 'headers' | 'auth' | 'messages' | 'docs';
type Status = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

let logSeq = 0;
const entry = (dir: LogEntry['dir'], text: string): LogEntry => ({
  id: `${Date.now()}-${logSeq++}`,
  dir,
  text,
  ts: Date.now(),
});

export function ConnectionEditor({
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
  const [tab, setTab] = useState<Tab>('connection');
  const [status, setStatus] = useState<Status>('idle');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const connected = status === 'open';

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Close the live connection when navigating away / unmounting.
  useEffect(
    () => () => {
      sessionRef.current?.close();
      sessionRef.current = null;
      onDirtyChange(false);
    },
    [onDirtyChange]
  );

  const patch = (changes: Partial<ApiRequest>) =>
    setDraft((d) => ({ ...d, ...changes }));
  const patchWs = (changes: Partial<ApiRequest['websocket']>) =>
    setDraft((d) => ({ ...d, websocket: { ...d.websocket, ...changes } }));

  const log = (e: LogEntry) => setEntries((prev) => [...prev, e]);

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
    log(entry('system', `Connecting to ${draft.websocket.url}…`));
    sessionRef.current = createLiveSession({
      workspaceId,
      collectionId,
      folderPath,
      request: draft,
      onOpen: () => {
        setStatus('open');
        log(entry('system', 'Connected.'));
      },
      onMessage: (payload) => {
        const p = payload as { data?: string; binary?: boolean };
        log(entry('in', p?.binary ? `[binary ${p.data?.length ?? 0}b base64] ${p.data ?? ''}` : p?.data ?? ''));
      },
      onError: (message) => {
        setStatus('error');
        log(entry('system', `Error: ${message}`));
      },
      onClosed: (payload) => {
        const p = payload as { code?: number; reason?: string } | undefined;
        setStatus('closed');
        log(entry('system', `Closed${p?.code ? ` (${p.code})` : ''}${p?.reason ? `: ${p.reason}` : ''}`));
        sessionRef.current = null;
      },
    });
  }

  function disconnect() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus('closed');
    log(entry('system', 'Disconnected.'));
  }

  function sendMessage(text: string) {
    sessionRef.current?.send({ data: text });
    log(entry('out', text));
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
        <span className="type-badge type-websocket">WS</span>
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
          value={draft.websocket.url}
          placeholder="wss://echo.example.com/socket"
          onChange={(url) => patchWs({ url })}
        />
        {connected || status === 'connecting' ? (
          <button className="btn" onClick={disconnect}>
            Disconnect
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={connect}
            disabled={!draft.websocket.url.trim()}
          >
            Connect
          </button>
        )}
      </div>

      <div className="tab-group editor-tabs">
        {(
          [
            ['connection', 'Connection'],
            ['headers', 'Headers'],
            ['auth', 'Auth'],
            ['messages', 'Saved Messages'],
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

      <div className="tab-content">
        {tab === 'connection' && (
          <div className="kv-editor">
            <label className="field-label">Subprotocols</label>
            <VarField
              className="kv-value"
              wrapClassName="kv-value"
              value={draft.websocket.subprotocols}
              placeholder="comma- or space-separated (optional)"
              onChange={(subprotocols) => patchWs({ subprotocols })}
            />
            <p className="muted">
              Sent as <code>Sec-WebSocket-Protocol</code> during the handshake.
            </p>
          </div>
        )}

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

        {tab === 'messages' && (
          <SavedMessagesEditor
            messages={draft.websocket.messages}
            onChange={(messages) => patchWs({ messages })}
          />
        )}

        {tab === 'docs' && (
          <DocsEditor
            value={draft.docs}
            onChange={(docs) => patch({ docs })}
            placeholder="Document this connection in Markdown…"
          />
        )}
      </div>

      <MessageLogPanel
        entries={entries}
        connected={connected}
        savedMessages={draft.websocket.messages}
        onSend={sendMessage}
        onClear={() => setEntries([])}
        placeholder="Message to send…"
      />
    </div>
  );
}

function SavedMessagesEditor({
  messages,
  onChange,
}: {
  messages: SavedMessage[];
  onChange: (messages: SavedMessage[]) => void;
}) {
  const update = (i: number, changes: Partial<SavedMessage>) =>
    onChange(messages.map((m, idx) => (idx === i ? { ...m, ...changes } : m)));
  return (
    <div className="saved-messages">
      {messages.map((m, i) => (
        <div key={i} className="saved-message">
          <div className="saved-message-head">
            <input
              className="name-input"
              value={m.name}
              placeholder="Message name"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onChange(messages.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          </div>
          <textarea
            className="code-area"
            value={m.content}
            placeholder="Message content"
            spellCheck={false}
            onChange={(e) => update(i, { content: e.target.value })}
          />
        </div>
      ))}
      <button
        className="btn btn-sm"
        onClick={() => onChange([...messages, { name: `Message ${messages.length + 1}`, content: '' }])}
      >
        Add Saved Message
      </button>
    </div>
  );
}
