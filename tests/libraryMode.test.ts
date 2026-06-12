import { describe, expect, it } from 'vitest';
import { resolveLibraryMode } from '../src/library/fsAccess';

describe('resolveLibraryMode', () => {
  it('uses a user-picked folder when the FSA picker exists (Chrome/Edge)', () => {
    expect(resolveLibraryMode(true, false)).toBe('folder');
  });

  it('falls back to browser storage when the picker is missing (Brave default)', () => {
    expect(resolveLibraryMode(false, false)).toBe('opfs');
  });

  it('always uses browser storage in e2e mode, even with FSA available', () => {
    expect(resolveLibraryMode(true, true)).toBe('opfs');
    expect(resolveLibraryMode(false, true)).toBe('opfs');
  });
});
