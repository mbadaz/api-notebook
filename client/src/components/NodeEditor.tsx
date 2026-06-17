import { useEffect, useState } from 'react';
import type { Scripts } from '../types';
import { DocsEditor } from './DocsEditor';

/** A collection or folder — both carry a name, description and scripts. */
export interface EditableNode {
  name: string;
  description: string;
  scripts: Scripts;
}

interface Props {
  kind: 'collection' | 'folder';
  node: EditableNode;
  onSave: (changes: {
    name: string;
    description: string;
    scripts: Scripts;
  }) => Promise<void>;
  onDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

type Tab = 'description' | 'preReq' | 'tests';

/**
 * Edits a container node: a collection or a folder. Both run pre-request/test
 * scripts around every request they contain (folders nest within the
 * collection's chain), so the editor is shared.
 */
export function NodeEditor({ kind, node, onSave, onDelete, onDirtyChange }: Props) {
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(node.description);
  const [scripts, setScripts] = useState(node.scripts);
  const [tab, setTab] = useState<Tab>('description');
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== node.name ||
    description !== node.description ||
    scripts.preRequest !== node.scripts.preRequest ||
    scripts.postResponse !== node.scripts.postResponse;

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

  const label = kind === 'collection' ? 'collection' : 'folder';

  return (
    <div className="pane-editor">
      <div className="editor-title-row">
        <span className={`type-badge type-${kind}`}>
          {kind === 'collection' ? 'COL' : 'DIR'}
        </span>
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
        ).map(([value, tabLabel]) => (
          <button
            key={value}
            className={tab === value ? 'tab active' : 'tab'}
            onClick={() => setTab(value)}
          >
            {tabLabel}
          </button>
        ))}
      </div>

      {tab === 'description' && (
        <DocsEditor
          value={description}
          onChange={setDescription}
          placeholder={`Describe this ${label} in Markdown…`}
        />
      )}

      {tab === 'preReq' && (
        <div className="script-editor">
          <p className="muted">
            Runs before <em>every</em> request in this {label}, ahead of the
            request's own pre-request script.
          </p>
          <textarea
            className="code-area"
            value={scripts.preRequest}
            placeholder={`// ${label} pre-request script`}
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
            Runs after <em>every</em> request in this {label}, ahead of the
            request's own post-response script.
          </p>
          <textarea
            className="code-area"
            value={scripts.postResponse}
            placeholder={`// ${label} post-response script (tests)`}
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
