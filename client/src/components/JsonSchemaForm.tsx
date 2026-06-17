import { useState } from 'react';

/** The subset of JSON Schema the form understands; unknown shapes fall back to JSON. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
  items?: JsonSchema;
}

interface Props {
  schema: JsonSchema | undefined;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

function typeOf(schema: JsonSchema): string {
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  return t ?? (schema.enum ? 'enum' : 'json');
}

/** A minimal form generated from a tool's JSON Schema (object of scalars). */
export function JsonSchemaForm({ schema, value, onChange }: Props) {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const names = Object.keys(properties);

  if (names.length === 0) {
    return <p className="muted">This tool takes no arguments.</p>;
  }

  const setField = (name: string, fieldValue: unknown) => {
    const next = { ...value };
    if (fieldValue === undefined) delete next[name];
    else next[name] = fieldValue;
    onChange(next);
  };

  return (
    <div className="schema-form">
      {names.map((name) => (
        <SchemaField
          key={name}
          name={name}
          schema={properties[name]}
          required={required.has(name)}
          value={value[name]}
          onChange={(v) => setField(name, v)}
        />
      ))}
    </div>
  );
}

function SchemaField({
  name,
  schema,
  required,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const kind = schema.enum ? 'enum' : typeOf(schema);
  const label = (
    <label className="field-label">
      {name}
      {required && <span className="required-mark"> *</span>}
      {schema.description && <span className="field-hint"> — {schema.description}</span>}
    </label>
  );

  if (kind === 'boolean') {
    return (
      <div className="schema-field">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {name}
          {required && <span className="required-mark"> *</span>}
        </label>
        {schema.description && <p className="muted">{schema.description}</p>}
      </div>
    );
  }

  if (kind === 'enum') {
    const options = schema.enum ?? [];
    return (
      <div className="schema-field">
        {label}
        <select
          className="method-select"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        >
          <option value="">(choose)</option>
          {options.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (kind === 'number' || kind === 'integer') {
    return (
      <div className="schema-field">
        {label}
        <input
          className="kv-value"
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(undefined);
            const n = kind === 'integer' ? parseInt(raw, 10) : Number(raw);
            onChange(Number.isNaN(n) ? raw : n);
          }}
        />
      </div>
    );
  }

  if (kind === 'string') {
    return (
      <div className="schema-field">
        {label}
        <input
          className="kv-value"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      </div>
    );
  }

  // Fallback for arrays/objects/anyOf/etc: a validated JSON textarea.
  return <JsonField label={label} value={value} onChange={onChange} />;
}

function JsonField({
  label,
  value,
  onChange,
}: {
  label: React.ReactNode;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() =>
    value === undefined ? '' : JSON.stringify(value, null, 2)
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="schema-field">
      {label}
      <textarea
        className="code-area"
        value={text}
        spellCheck={false}
        placeholder="JSON value"
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === '') {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(raw));
            setError(null);
          } catch {
            setError('Invalid JSON');
          }
        }}
      />
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
