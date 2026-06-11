import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { VariablesContext } from '../variables';

interface Props {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  /** Applied to both the real input and the highlight mirror. */
  className?: string;
  wrapClassName?: string;
  placeholder?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

const TOKEN_SPLIT = /(\{\{\s*[\w.-]+\s*\}\})/g;
const TOKEN_EXACT = /^\{\{\s*([\w.-]+)\s*\}\}$/;

/**
 * If the caret sits inside an unclosed "{{prefix", returns the token start
 * and the partial variable name typed so far.
 */
function findOpenToken(
  value: string,
  caret: number
): { start: number; prefix: string } | null {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf('{{');
  if (start === -1) return null;
  const prefix = before.slice(start + 2);
  if (!/^[\w.-]*$/.test(prefix)) return null;
  return { start, prefix };
}

export function VarField({
  value,
  onChange,
  multiline = false,
  className = '',
  wrapClassName = '',
  placeholder,
  onKeyDown,
}: Props) {
  const { vars, envName } = useContext(VariablesContext);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ start: number; prefix: string } | null>(
    null
  );
  const [active, setActive] = useState(0);

  const names = Object.keys(vars);
  const matches = menu
    ? names.filter((n) =>
        n.toLowerCase().includes(menu.prefix.toLowerCase())
      )
    : [];

  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(
        pendingCaret.current,
        pendingCaret.current
      );
      pendingCaret.current = null;
    }
  });

  useEffect(() => {
    menuRef.current
      ?.querySelector('.active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, matches.length]);

  function updateMenu(el: HTMLInputElement | HTMLTextAreaElement) {
    const caret = el.selectionStart ?? 0;
    const token =
      el.selectionEnd === caret ? findOpenToken(el.value, caret) : null;
    if (token && token.prefix !== menu?.prefix) setActive(0);
    setMenu(token);
  }

  function pick(name: string) {
    const el = inputRef.current;
    if (!el || !menu) return;
    const caret = el.selectionStart ?? 0;
    // If the caret is inside an existing token ("{{base|Url}}"), replace
    // through its closing braces instead of duplicating them.
    const after = value.slice(caret);
    const tail = /^[\w.-]*\s*\}\}/.exec(after);
    const head = value.slice(0, menu.start + 2) + name + '}}';
    onChange(head + (tail ? after.slice(tail[0].length) : after));
    pendingCaret.current = head.length;
    setMenu(null);
    el.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (menu && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]);
        return;
      }
    }
    if (menu && e.key === 'Escape') {
      setMenu(null);
      return;
    }
    onKeyDown?.(e);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    onChange(e.target.value);
    updateMenu(e.target);
  }

  function syncScroll() {
    const el = inputRef.current;
    const backdrop = backdropRef.current;
    if (el && backdrop) {
      backdrop.scrollTop = el.scrollTop;
      backdrop.scrollLeft = el.scrollLeft;
    }
  }

  function renderHighlights(): ReactNode[] {
    return value.split(TOKEN_SPLIT).map((part, i) => {
      const m = TOKEN_EXACT.exec(part);
      if (!m) return <span key={i}>{part}</span>;
      return (
        <mark
          key={i}
          className={Object.hasOwn(vars, m[1]) ? 'var-ok' : 'var-missing'}
        >
          {part}
        </mark>
      );
    });
  }

  const shared = {
    value,
    placeholder,
    className: `var-input ${className}`,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onSelect: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) =>
      updateMenu(e.currentTarget),
    onScroll: syncScroll,
    onBlur: () => setMenu(null),
    spellCheck: false,
  };

  return (
    <div className={`var-field ${wrapClassName}`}>
      {multiline ? (
        <textarea
          {...shared}
          ref={(el) => {
            inputRef.current = el;
          }}
        />
      ) : (
        <input
          {...shared}
          ref={(el) => {
            inputRef.current = el;
          }}
        />
      )}
      <div
        ref={backdropRef}
        aria-hidden
        className={`var-highlight ${
          multiline ? 'var-highlight-multi' : 'var-highlight-single'
        } ${className}`}
      >
        {renderHighlights()}
        {multiline && '\n'}
      </div>
      {menu && (
        <ul className="var-menu" ref={menuRef}>
          {matches.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                className={i === active ? 'var-item active' : 'var-item'}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(name);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="var-item-name">{`{{${name}}}`}</span>
                <span className="var-item-value">{vars[name]}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="var-menu-empty">
              {envName === null
                ? 'No environment selected'
                : names.length === 0
                  ? `No variables in "${envName}"`
                  : 'No matching variables'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
