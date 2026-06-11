import { useState } from 'react';
import type { ExecutionResult } from '../types';

interface Props {
  response: ExecutionResult | null;
  error: string | null;
  executing: boolean;
}

function statusClass(status: number): string {
  if (status < 300) return 'status-2xx';
  if (status < 400) return 'status-3xx';
  if (status < 500) return 'status-4xx';
  return 'status-5xx';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function prettyBody(result: ExecutionResult): string {
  const contentType = result.headers['content-type'] ?? '';
  if (contentType.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(result.body), null, 2);
    } catch {
      return result.body;
    }
  }
  return result.body;
}

export function ResponsePanel({ response, error, executing }: Props) {
  const [tab, setTab] = useState<'body' | 'headers'>('body');

  return (
    <div className="response-panel">
      <div className="response-header">
        <span className="panel-title">Response</span>
        {executing && <span className="muted">Sending…</span>}
        {response && !executing && (
          <>
            <span className={`status-pill ${statusClass(response.status)}`}>
              {response.status} {response.statusText}
            </span>
            <span className="muted">{response.timeMs} ms</span>
            <span className="muted">{formatSize(response.sizeBytes)}</span>
            <div className="spacer" />
            <div className="tab-group">
              <button
                className={tab === 'body' ? 'tab active' : 'tab'}
                onClick={() => setTab('body')}
              >
                Body
              </button>
              <button
                className={tab === 'headers' ? 'tab active' : 'tab'}
                onClick={() => setTab('headers')}
              >
                Headers
              </button>
            </div>
          </>
        )}
      </div>
      {error && !executing && <div className="response-error">{error}</div>}
      {response && !executing && tab === 'body' && (
        <pre className="response-body">{prettyBody(response)}</pre>
      )}
      {response && !executing && tab === 'headers' && (
        <div className="response-headers">
          {Object.entries(response.headers).map(([key, value]) => (
            <div className="kv-static" key={key}>
              <span className="kv-static-key">{key}</span>
              <span className="kv-static-value">{value}</span>
            </div>
          ))}
        </div>
      )}
      {!response && !error && !executing && (
        <p className="muted response-placeholder">
          Send a request to see the response here.
        </p>
      )}
    </div>
  );
}
