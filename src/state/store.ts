import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  BubbleGeometry,
  CameraBackground,
  CameraLighting,
  ExportFormat,
  FrameSettings,
  LayoutKind,
  LibraryItem,
  MicProcessing,
  Phase,
  PresetId,
  ScreenFocus,
} from '../types';
import {
  DEFAULT_BUBBLE,
  DEFAULT_CAMERA_BACKGROUND,
  DEFAULT_FOCUS,
  DEFAULT_FRAME,
} from '../compositor/layout';
import { DEFAULT_CAMERA_LIGHTING } from '../compositor/lighting';
import { migrateSettings } from './persistMigrate';

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
  frame: FrameSettings;
  /** Virtual background for the camera bubble / headshot. */
  cameraBackground: CameraBackground;
  /** Lighting / colour grade for the camera bubble / headshot. */
  cameraLighting: CameraLighting;
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
  /** A display surface has been picked in preflight and is live. */
  screenReady: boolean;
  /** Friendly description of the picked surface ("browser tab", "window"…). */
  screenInfo: string | null;
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
  /** Live screen punch-in / spotlight. Transient (resets each take), not persisted. */
  focus: ScreenFocus;
  view: 'record' | 'library';

  setView: (view: 'record' | 'library') => void;
  patchSettings: (patch: Partial<Settings>) => void;
  patchBubble: (patch: Partial<BubbleGeometry>) => void;
  patchFrame: (patch: Partial<FrameSettings>) => void;
  patchCameraBackground: (patch: Partial<CameraBackground>) => void;
  patchCameraLighting: (patch: Partial<CameraLighting>) => void;
  patchScreenFocus: (patch: Partial<ScreenFocus>) => void;
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
  frame: DEFAULT_FRAME,
  cameraBackground: DEFAULT_CAMERA_BACKGROUND,
  cameraLighting: DEFAULT_CAMERA_LIGHTING,
};

const INITIAL_SESSION: SessionState = {
  phase: 'preflight',
  countdown: 0,
  accumulatedMs: 0,
  lastResumeAt: 0,
  micMuted: false,
  pipOpen: false,
  screenReady: false,
  screenInfo: null,
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
      focus: DEFAULT_FOCUS,
      view: 'record',

      setView: (view) => set({ view }),
      patchSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      patchBubble: (patch) =>
        set((state) => ({
          settings: { ...state.settings, bubble: { ...state.settings.bubble, ...patch } },
        })),
      patchFrame: (patch) =>
        set((state) => ({
          settings: { ...state.settings, frame: { ...state.settings.frame, ...patch } },
        })),
      patchCameraBackground: (patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            cameraBackground: { ...state.settings.cameraBackground, ...patch },
          },
        })),
      patchCameraLighting: (patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            cameraLighting: { ...state.settings.cameraLighting, ...patch },
          },
        })),
      patchScreenFocus: (patch) =>
        set((state) => ({ focus: { ...state.focus, ...patch } })),
      setPhase: (phase) => set((state) => ({ session: { ...state.session, phase } })),
      patchSession: (patch) => set((state) => ({ session: { ...state.session, ...patch } })),
      setDevices: (patch) => set((state) => ({ devices: { ...state.devices, ...patch } })),
      patchLibrary: (patch) => set((state) => ({ library: { ...state.library, ...patch } })),
    }),
    {
      name: 'framecast-settings',
      version: 5,
      // window.localStorage explicitly: Node's experimental localStorage
      // global shadows jsdom's working one in component tests.
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({ settings: state.settings }),
      migrate: (persisted, version) => migrateSettings(persisted, version, DEFAULT_SETTINGS),
      // Layer persisted settings over the current defaults so a field the stored
      // blob is missing (e.g. cameraBackground written by an older build, or a
      // blob left at a higher version from another branch where migrate is
      // skipped) always falls back to a default instead of being undefined.
      merge: (persisted, current) => {
        const p = persisted as Partial<Pick<AppState, 'settings'>> | undefined;
        return {
          ...current,
          settings: { ...current.settings, ...(p?.settings ?? {}) },
        };
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
