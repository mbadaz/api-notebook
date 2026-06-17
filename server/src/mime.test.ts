import { describe, expect, it } from 'vitest';
import { guessMime } from './mime.js';

describe('guessMime', () => {
  it('maps known extensions (case-insensitive)', () => {
    expect(guessMime('/a/b/file.json')).toBe('application/json');
    expect(guessMime('photo.PNG')).toBe('image/png');
    expect(guessMime('archive.tar')).toBe('application/x-tar');
  });

  it('returns undefined for unknown extensions or no extension', () => {
    expect(guessMime('file.xyz')).toBeUndefined();
    expect(guessMime('noext')).toBeUndefined();
  });
});
