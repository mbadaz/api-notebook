import { parse, print } from 'graphql';

const TOKEN_RE = /\{\{\s*[\w.-]+\s*\}\}/;

/**
 * Pretty-print JSON that may contain {{variable}} tokens. Tokens inside
 * strings are kept in place; tokens used as bare values ("id": {{userId}})
 * are temporarily quoted so the document parses, then restored.
 */
export function beautifyJson(text: string): string {
  if (!text.trim()) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Fall through to the variable-aware attempt.
  }

  const tokens: string[] = [];
  let replaced = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString && ch === '\\') {
      replaced += ch + (text[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      replaced += ch;
      continue;
    }
    if (ch === '{' && text[i + 1] === '{') {
      const m = TOKEN_RE.exec(text.slice(i));
      if (m && m.index === 0) {
        // Distinct sentinels per context: S keeps its surrounding string
        // quotes on restore, B sheds the quotes we added to parse.
        const n = tokens.length;
        tokens.push(m[0]);
        replaced += inString ? `«S${n}»` : `"«B${n}»"`;
        i += m[0].length - 1;
        continue;
      }
    }
    replaced += ch;
  }

  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(replaced), null, 2);
  } catch {
    throw new Error('Cannot beautify: not valid JSON (even allowing for {{variables}}).');
  }
  return formatted
    .replace(/"«B(\d+)»"/g, (_, n: string) => tokens[Number(n)])
    .replace(/«S(\d+)»/g, (_, n: string) => tokens[Number(n)]);
}

/**
 * Pretty-print a GraphQL document that may contain {{variable}} tokens
 * (swapped for valid names while parsing, then restored).
 */
export function beautifyGraphql(query: string): string {
  if (!query.trim()) return query;
  const tokens: string[] = [];
  const replaced = query.replace(new RegExp(TOKEN_RE, 'g'), (m) => {
    tokens.push(m);
    return `__APINB_V${tokens.length - 1}__`;
  });
  let printed: string;
  try {
    printed = print(parse(replaced));
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : '';
    throw new Error(`Cannot beautify: not valid GraphQL. ${detail}`.trim());
  }
  return printed.replace(/__APINB_V(\d+)__/g, (_, n: string) => tokens[Number(n)]);
}

const XML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Best-effort re-indentation of XML/HTML for the pretty response view. */
export function formatXml(xml: string): string {
  const withBreaks = xml.replace(/>\s*</g, '>\n<').replace(/\r\n/g, '\n');
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g;
  let depth = 0;
  const out: string[] = [];
  for (const rawLine of withBreaks.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const startsWithClose = /^<\//.test(line);
    if (startsWithClose) depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + line);
    // Net depth change from all tags on the line (self-closing and void
    // tags are neutral; the leading close tag was already applied).
    let delta = startsWithClose ? 1 : 0;
    for (const m of line.matchAll(tagRe)) {
      if (m[1] === '/') delta--;
      else if (m[3] !== '/' && !XML_VOID_TAGS.has(m[2].toLowerCase())) delta++;
    }
    depth = Math.max(0, depth + delta);
  }
  return out.join('\n');
}
