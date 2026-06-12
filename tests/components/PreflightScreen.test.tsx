// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// The capture/controller layer touches getUserMedia & friends, which don't
// exist in jsdom — stub it so these tests cover render gating only.
vi.mock('../../src/app/controller', () => ({
  onMediaChanged: () => () => {},
  selectScreen: vi.fn(),
  startFlow: vi.fn(),
  stopScreenShare: vi.fn(),
  syncCamera: vi.fn(),
  syncMic: vi.fn(),
  toast: vi.fn(),
  updateBubble: vi.fn(),
}));

import { PreflightScreen } from '../../src/app/PreflightScreen';
import { useStore } from '../../src/state/store';

function setSession(patch: Parameters<ReturnType<typeof useStore.getState>['patchSession']>[0]) {
  useStore.getState().patchSession(patch);
}

describe('PreflightScreen gating', () => {
  beforeEach(() => {
    cleanup();
    setSession({ screenReady: false, screenInfo: null });
    useStore.getState().patchSettings({ layout: 'screen+camera' });
  });

  it('disables Start and shows the select-screen step until a screen is picked', () => {
    render(<PreflightScreen />);
    expect(screen.getByRole('button', { name: /select screen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start recording/i })).toBeDisabled();
    expect(screen.getByText(/select a screen above/i)).toBeInTheDocument();
  });

  it('enables Start and shows sharing controls once a screen is live', () => {
    setSession({ screenReady: true, screenInfo: 'browser tab (viewport only)' });
    render(<PreflightScreen />);
    expect(screen.getByText('browser tab (viewport only)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop sharing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start recording/i })).toBeEnabled();
  });

  it('camera-only layout needs no screen but does need a camera', () => {
    useStore.getState().patchSettings({ layout: 'camera' });
    render(<PreflightScreen />);
    expect(screen.queryByRole('button', { name: /select screen/i })).not.toBeInTheDocument();
    // No camera stream in jsdom -> still disabled, with the waiting hint.
    expect(screen.getByRole('button', { name: /start recording/i })).toBeDisabled();
    expect(screen.getByText(/waiting for the camera/i)).toBeInTheDocument();
  });
});
