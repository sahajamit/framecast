import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  BubbleGeometry,
  ExportFormat,
  LayoutKind,
  LibraryItem,
  MicProcessing,
  Phase,
  PresetId,
} from '../types';
import { DEFAULT_BUBBLE } from '../compositor/layout';

export interface Settings {
  theme: 'dark' | 'light';
  layout: LayoutKind;
  micEnabled: boolean;
  micId: string | null;
  camId: string | null;
  micProcessing: MicProcessing;
  /** Ask Chrome for tab/system audio when picking the capture surface. */
  captureSystemAudio: boolean;
  suppressLocalAudioPlayback: boolean;
  presetId: PresetId;
  exportFormat: ExportFormat;
  bubble: BubbleGeometry;
}

interface SessionState {
  phase: Phase;
  countdown: number;
  /** Recorded wall time excluding pauses (display only, never drives file timestamps). */
  accumulatedMs: number;
  /** performance.now() at the moment recording last (re)started; 0 while not running. */
  lastResumeAt: number;
  micMuted: boolean;
  /** Floating control deck (Document PiP) currently open. */
  pipOpen: boolean;
  /** Deck is open and waiting for the user to pick a screen ("armed"). */
  armed: boolean;
  error: string | null;
  reviewFileName: string | null;
}

interface DevicesState {
  cams: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  audioCodec: 'aac' | 'opus' | null;
}

interface LibraryState {
  /** 'folder' = user-picked directory via FSA; 'opfs' = browser storage (no FSA, e.g. Brave). */
  mode: 'folder' | 'opfs';
  dirName: string | null;
  connected: boolean;
  items: LibraryItem[];
  recoverable: string[];
}

export interface AppState {
  settings: Settings;
  session: SessionState;
  devices: DevicesState;
  library: LibraryState;
  view: 'record' | 'library';

  setView: (view: 'record' | 'library') => void;
  patchSettings: (patch: Partial<Settings>) => void;
  patchBubble: (patch: Partial<BubbleGeometry>) => void;
  setPhase: (phase: Phase) => void;
  patchSession: (patch: Partial<SessionState>) => void;
  setDevices: (patch: Partial<DevicesState>) => void;
  patchLibrary: (patch: Partial<LibraryState>) => void;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  layout: 'screen+camera',
  micEnabled: true,
  micId: null,
  camId: null,
  micProcessing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  captureSystemAudio: true,
  suppressLocalAudioPlayback: false,
  presetId: '1440p30',
  exportFormat: 'mp4',
  bubble: DEFAULT_BUBBLE,
};

const INITIAL_SESSION: SessionState = {
  phase: 'preflight',
  countdown: 0,
  accumulatedMs: 0,
  lastResumeAt: 0,
  micMuted: false,
  pipOpen: false,
  armed: false,
  error: null,
  reviewFileName: null,
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      session: INITIAL_SESSION,
      devices: { cams: [], mics: [], audioCodec: null },
      library: { mode: 'folder', dirName: null, connected: false, items: [], recoverable: [] },
      view: 'record',

      setView: (view) => set({ view }),
      patchSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      patchBubble: (patch) =>
        set((state) => ({
          settings: { ...state.settings, bubble: { ...state.settings.bubble, ...patch } },
        })),
      setPhase: (phase) => set((state) => ({ session: { ...state.session, phase } })),
      patchSession: (patch) => set((state) => ({ session: { ...state.session, ...patch } })),
      setDevices: (patch) => set((state) => ({ devices: { ...state.devices, ...patch } })),
      patchLibrary: (patch) => set((state) => ({ library: { ...state.library, ...patch } })),
    }),
    {
      name: 'framecast-settings',
      version: 2,
      partialize: (state) => ({ settings: state.settings }),
      migrate: (persisted, version) => {
        const state = persisted as Partial<Pick<AppState, 'settings'>>;
        if (version < 2 && state.settings) {
          state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
        }
        return state;
      },
    },
  ),
);

/** Elapsed recording time in ms, derived from the session clock fields. */
export function elapsedMs(session: SessionState): number {
  const running = session.phase === 'recording' && session.lastResumeAt > 0;
  return session.accumulatedMs + (running ? performance.now() - session.lastResumeAt : 0);
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
