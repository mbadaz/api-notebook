import { useEffect, useState } from 'react';
import type { Collection, Scripts } from '../types';
import { LazyMarkdownEditor } from './LazyMarkdownEditor';

interface Props {
  collection: Collection;
  onSave: (changes: {
    name: string;
    description: string;
    scripts: Scripts;
  }) => Promise<void>;
  onDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

type Tab = 'description' | 'preReq' | 'tests';

export function CollectionEditor({
  collection,
  onSave,
  onDelete,
  onDirtyChange,
}: Props) {
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description);
  const [scripts, setScripts] = useState(collection.scripts);
  const [tab, setTab] = useState<Tab>('description');
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== collection.name ||
    description !== collection.description ||
    scripts.preRequest !== collection.scripts.preRequest ||
    scripts.postResponse !== collection.scripts.postResponse;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function save() {
    setError(null);
    try {
      await onSave({ name, description, scripts });
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
      {error && <p className="error-text">{error}</p>}

      <div className="tab-group editor-tabs">
        {(
          [
            ['description', 'Description'],
            ['preReq', 'Pre-request'],
            ['tests', 'Tests'],
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

      {tab === 'description' && (
        <div className="docs-editor">
          <LazyMarkdownEditor
            value={description}
            onChange={setDescription}
            placeholder="Describe this collection in Markdown…"
          />
        </div>
      )}

      {tab === 'preReq' && (
        <div className="script-editor">
          <p className="muted">
            Runs before <em>every</em> request in this collection, ahead of the
            request's own pre-request script.
          </p>
          <textarea
            className="code-area"
            value={scripts.preRequest}
            placeholder="// collection pre-request script"
            spellCheck={false}
            onChange={(e) =>
              setScripts((s) => ({ ...s, preRequest: e.target.value }))
            }
          />
        </div>
      )}

      {tab === 'tests' && (
        <div className="script-editor">
          <p className="muted">
            Runs after <em>every</em> request in this collection, ahead of the
            request's own post-response script.
          </p>
          <textarea
            className="code-area"
            value={scripts.postResponse}
            placeholder="// collection post-response script (tests)"
            spellCheck={false}
            onChange={(e) =>
              setScripts((s) => ({ ...s, postResponse: e.target.value }))
            }
          />
        </div>
      )}
    </div>
  );
}
