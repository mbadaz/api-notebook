import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import graphql from 'highlight.js/lib/languages/graphql';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('css', css);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('graphql', graphql);

export type SyntaxLanguage = 'json' | 'xml' | 'javascript' | 'css' | 'yaml' | 'graphql';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function highlightCode(code: string, language: SyntaxLanguage): string {
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Highlight one fragment of a larger document, carrying parser state
 * across fragments (so e.g. a string interrupted by a {{variable}} token
 * keeps its string coloring afterwards).
 */
export function highlightSegment(
  code: string,
  language: SyntaxLanguage,
  continuation: unknown
): { html: string; continuation: unknown } {
  try {
    // `continuation` is real but absent from the public typings.
    const options: {
      language: string;
      ignoreIllegals: boolean;
      continuation?: unknown;
    } = { language, ignoreIllegals: true };
    if (continuation) options.continuation = continuation;
    const result = hljs.highlight(code, options);
    return {
      html: result.value,
      continuation: (result as unknown as { _top?: unknown })._top,
    };
  } catch {
    return { html: escapeHtml(code), continuation: undefined };
  }
}

/** Map a response content-type to a highlight language, or null for plain. */
export function contentTypeLanguage(
  contentType: string
): SyntaxLanguage | null {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html') || ct.includes('xml')) return 'xml';
  if (ct.includes('javascript') || ct.includes('ecmascript')) return 'javascript';
  if (ct.includes('css')) return 'css';
  if (ct.includes('yaml') || ct.includes('yml')) return 'yaml';
  if (ct.includes('graphql')) return 'graphql';
  return null;
}
