import { useContext, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';
import { beautifyGraphql, beautifyJson } from '../beautify';
import { requestToCurl } from '../curl';
import {
  HTTP_METHODS,
  type ApiRequest,
  type AuthConfig,
  type BodyMode,
  type ExecutionResult,
  type HttpMethod,
} from '../types';
import { VariablesContext } from '../variables';
import { AuthEditor } from './AuthEditor';
import { FormDataEditor } from './FormDataEditor';
import { KeyValueEditor } from './KeyValueEditor';
import { ResponsePanel } from './ResponsePanel';
import { VarField } from './VarField';

interface Props {
  workspaceId: string;
  collectionId: string;
  request: ApiRequest;
  onSaved: (request: ApiRequest) => void;
  onDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

type Tab = 'params' | 'headers' | 'auth' | 'body' | 'docs';

/**
 * Editing auth fields materializes sub-objects (bearer/basic/apiKey) that
 * stick around after switching the type back — which made reverted edits
 * compare as dirty forever. Canonical form keeps only the active section,
 * so comparisons (and saved files) ignore leftovers from abandoned types.
 */
function canonical(req: ApiRequest): ApiRequest {
  const auth: AuthConfig = { type: req.auth.type };
  if (req.auth.type === 'bearer') {
    auth.bearer = req.auth.bearer ?? { token: '' };
  } else if (req.auth.type === 'basic') {
    auth.basic = req.auth.basic ?? { username: '', password: '' };
  } else if (req.auth.type === 'apiKey') {
    auth.apiKey = req.auth.apiKey ?? { key: '', value: '', placement: 'header' };
  }
  return { ...req, auth };
}

const BODY_MODES: { value: BodyMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'form', label: 'Form URL-encoded' },
  { value: 'formData', label: 'Form Data' },
  { value: 'binary', label: 'Binary' },
];

export function RequestEditor({
  workspaceId,
  collectionId,
  request,
  onSaved,
  onDelete,
  onDirtyChange,
}: Props) {
  const [saved, setSaved] = useState(request);
  const [draft, setDraft] = useState(request);
  const [tab, setTab] = useState<Tab>('params');
  const [docsPreview, setDocsPreview] = useState(false);
  const [response, setResponse] = useState<ExecutionResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [curlCopied, setCurlCopied] = useState(false);
  const [browsingBinary, setBrowsingBinary] = useState(false);
  const { vars } = useContext(VariablesContext);

  const dirty =
    JSON.stringify(canonical(draft)) !== JSON.stringify(canonical(saved));
  const isGraphql = draft.type === 'graphql';

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Unmounting (navigating away after a confirm) clears the dirty flag.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const patch = (changes: Partial<ApiRequest>) =>
    setDraft((d) => ({ ...d, ...changes }));

  function beautify(fn: () => Partial<ApiRequest>) {
    setFormatError(null);
    try {
      patch(fn());
    } catch (err) {
      setFormatError(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    setSaveError(null);
    const clean = canonical(draft);
    try {
      await api.updateRequest(workspaceId, collectionId, clean);
      setSaved(clean);
      setDraft(clean);
      onSaved(clean);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  async function send() {
    setExecuting(true);
    setExecError(null);
    try {
      setResponse(await api.execute(workspaceId, draft));
    } catch (err) {
      setResponse(null);
      setExecError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void send();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="request-editor">
      <div className="editor-title-row">
        <span className={`type-badge type-${draft.type}`}>
          {isGraphql ? 'GQL' : 'HTTP'}
        </span>
        <input
          className="name-input"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(requestToCurl(draft, vars));
            setCurlCopied(true);
            setTimeout(() => setCurlCopied(false), 1500);
          }}
        >
          {curlCopied ? 'Copied!' : 'Copy as cURL'}
        </button>
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
        {isGraphql ? (
          <span className="method-label method-POST">POST</span>
        ) : (
          <select
            className={`method-select method-${draft.method}`}
            value={draft.method}
            onChange={(e) => patch({ method: e.target.value as HttpMethod })}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <VarField
          className="url-input"
          wrapClassName="url-wrap"
          value={draft.url}
          placeholder="{{baseUrl}}/path or https://api.example.com/path"
          onChange={(url) => patch({ url })}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn btn-primary" onClick={send} disabled={executing}>
          {executing ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="tab-group editor-tabs">
        {(
          [
            ['params', 'Params'],
            ['headers', 'Headers'],
            ['auth', 'Auth'],
            ['body', isGraphql ? 'Query' : 'Body'],
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
        {tab === 'params' && (
          <KeyValueEditor
            items={draft.params}
            onChange={(params) => patch({ params })}
            keyPlaceholder="param"
            addLabel="Query Param"
          />
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

        {tab === 'body' && isGraphql && (
          <div className="graphql-editor">
            <div className="editor-toolbar">
              <span className="panel-title">Query</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  beautify(() => ({
                    graphql: {
                      ...draft.graphql,
                      query: beautifyGraphql(draft.graphql.query),
                    },
                  }))
                }
              >
                Beautify
              </button>
            </div>
            <VarField
              multiline
              syntax="graphql"
              className="code-area"
              wrapClassName="grow-wrap"
              value={draft.graphql.query}
              placeholder={'query {\n  viewer {\n    id\n  }\n}'}
              onChange={(query) => {
                setFormatError(null);
                patch({ graphql: { ...draft.graphql, query } });
              }}
            />
            <div className="editor-toolbar">
              <span className="panel-title">Variables (JSON)</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  beautify(() => ({
                    graphql: {
                      ...draft.graphql,
                      variables: beautifyJson(draft.graphql.variables),
                    },
                  }))
                }
              >
                Beautify
              </button>
            </div>
            <VarField
              multiline
              syntax="json"
              className="code-area code-area-small"
              value={draft.graphql.variables}
              placeholder={'{ "id": 1 }'}
              onChange={(variables) => {
                setFormatError(null);
                patch({ graphql: { ...draft.graphql, variables } });
              }}
            />
            {formatError && <p className="error-text">{formatError}</p>}
          </div>
        )}

        {tab === 'body' && !isGraphql && (
          <div className="body-editor">
            <div className="body-mode-row">
              {BODY_MODES.map((m) => (
                <label key={m.value} className="radio-label">
                  <input
                    type="radio"
                    name="body-mode"
                    checked={draft.body.mode === m.value}
                    onChange={() =>
                      patch({ body: { ...draft.body, mode: m.value } })
                    }
                  />
                  {m.label}
                </label>
              ))}
              <div className="spacer" />
              {draft.body.mode === 'json' && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    beautify(() => ({
                      body: {
                        ...draft.body,
                        content: beautifyJson(draft.body.content),
                      },
                    }))
                  }
                >
                  Beautify
                </button>
              )}
            </div>
            {formatError && <p className="error-text">{formatError}</p>}
            {(draft.body.mode === 'json' || draft.body.mode === 'text') && (
              <VarField
                multiline
                syntax={draft.body.mode === 'json' ? 'json' : undefined}
                className="code-area"
                wrapClassName="grow-wrap"
                value={draft.body.content}
                placeholder={
                  draft.body.mode === 'json' ? '{ "key": "value" }' : 'Raw body'
                }
                onChange={(content) => {
                  setFormatError(null);
                  patch({ body: { ...draft.body, content } });
                }}
              />
            )}
            {draft.body.mode === 'form' && (
              <KeyValueEditor
                items={draft.body.form}
                onChange={(form) => patch({ body: { ...draft.body, form } })}
                addLabel="Field"
              />
            )}
            {draft.body.mode === 'formData' && (
              <FormDataEditor
                items={draft.body.formData}
                onChange={(formData) =>
                  patch({ body: { ...draft.body, formData } })
                }
              />
            )}
            {draft.body.mode === 'binary' && (
              <div className="binary-editor">
                <div className="file-cell">
                  <VarField
                    className="kv-value"
                    wrapClassName="kv-value"
                    value={draft.body.binaryPath}
                    placeholder="/path/to/file"
                    onChange={(binaryPath) =>
                      patch({ body: { ...draft.body, binaryPath } })
                    }
                  />
                  <button
                    className="btn btn-sm"
                    disabled={browsingBinary}
                    onClick={async () => {
                      setBrowsingBinary(true);
                      try {
                        const { path } = await api.pickFile(
                          'Choose the file to send as the request body'
                        );
                        if (path) {
                          patch({ body: { ...draft.body, binaryPath: path } });
                        }
                      } finally {
                        setBrowsingBinary(false);
                      }
                    }}
                  >
                    {browsingBinary ? '…' : 'Browse…'}
                  </button>
                </div>
                <p className="muted">
                  The file is read at send time. Content-Type is guessed from
                  the extension unless you set the header yourself. Note: file
                  paths are machine-specific, so teammates may need to adjust
                  them.
                </p>
              </div>
            )}
            {draft.body.mode === 'none' && (
              <p className="muted">This request has no body.</p>
            )}
          </div>
        )}

        {tab === 'docs' && (
          <div className="docs-editor">
            <div className="docs-toolbar">
              <div className="tab-group">
                <button
                  className={!docsPreview ? 'tab active' : 'tab'}
                  onClick={() => setDocsPreview(false)}
                >
                  Write
                </button>
                <button
                  className={docsPreview ? 'tab active' : 'tab'}
                  onClick={() => setDocsPreview(true)}
                >
                  Preview
                </button>
              </div>
            </div>
            {docsPreview ? (
              <div className="markdown-preview">
                {draft.docs.trim() ? (
                  <ReactMarkdown>{draft.docs}</ReactMarkdown>
                ) : (
                  <p className="muted">Nothing to preview.</p>
                )}
              </div>
            ) : (
              <textarea
                className="code-area"
                value={draft.docs}
                placeholder="Document this request in Markdown…"
                onChange={(e) => patch({ docs: e.target.value })}
              />
            )}
          </div>
        )}
      </div>

      <ResponsePanel
        response={response}
        error={execError}
        executing={executing}
      />
    </div>
  );
}
