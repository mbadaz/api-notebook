import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Collection } from '../types';

interface Props {
  collection: Collection;
  onSave: (changes: { name: string; description: string }) => Promise<void>;
  onDelete: () => void;
}

export function CollectionEditor({ collection, onSave, onDelete }: Props) {
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== collection.name || description !== collection.description;

  async function save() {
    setError(null);
    try {
      await onSave({ name, description });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="pane-editor">
      <div className="editor-title-row">
        <span className="type-badge type-collection">COL</span>
        <input
          className="name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <button className="btn" onClick={save}>
          Save
        </button>
        <button className="btn btn-danger-ghost" onClick={onDelete}>
          Delete
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="docs-toolbar">
        <span className="panel-title">Description</span>
        <div className="tab-group">
          <button
            className={!preview ? 'tab active' : 'tab'}
            onClick={() => setPreview(false)}
          >
            Write
          </button>
          <button
            className={preview ? 'tab active' : 'tab'}
            onClick={() => setPreview(true)}
          >
            Preview
          </button>
        </div>
      </div>
      {preview ? (
        <div className="markdown-preview">
          {description.trim() ? (
            <ReactMarkdown>{description}</ReactMarkdown>
          ) : (
            <p className="muted">Nothing to preview.</p>
          )}
        </div>
      ) : (
        <textarea
          className="code-area"
          value={description}
          placeholder="Describe this collection in Markdown…"
          onChange={(e) => setDescription(e.target.value)}
        />
      )}
    </div>
  );
}
