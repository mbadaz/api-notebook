import { useState } from 'react';
import { api } from '../api';
import type { FormDataField } from '../types';
import { VarField } from './VarField';

interface Props {
  items: FormDataField[];
  onChange: (items: FormDataField[]) => void;
}

export function FormDataEditor({ items, onChange }: Props) {
  const [browsing, setBrowsing] = useState<number | null>(null);

  const update = (index: number, patch: Partial<FormDataField>) =>
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  async function browse(index: number) {
    setBrowsing(index);
    try {
      const { path } = await api.pickFile('Choose a file for this form field');
      if (path) update(index, { value: path });
    } finally {
      setBrowsing(null);
    }
  }

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
          <VarField
            className="kv-key"
            wrapClassName="kv-key"
            value={item.key}
            placeholder="field"
            onChange={(key) => update(i, { key })}
          />
          <select
            className="formdata-type"
            value={item.type}
            onChange={(e) =>
              update(i, { type: e.target.value as 'text' | 'file', value: '' })
            }
          >
            <option value="text">Text</option>
            <option value="file">File</option>
          </select>
          {item.type === 'text' ? (
            <VarField
              className="kv-value"
              wrapClassName="kv-value"
              value={item.value}
              placeholder="Value"
              onChange={(value) => update(i, { value })}
            />
          ) : (
            <div className="file-cell">
              <VarField
                className="kv-value"
                wrapClassName="kv-value"
                value={item.value}
                placeholder="/path/to/file"
                onChange={(value) => update(i, { value })}
              />
              <button
                className="btn btn-sm"
                disabled={browsing === i}
                onClick={() => browse(i)}
              >
                {browsing === i ? '…' : 'Browse…'}
              </button>
            </div>
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
          onChange([
            ...items,
            { key: '', value: '', type: 'text', enabled: true },
          ])
        }
      >
        + Field
      </button>
    </div>
  );
}
