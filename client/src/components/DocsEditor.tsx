import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LazyMarkdownEditor } from './LazyMarkdownEditor';
import type { MarkdownEditorProps } from './MarkdownEditor';

/**
 * Documentation field with two modes:
 * - **preview** — read-only rendered Markdown (lightweight; the WYSIWYG editor
 *   isn't loaded). Default when there is existing documentation.
 * - **edit** — the WYSIWYG editor. Default when there is none.
 *
 * A single button toggles between them ("Done" while editing, "Edit" while
 * previewing).
 */
export function DocsEditor({ value, onChange, placeholder }: MarkdownEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>(
    value.trim() ? 'preview' : 'edit'
  );

  return (
    <div className="docs-editor">
      <div className="docs-mode-toolbar">
        {mode === 'edit' ? (
          <button className="btn btn-sm" onClick={() => setMode('preview')}>
            Done
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => setMode('edit')}>
            Edit
          </button>
        )}
      </div>

      {mode === 'edit' ? (
        <LazyMarkdownEditor
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
      ) : value.trim() ? (
        <div className="markdown-preview md-rich">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      ) : (
        <div className="markdown-preview">
          <p className="muted">No documentation yet — click Edit to add some.</p>
        </div>
      )}
    </div>
  );
}
