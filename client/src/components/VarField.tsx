import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { highlightSegment, type SyntaxLanguage } from '../highlight';
import { VariablesContext } from '../variables';

interface Props {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  /** Applied to both the real input and the highlight mirror. */
  className?: string;
  wrapClassName?: string;
  placeholder?: string;
  /**
   * Syntax-highlight the content: the mirror renders the colored text and
   * the input's own text becomes transparent (caret stays visible).
   */
  syntax?: SyntaxLanguage;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

const TOKEN_SPLIT = /(\{\{\s*[\w.-]+\s*\}\})/g;
const TOKEN_EXACT = /^\{\{\s*([\w.-]+)\s*\}\}$/;
const POPUP_OPEN_DELAY_MS = 250;
const POPUP_CLOSE_DELAY_MS = 250;

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

/** Hover card showing (and editing) the hovered variable's current value. */
function VarPopup({
  name,
  onClose,
  onFocusChange,
}: {
  name: string;
  onClose: () => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const { envName, vars, definedNames, secretNames, setVariable } =
    useContext(VariablesContext);
  const exists = Object.hasOwn(vars, name);
  const defined = definedNames.includes(name);
  const secret = secretNames.includes(name);
  const [val, setVal] = useState(exists ? vars[name] : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  if (envName === null) {
    return (
      <p className="var-popup-msg">
        No environment selected — variables cannot resolve.
      </p>
    );
  }

  async function save() {
    if (cancelled.current || !setVariable || busy) return;
    if (exists && val === vars[name]) {
      onClose();
      return;
    }
    if (!exists && val === '') {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setVariable(name, val);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const status = exists
    ? `in "${envName}"`
    : defined
      ? 'no local value yet'
      : `not defined in "${envName}"`;

  return (
    <>
      <div className="var-popup-head">
        <span className="var-item-name">{`{{${name}}}`}</span>
        {secret && <span title="Secret — value stays local">🔒</span>}
        <span className={exists ? 'muted' : 'var-popup-warn'}>{status}</span>
      </div>
      <input
        className="var-popup-input"
        value={val}
        placeholder={exists ? 'Value' : 'Set a value…'}
        disabled={busy}
        onChange={(e) => setVal(e.target.value)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => {
          onFocusChange(false);
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelled.current = true;
            onFocusChange(false);
            onClose();
          }
        }}
      />
      {error && <p className="error-text">{error}</p>}
      <p className="var-popup-hint muted">
        {exists || defined
          ? 'Enter saves to the environment · Esc cancels'
          : `Enter creates it in "${envName}"`}
      </p>
    </>
  );
}

export function VarField({
  value,
  onChange,
  multiline = false,
  className = '',
  wrapClassName = '',
  placeholder,
  syntax,
  onKeyDown,
}: Props) {
  const { vars, envName } = useContext(VariablesContext);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popupFocused = useRef(false);
  const [menu, setMenu] = useState<{ start: number; prefix: string } | null>(
    null
  );
  const [active, setActive] = useState(0);
  const [popup, setPopup] = useState<{
    name: string;
    left: number;
    top: number;
  } | null>(null);

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

  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    },
    []
  );

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

  function scheduleOpen(name: string, mark: HTMLElement) {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    const markRect = mark.getBoundingClientRect();
    openTimer.current = setTimeout(() => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const wrapRect = wrap.getBoundingClientRect();
      const left = Math.max(
        0,
        Math.min(markRect.left - wrapRect.left, wrap.clientWidth - 300)
      );
      setPopup({ name, left, top: markRect.bottom - wrapRect.top + 4 });
    }, POPUP_OPEN_DELAY_MS);
  }

  function scheduleClose() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!popupFocused.current) setPopup(null);
    }, POPUP_CLOSE_DELAY_MS);
  }

  function closePopup() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    popupFocused.current = false;
    setPopup(null);
  }

  /** Marks intercept the mouse for hover, so put the caret back manually. */
  function forwardCaret(
    e: MouseEvent<HTMLElement>,
    caret: number
  ) {
    e.preventDefault();
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  }

  function renderHighlights(): ReactNode[] {
    const nodes: ReactNode[] = [];
    let offset = 0;
    let continuation: unknown;
    value.split(TOKEN_SPLIT).forEach((part, i) => {
      const end = offset + part.length;
      const m = TOKEN_EXACT.exec(part);
      if (!m) {
        if (syntax && part) {
          const seg = highlightSegment(part, syntax, continuation);
          continuation = seg.continuation;
          nodes.push(
            <span key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
          );
        } else {
          nodes.push(<span key={i}>{part}</span>);
        }
      } else {
        const name = m[1];
        nodes.push(
          <mark
            key={i}
            className={Object.hasOwn(vars, name) ? 'var-ok' : 'var-missing'}
            onMouseEnter={(e) => scheduleOpen(name, e.currentTarget)}
            onMouseLeave={scheduleClose}
            onMouseDown={(e) => forwardCaret(e, end)}
          >
            {part}
          </mark>
        );
      }
      offset = end;
    });
    return nodes;
  }

  const shared = {
    value,
    placeholder,
    className: `var-input ${syntax ? 'var-input-syntax ' : ''}${className}`,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onSelect: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) =>
      updateMenu(e.currentTarget),
    onScroll: syncScroll,
    onBlur: () => setMenu(null),
    spellCheck: false,
  };

  return (
    <div className={`var-field ${wrapClassName}`} ref={wrapRef}>
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
        } ${syntax ? 'var-highlight-syntax ' : ''}${className}`}
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
      {popup && !menu && (
        <div
          className="var-popup"
          style={{ left: popup.left, top: popup.top }}
          onMouseEnter={() => {
            clearTimeout(closeTimer.current);
          }}
          onMouseLeave={scheduleClose}
        >
          <VarPopup
            key={popup.name}
            name={popup.name}
            onClose={closePopup}
            onFocusChange={(focused) => {
              popupFocused.current = focused;
            }}
          />
        </div>
      )}
    </div>
  );
}
