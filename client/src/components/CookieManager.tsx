import { useEffect, useState } from 'react';
import { api, type StoredCookie } from '../api';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export function CookieManager({ workspaceId, onClose }: Props) {
  const [cookies, setCookies] = useState<StoredCookie[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setCookies(await api.listCookies(workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function remove(c: StoredCookie) {
    await api.deleteCookie(workspaceId, {
      domain: c.domain,
      path: c.path,
      key: c.key,
    });
    void refresh();
  }

  async function clearAll() {
    if (!confirm('Delete all stored cookies for this workspace?')) return;
    await api.clearCookies(workspaceId);
    void refresh();
  }

  // Group cookies by domain for display.
  const byDomain = new Map<string, StoredCookie[]>();
  for (const c of cookies ?? []) {
    const list = byDomain.get(c.domain) ?? [];
    list.push(c);
    byDomain.set(c.domain, list);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal cookie-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title-row">
          <h2>Cookies</h2>
          <div className="spacer" />
          {cookies && cookies.length > 0 && (
            <button className="btn btn-danger-ghost" onClick={clearAll}>
              Clear all
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          Cookies are captured from responses and sent automatically on matching
          requests. They are stored on this machine only, never in the workspace
          folder.
        </p>
        {error && <p className="error-text">{error}</p>}
        {cookies && cookies.length === 0 && (
          <p className="muted">No cookies stored yet.</p>
        )}
        <div className="cookie-list">
          {[...byDomain.entries()].map(([domain, list]) => (
            <div key={domain} className="cookie-domain">
              <div className="cookie-domain-name">{domain}</div>
              {list.map((c) => (
                <div className="cookie-row" key={`${c.path}|${c.key}`}>
                  <span className="cookie-key">{c.key}</span>
                  <span className="cookie-value" title={c.value}>
                    {c.value}
                  </span>
                  <span className="cookie-flags">
                    {c.path !== '/' && <span title="Path">{c.path}</span>}
                    {c.secure && <span className="cookie-flag">Secure</span>}
                    {c.httpOnly && <span className="cookie-flag">HttpOnly</span>}
                    {c.expires ? (
                      <span
                        className="cookie-flag"
                        title={`Expires ${c.expires}`}
                      >
                        expires
                      </span>
                    ) : (
                      <span className="cookie-flag" title="Session cookie">
                        session
                      </span>
                    )}
                  </span>
                  <button
                    className="icon-btn"
                    title="Delete cookie"
                    onClick={() => remove(c)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
