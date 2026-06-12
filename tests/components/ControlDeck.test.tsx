// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const togglePause = vi.fn();
const stopRecording = vi.fn();
vi.mock('../../src/app/controller', () => ({
  setMicMuted: vi.fn(),
  stopRecording: (...args: unknown[]) => stopRecording(...args),
  togglePause: (...args: unknown[]) => togglePause(...args),
  updateBubble: vi.fn(),
}));

import { ControlDeck } from '../../src/pip/ControlDeck';
import { useStore } from '../../src/state/store';

describe('ControlDeck transport', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().patchSession({ phase: 'preflight', micMuted: false });
  });

  it('disables transport buttons outside an active take', () => {
    render(<ControlDeck windowRef={window} />);
    expect(screen.getByRole('button', { name: /pause/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /stop & save/i })).toBeDisabled();
  });

  it('enables pause and stop while recording', () => {
    useStore.getState().patchSession({ phase: 'recording' });
    render(<ControlDeck windowRef={window} />);
    expect(screen.getByRole('button', { name: /pause/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /stop & save/i })).toBeEnabled();
  });

  it('shows resume + paused badge while paused', () => {
    useStore.getState().patchSession({ phase: 'paused' });
    render(<ControlDeck windowRef={window} />);
    expect(screen.getByRole('button', { name: /resume/i })).toBeEnabled();
    expect(screen.getByText(/^paused$/i)).toBeInTheDocument();
  });

  it('hides bubble controls outside screen+camera layout', () => {
    useStore.getState().patchSettings({ layout: 'screen' });
    useStore.getState().patchSession({ phase: 'recording' });
    render(<ControlDeck windowRef={window} />);
    expect(screen.queryByText(/cam zoom/i)).not.toBeInTheDocument();
    useStore.getState().patchSettings({ layout: 'screen+camera' });
  });
});
