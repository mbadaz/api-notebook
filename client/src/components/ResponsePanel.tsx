import { useMemo, useState } from 'react';
import { formatXml } from '../beautify';
import { contentTypeLanguage, highlightCode } from '../highlight';
import type { ExecutionResult } from '../types';

interface Props {
  response: ExecutionResult | null;
  error: string | null;
  executing: boolean;
}

// Beyond this, formatting/highlighting large bodies would jank the UI.
const MAX_PRETTY_CHARS = 300_000;

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

export function ResponsePanel({ response, error, executing }: Props) {
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  const [view, setView] = useState<'pretty' | 'raw'>('pretty');

  const contentType = response?.headers['content-type'] ?? '';
  const language = contentTypeLanguage(contentType);
  const isHtml = contentType.toLowerCase().includes('html');
  const tooLarge = (response?.body.length ?? 0) > MAX_PRETTY_CHARS;

  const prettyText = useMemo(() => {
    if (!response || tooLarge) return response?.body ?? '';
    if (language === 'json') {
      try {
        return JSON.stringify(JSON.parse(response.body), null, 2);
      } catch {
        return response.body;
      }
    }
    if (language === 'xml') return formatXml(response.body);
    return response.body;
  }, [response, language, tooLarge]);

  const highlighted = useMemo(() => {
    if (!response || !language || tooLarge) return null;
    return highlightCode(prettyText, language);
  }, [response, language, prettyText, tooLarge]);

  function openPreview() {
    if (!response) return;
    const url = URL.createObjectURL(
      new Blob([response.body], { type: 'text/html' })
    );
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

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
            {tab === 'body' && (
              <>
                {isHtml && (
                  <button className="btn btn-ghost btn-sm" onClick={openPreview}>
                    Preview ↗
                  </button>
                )}
                <div className="tab-group">
                  <button
                    className={view === 'pretty' ? 'tab active' : 'tab'}
                    onClick={() => setView('pretty')}
                  >
                    Pretty
                  </button>
                  <button
                    className={view === 'raw' ? 'tab active' : 'tab'}
                    onClick={() => setView('raw')}
                  >
                    Raw
                  </button>
                </div>
              </>
            )}
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
        <>
          {view === 'pretty' && highlighted !== null ? (
            <pre className="response-body">
              <code dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
          ) : (
            <pre className="response-body">
              {view === 'pretty' ? prettyText : response.body}
            </pre>
          )}
          {tooLarge && (
            <p className="muted response-note">
              Response is large — formatting and highlighting are disabled.
            </p>
          )}
        </>
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
