import { useState } from 'react';
import type { Environment, KeyValue } from '../types';

import { KeyValueEditor } from './KeyValueEditor';

interface Props {
  environment: Environment;
  isActive: boolean;
  onSave: (changes: { name: string; variables: KeyValue[] }) => Promise<void>;
  onActivate: () => void;
  onDelete: () => void;
}

export function EnvironmentEditor({
  environment,
  isActive,
  onSave,
  onActivate,
  onDelete,
}: Props) {
  const [name, setName] = useState(environment.name);
  const [variables, setVariables] = useState(environment.variables);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== environment.name ||
    JSON.stringify(variables) !== JSON.stringify(environment.variables);

  async function save() {
    setError(null);
    try {
      await onSave({ name, variables });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="pane-editor">
      <div className="editor-title-row">
        <span className="type-badge type-env">ENV</span>
        <input
          className="name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <button className="btn" onClick={save}>
          Save
        </button>
        {isActive ? (
          <span className="active-badge">Active</span>
        ) : (
          <button className="btn btn-ghost" onClick={onActivate}>
            Set Active
          </button>
        )}
        <button className="btn btn-danger-ghost" onClick={onDelete}>
          Delete
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <p className="muted">
        Variables can be referenced anywhere in a request as{' '}
        <code>{'{{variableName}}'}</code>.
      </p>
      <KeyValueEditor
        items={variables}
        onChange={setVariables}
        keyPlaceholder="variable"
        addLabel="Variable"
        variableSupport={false}
      />
    </div>
  );
}
