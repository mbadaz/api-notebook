import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';

export interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}

/**
 * WYSIWYG editor that reads and writes GitHub-flavored Markdown so the docs
 * keep living as clean `.md` files on disk. The editing surface shows
 * formatted text; `tiptap-markdown` does the Markdown <-> document round-trip.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
}: MarkdownEditorProps) {
  // Tracks the last Markdown we produced or accepted, so echoing our own
  // onChange back through `value` doesn't reset the document (and the caret).
  const lastValue = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Write documentation…',
      }),
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
      lastValue.current = md;
      onChange(md);
    },
  });

  // Sync in external changes (switching to a different request/collection)
  // without clobbering in-progress edits or fighting our own updates.
  useEffect(() => {
    if (editor && value !== lastValue.current) {
      lastValue.current = value;
      editor.commands.setContent(value, false);
    }
  }, [editor, value]);

  return (
    <div className="md-editor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="md-content md-rich" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="md-toolbar" />;

  const btn = (
    label: string,
    title: string,
    action: () => void,
    active?: boolean,
    disabled?: boolean
  ) => (
    <button
      type="button"
      className={active ? 'md-tool is-active' : 'md-tool'}
      title={title}
      disabled={disabled}
      // Keep the editor selection while clicking a toolbar button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {label}
    </button>
  );

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const addImage = () => {
    const url = window.prompt('Image URL', 'https://');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  return (
    <div className="md-toolbar">
      {btn('B', 'Bold (Cmd/Ctrl+B)', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
      {btn('I', 'Italic (Cmd/Ctrl+I)', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
      {btn('S', 'Strikethrough', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
      <span className="md-sep" />
      {btn('H1', 'Heading 1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
      {btn('H2', 'Heading 2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
      {btn('H3', 'Heading 3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
      <span className="md-sep" />
      {btn('•', 'Bullet list', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
      {btn('1.', 'Numbered list', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {btn('☑', 'Task list', () => editor.chain().focus().toggleTaskList().run(), editor.isActive('taskList'))}
      <span className="md-sep" />
      {btn('“', 'Quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
      {btn('</>', 'Code block', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
      {btn('`', 'Inline code', () => editor.chain().focus().toggleCode().run(), editor.isActive('code'))}
      <span className="md-sep" />
      {btn('🔗', 'Link', setLink, editor.isActive('link'))}
      {btn('🖼', 'Image', addImage)}
      {btn('▦', 'Insert table', () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {btn('―', 'Horizontal rule', () => editor.chain().focus().setHorizontalRule().run())}
      <span className="md-sep" />
      {btn('↺', 'Undo', () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
      {btn('↻', 'Redo', () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
    </div>
  );
}
