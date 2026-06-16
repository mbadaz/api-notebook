import { useEffect, useMemo, useState } from 'react';
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
  const [tab, setTab] = useState<'body' | 'headers' | 'script'>('body');
  const [view, setView] = useState<'pretty' | 'raw'>('pretty');

  const script = response?.script;
  // Avoid getting stuck on the Tests tab when a non-scripted response arrives.
  useEffect(() => {
    if (tab === 'script' && !script) setTab('body');
  }, [script, tab]);

  const contentType = response?.headers['content-type'] ?? '';
  const setCookieHeader = response?.headers['set-cookie'];
  const cookieCount = setCookieHeader ? setCookieHeader.split('\n').length : 0;
  const language = contentTypeLanguage(contentType);
  const isBinary = response?.bodyEncoding === 'base64';
  const isHtml = !isBinary && contentType.toLowerCase().includes('html');
  const tooLarge = (response?.body.length ?? 0) > MAX_PRETTY_CHARS;

  const prettyText = useMemo(() => {
    if (!response || tooLarge || isBinary) return response?.body ?? '';
    if (language === 'json') {
      try {
        return JSON.stringify(JSON.parse(response.body), null, 2);
      } catch {
        return response.body;
      }
    }
    if (language === 'xml') return formatXml(response.body);
    return response.body;
  }, [response, language, tooLarge, isBinary]);

  const highlighted = useMemo(() => {
    if (!response || !language || tooLarge || isBinary) return null;
    return highlightCode(prettyText, language);
  }, [response, language, prettyText, tooLarge, isBinary]);

  function responseBlob(): Blob {
    if (!response) return new Blob([]);
    const type = contentType || 'application/octet-stream';
    if (isBinary) {
      const bin = atob(response.body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([response.body], { type: type || 'text/plain' });
  }

  function suggestedFilename(): string {
    try {
      const base = new URL(response?.resolvedUrl ?? '').pathname
        .split('/')
        .filter(Boolean)
        .pop();
      if (base && base.includes('.')) return base;
      if (base) return base;
    } catch {
      // fall through
    }
    return 'response';
  }

  function download() {
    const url = URL.createObjectURL(responseBlob());
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFilename();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

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
            {cookieCount > 0 && (
              <span
                className="muted"
                title={`${cookieCount} cookie(s) set — view in the Headers tab or the Cookies manager`}
              >
                🍪 {cookieCount}
              </span>
            )}
            <div className="spacer" />
            {tab === 'body' && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={download}>
                  Download
                </button>
                {isHtml && (
                  <button className="btn btn-ghost btn-sm" onClick={openPreview}>
                    Preview ↗
                  </button>
                )}
                {!isBinary && (
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
                )}
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
              {script && (
                <button
                  className={tab === 'script' ? 'tab active' : 'tab'}
                  onClick={() => setTab('script')}
                >
                  Tests
                  {script.tests.length > 0 &&
                    ` (${script.tests.filter((t) => t.passed).length}/${script.tests.length})`}
                  {script.error || script.tests.some((t) => !t.passed)
                    ? ' ⚠'
                    : ''}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {error && !executing && <div className="response-error">{error}</div>}
      {response && !executing && tab === 'body' && isBinary && (
        <div className="binary-response">
          <p>
            Binary response — <code>{contentType || 'unknown type'}</code>,{' '}
            {formatSize(response.sizeBytes)}. Use <strong>Download</strong> to
            save it to a file.
          </p>
        </div>
      )}
      {response && !executing && tab === 'body' && !isBinary && (
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
      {response && !executing && tab === 'script' && script && (
        <div className="script-results">
          {script.error && <div className="response-error">{script.error}</div>}
          {script.tests.length > 0 && (
            <ul className="test-list">
              {script.tests.map((t, i) => (
                <li
                  key={i}
                  className={t.passed ? 'test-row test-pass' : 'test-row test-fail'}
                >
                  <span className="test-icon">{t.passed ? '✓' : '✗'}</span>
                  <span className="test-name">{t.name}</span>
                  {t.error && <span className="test-error">{t.error}</span>}
                </li>
              ))}
            </ul>
          )}
          {script.variablesSet.length > 0 && (
            <p className="muted">
              Variables set:{' '}
              {script.variablesSet.map((name, i) => (
                <span key={name}>
                  {i > 0 && ', '}
                  <code>{name}</code>
                </span>
              ))}
            </p>
          )}
          {script.logs.length > 0 && (
            <pre className="script-console">{script.logs.join('\n')}</pre>
          )}
          {script.tests.length === 0 &&
            script.logs.length === 0 &&
            script.variablesSet.length === 0 &&
            !script.error && <p className="muted">Scripts ran with no output.</p>}
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
