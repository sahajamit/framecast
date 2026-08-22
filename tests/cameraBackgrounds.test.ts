import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lifecycle & concurrency test (CLAUDE.md testing conventions, kind 3).
 *
 * Pins: a user background deleted while its decode is still in flight
 * (issue #22).
 * Why not e2e: the bug needs evictUserBitmap() to land between the
 * IndexedDB read and createImageBitmap() resolving. Real Chrome gives no
 * way to schedule a click inside that window, and the fix's whole purpose
 * is to make the window harmless.
 *
 * Without a generation token the in-flight decode repopulates the cache for
 * an image the user has already deleted, so it keeps painting into takes and
 * its ImageBitmap is never closed.
 */

let resolveBlob: ((b: Blob | undefined) => void) | null = null;
let closed = 0;

vi.mock('../src/compositor/userBackgrounds', () => ({
  getUserBackgroundBlob: () =>
    new Promise<Blob | undefined>((res) => {
      resolveBlob = res;
    }),
  USER_BG_PREFIX: 'user:',
}));

const { evictUserBitmap, paintCameraBackgroundFill } = await import(
  '../src/compositor/cameraBackgrounds'
);

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** Records image draws and the gradient stops of every solid fill. */
function fakeCtx(): { drawn: number; fills: string[][] } {
  let stops: string[] = [];
  const self = {
    drawn: 0,
    fills: [] as string[][],
    drawImage() {
      self.drawn++;
    },
    createLinearGradient() {
      stops = [];
      return {
        addColorStop(_offset: number, color: string) {
          stops.push(color);
        },
      };
    },
    fillRect() {
      self.fills.push([...stops]);
    },
    fillStyle: '' as unknown,
    save() {},
    restore() {},
  };
  return self as unknown as { drawn: number; fills: string[][] };
}

/** Mirrors LOADING_FILL / MISSING_FILL in cameraBackgrounds.ts. */
const LOADING_FILL = ['#3a3f45', '#191c1f'];
const MISSING_FILL = ['#4c5661', '#2c343c'];

const BOX = { x: 0, y: 0, w: 100, h: 100 };

beforeEach(() => {
  resolveBlob = null;
  closed = 0;
  vi.stubGlobal('createImageBitmap', async () => ({
    width: 10,
    height: 10,
    close: () => {
      closed++;
    },
  }));
});

describe('user background cache eviction', () => {
  it('discards a decode that finishes after the image was evicted', async () => {
    const ctx = fakeCtx();
    const id = 'user:race';

    // First paint starts the load and paints the interim solid.
    paintCameraBackgroundFill(ctx as never, BOX, id as never);
    await flush(); // let the dynamic import land and the DB read start
    expect(resolveBlob).not.toBeNull();
    expect(ctx.fills.at(-1)).toEqual(LOADING_FILL);

    // User deletes the background while the decode is still in flight.
    evictUserBitmap(id);

    resolveBlob!(new Blob(['img']));
    await flush();

    // The superseded decode must be closed, not cached.
    expect(closed).toBe(1);
    expect(ctx.drawn).toBe(0);

    // The cache must not serve it. Painting again starts a fresh load, which
    // now finds nothing in IndexedDB, so the id settles on the 'missing'
    // solid rather than resurrecting the deleted image.
    paintCameraBackgroundFill(ctx as never, BOX, id as never);
    await flush();
    resolveBlob!(undefined);
    await flush();

    paintCameraBackgroundFill(ctx as never, BOX, id as never);
    expect(ctx.drawn).toBe(0);
    expect(ctx.fills.at(-1)).toEqual(MISSING_FILL);
  });

  it('caches and paints a decode that is not evicted', async () => {
    const ctx = fakeCtx();
    const id = 'user:keep';

    paintCameraBackgroundFill(ctx as never, BOX, id as never);
    await flush();
    resolveBlob!(new Blob(['img']));
    await flush();

    expect(closed).toBe(0);
    const before = ctx.drawn;
    paintCameraBackgroundFill(ctx as never, BOX, id as never);
    expect(ctx.drawn).toBe(before + 1);
  });
});
