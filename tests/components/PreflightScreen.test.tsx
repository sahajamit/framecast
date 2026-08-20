// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  updateFrame: vi.fn(),
  updateCameraBackground: vi.fn(),
  updateFocus: vi.fn(),
  resetFocus: vi.fn(),
}));

import { HeaderRollTape, PreflightScreen } from '../../src/app/PreflightScreen';
import { updateCameraBackground } from '../../src/app/controller';
import { useStore } from '../../src/state/store';

function setSession(patch: Parameters<ReturnType<typeof useStore.getState>['patchSession']>[0]) {
  useStore.getState().patchSession(patch);
}

// The controls live in a tabbed panel now; open a tab before asserting its body.
function openTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

describe('PreflightScreen gating', () => {
  beforeEach(() => {
    cleanup();
    setSession({ screenReady: false, screenInfo: null });
    useStore.getState().patchSettings({ layout: 'screen+camera' });
    useStore.getState().patchCameraBackground({ mode: 'none', blur: 18, builtinId: 'studio' });
  });

  // Roll tape lives in the app header rail now (always in view no matter how
  // long a tab grows); render it alongside the screen to assert the gating.
  it('disables Start and shows the select-screen step until a screen is picked', () => {
    render(
      <>
        <HeaderRollTape />
        <PreflightScreen />
      </>,
    );
    expect(screen.getByRole('button', { name: /select screen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /roll tape/i })).toBeDisabled();
    expect(screen.getByText(/select a screen to arm/i)).toBeInTheDocument();
  });

  it('enables Start and shows sharing controls once a screen is live', () => {
    setSession({ screenReady: true, screenInfo: 'browser tab (viewport only)' });
    render(
      <>
        <HeaderRollTape />
        <PreflightScreen />
      </>,
    );
    expect(screen.getByText('browser tab (viewport only)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop share/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /roll tape/i })).toBeEnabled();
  });

  it('camera-only layout needs no screen but does need a camera', () => {
    useStore.getState().patchSettings({ layout: 'camera' });
    render(
      <>
        <HeaderRollTape />
        <PreflightScreen />
      </>,
    );
    expect(screen.queryByRole('button', { name: /select screen/i })).not.toBeInTheDocument();
    // No camera stream in jsdom -> still disabled, with the waiting hint.
    expect(screen.getByRole('button', { name: /roll tape/i })).toBeDisabled();
    expect(screen.getByText(/waiting for the camera/i)).toBeInTheDocument();
  });

  it('renders the Scene framing module with its controls', () => {
    render(<PreflightScreen />);
    openTab('Scene');
    expect(screen.getByRole('group', { name: /backdrop/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Padding')).toBeInTheDocument();
    expect(screen.getByLabelText('Corner radius')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /drop shadow/i })).toBeInTheDocument();
  });

  it('renders the Camera background control and dispatches a mode change', () => {
    vi.mocked(updateCameraBackground).mockClear();
    render(<PreflightScreen />);
    openTab('Camera');
    const group = screen.getByRole('group', { name: /^camera background$/i });
    expect(group).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'Blur' }));
    expect(updateCameraBackground).toHaveBeenCalledWith({ mode: 'blur' });
  });

  it('reveals the built-in backdrop picker only in Backdrop mode', () => {
    render(<PreflightScreen />);
    openTab('Camera');
    // No swatch picker while mode is None.
    expect(screen.queryByRole('group', { name: /camera backdrop/i })).not.toBeInTheDocument();

    useStore.getState().patchCameraBackground({ mode: 'builtin' });
    cleanup();
    render(<PreflightScreen />);
    openTab('Camera');
    const bg = screen.getByRole('group', { name: /camera backdrop/i });
    expect(bg).toBeInTheDocument();
    expect(within(bg).getByLabelText('Studio')).toBeInTheDocument();
  });

  it('renders the Focus (live zoom) module with its controls', () => {
    render(<PreflightScreen />);
    openTab('Focus');
    expect(screen.getByRole('group', { name: /focus/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Screen zoom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /punch/i })).toBeInTheDocument();
  });
});
