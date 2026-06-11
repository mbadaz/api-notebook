import type { KeyValue } from '../types';
import { VarField } from './VarField';

interface Props {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  /** Disable {{variable}} autocomplete/highlighting (e.g. when defining variables). */
  variableSupport?: boolean;
  /** Show the per-row secret toggle (environment variables only). */
  secretSupport?: boolean;
}

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  addLabel = 'Add',
  variableSupport = true,
  secretSupport = false,
}: Props) {
  const update = (index: number, patch: Partial<KeyValue>) =>
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  return (
    <div className="kv-editor">
      {items.map((item, i) => (
        <div className="kv-row" key={i}>
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            title="Enabled"
          />
          {variableSupport ? (
            <>
              <VarField
                className="kv-key"
                wrapClassName="kv-key"
                value={item.key}
                placeholder={keyPlaceholder}
                onChange={(key) => update(i, { key })}
              />
              <VarField
                className="kv-value"
                wrapClassName="kv-value"
                value={item.value}
                placeholder={valuePlaceholder}
                onChange={(value) => update(i, { value })}
              />
            </>
          ) : (
            <>
              <input
                className="kv-key"
                value={item.key}
                placeholder={keyPlaceholder}
                onChange={(e) => update(i, { key: e.target.value })}
              />
              <input
                className={
                  item.secret && !item.value
                    ? 'kv-value kv-secret-missing'
                    : 'kv-value'
                }
                value={item.value}
                placeholder={
                  item.secret && !item.value
                    ? 'missing — set your local value'
                    : valuePlaceholder
                }
                title={
                  item.secret && !item.value
                    ? 'This secret has no value on this machine yet'
                    : undefined
                }
                onChange={(e) => update(i, { value: e.target.value })}
              />
            </>
          )}
          {secretSupport && (
            <button
              className={
                item.secret ? 'icon-btn lock-btn locked' : 'icon-btn lock-btn'
              }
              title={
                item.secret
                  ? 'Secret: value is stored in the gitignored .local.json file. Click to make it shared.'
                  : 'Shared: value is committed with the environment file. Click to make it secret.'
              }
              onClick={() => update(i, { secret: !item.secret })}
            >
              {item.secret ? '🔒' : '🔓'}
            </button>
          )}
          <button
            className="icon-btn"
            title="Remove"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="btn btn-ghost"
        onClick={() =>
          onChange([...items, { key: '', value: '', enabled: true }])
        }
      >
        + {addLabel}
      </button>
    </div>
  );
}
