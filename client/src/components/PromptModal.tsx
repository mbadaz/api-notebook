import { useState, type FormEvent } from 'react';
import { api } from '../api';

export interface PromptField {
  name: string;
  label: string;
  placeholder?: string;
  initial?: string;
  type?: 'text' | 'select' | 'folder' | 'textarea';
  options?: { value: string; label: string }[];
}

export interface PromptConfig {
  title: string;
  fields: PromptField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
}

interface Props {
  config: PromptConfig;
  onClose: () => void;
}

export function PromptModal({ config, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      config.fields.map((f) => [
        f.name,
        f.initial ?? (f.type === 'select' ? (f.options?.[0]?.value ?? '') : ''),
      ])
    )
  );
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse(field: PromptField) {
    setBrowsing(true);
    setError(null);
    try {
      const { path } = await api.pickFolder(field.label);
      if (path) setValues((v) => ({ ...v, [field.name]: path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrowsing(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await config.onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{config.title}</h2>
        {config.fields.map((field) => (
          <label className="field" key={field.name}>
            <span>{field.label}</span>
            {field.type === 'select' ? (
              <select
                value={values[field.name]}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              >
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea
                className="code-area code-area-small"
                autoFocus={field === config.fields[0]}
                value={values[field.name]}
                placeholder={field.placeholder}
                spellCheck={false}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              />
            ) : field.type === 'folder' ? (
              <div className="folder-field">
                <input
                  value={values[field.name]}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setValues({ ...values, [field.name]: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="btn"
                  disabled={browsing}
                  onClick={() => browse(field)}
                >
                  {browsing ? 'Choosing…' : 'Browse…'}
                </button>
              </div>
            ) : (
              <input
                autoFocus={field === config.fields[0]}
                value={values[field.name]}
                placeholder={field.placeholder}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              />
            )}
          </label>
        ))}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {config.submitLabel ?? 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
