// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/**
 * Component test that pins a lifecycle leak (CLAUDE.md testing conventions:
 * kind 2 mechanism, kind 3 intent).
 *
 * Pins: object URLs minted after the picker unmounts (issue #24). The thumb
 * loop awaits IndexedDB per entry, so an unmount partway through leaves every
 * URL created afterwards unrevoked; imports leaked one URL each for the same
 * reason.
 * Why not e2e: it requires the component to unmount between two awaits inside
 * one loop. A browser gives no way to land a navigation in that window.
 */

const entries = [
  { id: 'user:a', label: 'a', addedAt: 1 },
  { id: 'user:b', label: 'b', addedAt: 2 },
];

/** Per-id gates so the loop can be suspended mid-flight. */
let gates: Record<string, (b: Blob | undefined) => void> = {};

vi.mock('../../src/compositor/userBackgrounds', () => ({
  listUserBackgrounds: async () => entries,
  getUserBackgroundThumb: (id: string) =>
    new Promise<Blob | undefined>((res) => {
      gates[id] = res;
    }),
  importUserBackground: vi.fn(),
  removeUserBackground: vi.fn(),
}));

vi.mock('../../src/compositor/cameraBackgrounds', () => ({
  CAMERA_BACKGROUNDS: [],
  evictUserBitmap: vi.fn(),
  paintCameraBackgroundFill: vi.fn(),
}));

const { CameraBackgroundPicker } = await import('../../src/ui/CameraBackgroundPicker');

let created: string[] = [];
let revoked: string[] = [];
let seq = 0;

beforeEach(() => {
  cleanup();
  gates = {};
  created = [];
  revoked = [];
  seq = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      const u = `blob:${++seq}`;
      created.push(u);
      return u;
    },
    revokeObjectURL: (u: string) => {
      revoked.push(u);
    },
  });
});

describe('CameraBackgroundPicker object URLs', () => {
  it('revokes every thumbnail URL it created', async () => {
    const { unmount } = render(<CameraBackgroundPicker value="slate" onChange={() => {}} />);

    await waitFor(() => expect(gates['user:a']).toBeTypeOf('function'));
    gates['user:a']!(new Blob(['a']));
    await waitFor(() => expect(gates['user:b']).toBeTypeOf('function'));
    gates['user:b']!(new Blob(['b']));

    await waitFor(() => expect(created).toHaveLength(2));
    unmount();

    expect(revoked.sort()).toEqual(created.sort());
  });

  it('creates no URL for a thumbnail that resolves after unmount', async () => {
    const { unmount } = render(<CameraBackgroundPicker value="slate" onChange={() => {}} />);

    // First thumb lands, second is still pending when the picker goes away.
    await waitFor(() => expect(gates['user:a']).toBeTypeOf('function'));
    gates['user:a']!(new Blob(['a']));
    await waitFor(() => expect(created).toHaveLength(1));

    unmount();
    gates['user:b']!(new Blob(['b']));
    await new Promise((r) => setTimeout(r, 0));

    // The late thumb must not mint a URL: cleanup has already run, so nothing
    // would ever revoke it.
    expect(created).toHaveLength(1);
    expect(revoked).toEqual(created);
  });
});
