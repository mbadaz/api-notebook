import { useEffect, useRef, useState } from 'react';
import type { SavedMessage } from '../types';

export interface LogEntry {
  id: string;
  dir: 'in' | 'out' | 'system';
  text: string;
  ts: number;
}

interface Props {
  entries: LogEntry[];
  connected: boolean;
  savedMessages: SavedMessage[];
  onSend: (text: string) => void;
  onClear: () => void;
  /** Label for the send affordance (e.g. "Send" or "Emit"). */
  sendLabel?: string;
  /** Placeholder for the composer textarea. */
  placeholder?: string;
  /** Optional event-name field shown before the textarea (Socket.IO). */
  eventName?: { value: string; onChange: (value: string) => void; placeholder?: string };
  /** Called when a saved message is picked, in addition to filling the textarea. */
  onPickSaved?: (message: SavedMessage) => void;
}

function arrow(dir: LogEntry['dir']): string {
  if (dir === 'in') return '↓';
  if (dir === 'out') return '↑';
  return '•';
}

export function MessageLogPanel({
  entries,
  connected,
  savedMessages,
  onSend,
  onClear,
  sendLabel = 'Send',
  placeholder = 'Message to send…',
  eventName,
  onPickSaved,
}: Props) {
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest entry.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  function send() {
    if (!connected) return;
    onSend(text);
    setText('');
  }

  return (
    <div className="message-log-panel">
      <div className="response-header">
        <span className="panel-title">Messages</span>
        <div className="spacer" />
        {entries.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      <div className="message-log" ref={logRef}>
        {entries.length === 0 ? (
          <p className="muted response-placeholder">
            {connected ? 'Connected. Send a message to begin.' : 'Not connected.'}
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={`log-entry log-${e.dir}`}>
              <span className="log-arrow">{arrow(e.dir)}</span>
              <span className="log-time">
                {new Date(e.ts).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <pre className="log-text">{e.text}</pre>
            </div>
          ))
        )}
      </div>

      <div className="message-composer">
        {eventName && (
          <input
            className="event-name-input"
            value={eventName.value}
            placeholder={eventName.placeholder ?? 'event name'}
            disabled={!connected}
            onChange={(e) => eventName.onChange(e.target.value)}
          />
        )}
        <textarea
          className="code-area"
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          disabled={!connected}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-actions">
          {savedMessages.length > 0 && (
            <select
              className="method-select"
              value=""
              onChange={(e) => {
                const m = savedMessages.find((s) => s.name === e.target.value);
                if (m) {
                  setText(m.content);
                  onPickSaved?.(m);
                }
              }}
            >
              <option value="">Saved messages…</option>
              {savedMessages.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={!connected}
            title="Send (⌘/Ctrl+Enter)"
          >
            {sendLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
