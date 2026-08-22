import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lifecycle & concurrency test (CLAUDE.md testing conventions, kind 3).
 *
 * Pins: two imports interleaving on the user-background index (issue #18).
 * Why not e2e: the bug needs a second import to begin between the first
 * import's index read and its index write. Real Chrome offers no way to
 * schedule that; the whole point of the fix is that the window closes.
 *
 * The index is a read-modify-write. idb-keyval's get + set are two separate
 * transactions; update() is one. This mock models exactly that difference:
 * get/set yield to the microtask queue between read and write (so callers
 * interleave), while update() serialises on a chain the way a single
 * readwrite transaction does. A get-then-set implementation therefore loses
 * an entry here, which is the regression these tests guard.
 */
const store = new Map<string, unknown>();
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
let txChain: Promise<unknown> = Promise.resolve();

vi.mock('idb-keyval', () => ({
  get: async (k: string) => {
    await tick();
    return store.get(k);
  },
  set: async (k: string, v: unknown) => {
    await tick();
    store.set(k, v);
  },
  del: async (k: string) => {
    await tick();
    store.delete(k);
  },
  update: (k: string, fn: (prev: unknown) => unknown) => {
    const run = txChain.then(async () => {
      await tick();
      const next = fn(store.get(k));
      await tick();
      store.set(k, next);
    });
    txChain = run.catch(() => undefined);
    return run;
  },
}));

const { importUserBackground, listUserBackgrounds, removeUserBackground } = await import(
  '../src/compositor/userBackgrounds'
);

let seq = 0;

beforeEach(() => {
  store.clear();
  txChain = Promise.resolve();
  seq = 0;
  vi.stubGlobal('indexedDB', {});
  vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++seq}` });
  vi.stubGlobal('createImageBitmap', async () => ({
    width: 100,
    height: 100,
    close: () => undefined,
  }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext(): { drawImage: () => void } {
        return { drawImage: () => undefined };
      }
      convertToBlob(): Promise<Blob> {
        return Promise.resolve(new Blob(['x']));
      }
    },
  );
});

const fileNamed = (name: string): File => ({ name }) as File;

describe('user background index', () => {
  it('keeps both entries when two imports run concurrently', async () => {
    const [a, b] = await Promise.all([
      importUserBackground(fileNamed('one.png')),
      importUserBackground(fileNamed('two.png')),
    ]);

    const index = await listUserBackgrounds();
    expect(index).toHaveLength(2);
    expect(index.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('keeps the surviving entry when a removal races an import', async () => {
    const first = await importUserBackground(fileNamed('first.png'));

    const [, second] = await Promise.all([
      removeUserBackground(first.id),
      importUserBackground(fileNamed('second.png')),
    ]);

    const index = await listUserBackgrounds();
    expect(index.map((e) => e.id)).toEqual([second.id]);
  });

  it('drops the blobs of a removed background', async () => {
    const entry = await importUserBackground(fileNamed('gone.png'));
    await removeUserBackground(entry.id);

    expect(store.has(`camera-bg:img:${entry.id}`)).toBe(false);
    expect(store.has(`camera-bg:thumb:${entry.id}`)).toBe(false);
    expect(await listUserBackgrounds()).toEqual([]);
  });
});
