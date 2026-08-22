import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Inferencer } from '../src/compositor/matting/types';

/**
 * Lifecycle & concurrency test (CLAUDE.md testing conventions, kind 3).
 *
 * Pins: a superseded high-tier model load installing itself after the
 * governor has moved on (issue #19).
 * Why not e2e: it needs a tier change to land inside the window where
 * import('./rvm') is in flight, and the high tier is gated off behind
 * HIGH_TIER_ENABLED, so a real browser never reaches this path at all.
 *
 * Only the high tier loads asynchronously (dynamic import of ./rvm), so that
 * is the model a stale spawn can wrongly install.
 */

let nowMs = 0;
const decisions: ('up' | 'down' | 'hold')[] = [];
let rvmCreated = 0;
let mediapipeCreated = 0;

/** Inferencers signal readiness asynchronously, as the real ones do. */
function fakeInferencer(onReady: () => void): Inferencer {
  const inf = {
    ready: false,
    failed: false,
    run: async () => null,
    close: () => undefined,
  };
  queueMicrotask(() => {
    inf.ready = true;
    onReady();
  });
  return inf as Inferencer;
}

vi.mock('../src/compositor/matting/refine', () => ({
  createMaskRefiner: () => null,
}));

vi.mock('../src/compositor/matting/mediapipe', () => ({
  createMediaPipeInferencer: (_delegate: string, onReady: () => void) => {
    mediapipeCreated++;
    return fakeInferencer(onReady);
  },
}));

vi.mock('../src/compositor/matting/rvm', () => ({
  createRvmInferencer: (onReady: () => void) => {
    rvmCreated++;
    return fakeInferencer(onReady);
  },
}));

vi.mock('../src/compositor/matting/tiers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/compositor/matting/tiers')>();
  return {
    ...real,
    detectCapabilities: () => ({}),
    // Ceiling at 'high' so the governor is allowed to upshift back into it.
    pickTier: () => 'high',
    QualityGovernor: class {
      inferMs = 0;
      configure(): void {}
      reset(): void {}
      noteDraw(): void {}
      noteInfer(): void {}
      setRecording(): void {}
      decide(): 'up' | 'down' | 'hold' {
        return decisions.shift() ?? 'hold';
      }
    },
  };
});

const { createMattingEngine } = await import('../src/compositor/matting/engine');

/** Lets every pending microtask (dynamic imports, onReady) settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** One governor tick. GOVERN_EVERY_MS is 250, so step past it every time. */
function tick(engine: { noteDrawTime: (ms: number, budget: number) => void }): void {
  nowMs += 300;
  engine.noteDrawTime(1, 16);
}

beforeEach(() => {
  nowMs = 0;
  decisions.length = 0;
  rvmCreated = 0;
  mediapipeCreated = 0;
  vi.stubGlobal('performance', { now: () => nowMs });
  // createMattingEngine returns null without OffscreenCanvas (jsdom/node).
  // The engine only allocates canvases on push(), which this test never calls.
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext(): null {
        return null;
      }
    },
  );
});

describe('matting engine spawn epoch', () => {
  it('discards an in-flight high-tier spawn when the tier moves on', async () => {
    const engine = createMattingEngine({ quality: 'auto' })!;
    await flush(); // construction spawned 'high'; let the rvm import land
    expect(engine.tier).toBe('high');
    expect(rvmCreated).toBe(1);

    // high -> balanced: different model kind, so a mediapipe swap is spawned.
    decisions.push('down');
    tick(engine);
    await flush();
    expect(engine.tier).toBe('balanced');
    expect(mediapipeCreated).toBe(1);

    // balanced -> high starts a fresh async rvm load, then balanced again
    // before it resolves. The second transition is same-kind as the model
    // currently serving, so the engine declines to spawn. Deliberately not
    // flushing between the two ticks: that is the race.
    decisions.push('up');
    tick(engine);
    decisions.push('down');
    tick(engine);
    await flush();

    expect(engine.tier).toBe('balanced');
    // Without the epoch bump the stale import resolves and attaches RVM here.
    expect(rvmCreated).toBe(1);

    engine.close();
  });
});
