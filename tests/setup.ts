/**
 * Node's experimental `localStorage` (without --localstorage-file) leaks into
 * vitest workers with non-functional methods. Replace it with a working
 * in-memory Storage so zustand's persist middleware behaves in tests.
 */
function storageIsBroken(target: { localStorage?: Storage }): boolean {
  try {
    target.localStorage?.setItem('__probe__', '1');
    target.localStorage?.removeItem('__probe__');
    return false;
  } catch {
    return true;
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

for (const target of [globalThis, typeof window !== 'undefined' ? window : null]) {
  if (target && storageIsBroken(target as { localStorage?: Storage })) {
    Object.defineProperty(target, 'localStorage', { value: memoryStorage(), writable: true });
  }
}
