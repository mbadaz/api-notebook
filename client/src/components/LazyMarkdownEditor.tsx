import { lazy, Suspense } from 'react';
import type { MarkdownEditorProps } from './MarkdownEditor';

// TipTap and its extensions are sizeable, so load them only when a docs
// editor is actually shown (Docs tab opened, or a collection selected)
// rather than in the initial bundle. The `import type` above is erased at
// build time and does not pull the chunk in eagerly.
const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor }))
);

export function LazyMarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense
      fallback={<div className="md-editor md-loading">Loading editor…</div>}
    >
      <MarkdownEditor {...props} />
    </Suspense>
  );
}
