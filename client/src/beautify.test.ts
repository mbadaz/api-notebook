import { describe, expect, it } from 'vitest';
import { beautifyGraphql, beautifyJson, formatXml } from './beautify';

describe('beautifyJson', () => {
  it('pretty-prints valid JSON', () => {
    const out = beautifyJson('{"a":1,"b":[1,2]}');
    expect(out).toContain('\n  "a": 1');
    expect(out).toContain('"b": [');
  });

  it('preserves {{variables}} (in strings and bare values)', () => {
    const out = beautifyJson('{"u":"{{base}}/x","n":{{count}}}');
    expect(out).toContain('"u": "{{base}}/x"');
    expect(out).toContain('"n": {{count}}');
  });

  it('returns empty input unchanged and throws on unparseable input', () => {
    expect(beautifyJson('')).toBe('');
    expect(() => beautifyJson('{not json')).toThrow(/beautify/i);
  });
});

describe('beautifyGraphql', () => {
  it('formats a query and preserves {{variables}}', () => {
    const out = beautifyGraphql('{ user(id: {{uid}}) { name } }');
    expect(out).toContain('{{uid}}');
    expect(out).toContain('name');
    expect(out.split('\n').length).toBeGreaterThan(1);
  });

  it('throws on invalid GraphQL', () => {
    expect(() => beautifyGraphql('{ broken')).toThrow(/GraphQL/i);
  });
});

describe('formatXml', () => {
  it('re-indents nested elements', () => {
    const out = formatXml('<a><b>1</b></a>');
    expect(out.split('\n')).toEqual(['<a>', '  <b>1</b>', '</a>']);
  });
});
