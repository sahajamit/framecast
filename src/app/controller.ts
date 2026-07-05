/**
 * Orchestrates the recording lifecycle between the UI, capture layer and the
 * recording engine. All functions are module-level so both the main window UI
 * and the PiP deck call into the same instance.
 */
import { useStore } from '../state/store';
import type {
  BubbleGeometry,
  CameraBackground,
  CameraLighting,
  FrameSettings,
  ScreenFocus,
} from '../types';
import { DEFAULT_FOCUS } from '../compositor/layout';
import { prefersReducedMotion } from '../ui/reducedMotion';
import { runtime } from '../recorder/runtime';
import { prepareSession } from '../recorder/recordingSession';
import { PRESETS, probeAudioCodec } from '../recorder/encoderConfig';
import { listRecoverableParts } from '../recorder/recovery';
import { createAudioGraph } from '../audio/audioGraph';
import { captureSurfaceOf, getDisplayStream } from '../capture/displayCapture';
import { getCameraStream } from '../capture/cameraCapture';
import { getMicStream } from '../capture/micCapture';
import { listDevices, onDeviceChange, primePermissions } from '../capture/devices';
import {
  getSavedDir,
  isE2E,
  libraryMode,
  OPFS_DIR_LABEL,
  pickLibraryDir,
  queryDirPermission,
  requestDirPermission,
  requestPersistence,
} from '../library/fsAccess';
import { scanLibrary } from '../library/scan';
import { openPipWindow, pipSupported } from '../pip/pipWindow';

const store = () => useStore.getState();

let countdownTimer: ReturnType<typeof setInterval> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string): void {
  store().patchSession({ error: message });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => store().patchSession({ error: null }), 6000);
}

/* ---------- boot ---------- */

export async function bootApp(): Promise<void> {
  void probeAudioCodec().then((codec) => store().setDevices({ audioCodec: codec }));

  const granted = await primePermissions();
  if (!granted) {
    toast('Camera/microphone permission was denied — you can still record screen-only.');
  }
  await refreshDevices();
  onDeviceChange(() => void refreshDevices());

  const mode = libraryMode();
  store().patchLibrary({ mode });
  if (mode === 'opfs') {
    // No folder picker on this browser (e.g. Brave ships with the File System
    // Access API disabled): recordings live in OPFS, Download is the export.
    runtime.libraryDir = await getSavedDir();
    store().patchLibrary({ dirName: OPFS_DIR_LABEL, connected: true });
    void requestPersistence();
    await refreshLibrary();
  } else {
    const dir = await getSavedDir();
    if (dir) {
      runtime.libraryDir = dir;
      const permission = await queryDirPermission(dir);
      store().patchLibrary({ dirName: dir.name, connected: permission === 'granted' });
      if (permission === 'granted') await refreshLibrary();
    }
  }

  store().patchLibrary({ recoverable: await listRecoverableParts() });
}

async function refreshDevices(): Promise<void> {
  const { cams, mics } = await listDevices();
  store().setDevices({ cams, mics });
}

/* ---------- preflight media ---------- */

export async function syncCamera(): Promise<void> {
  const { settings } = store();
  const wantCamera = settings.layout !== 'screen';
  if (!wantCamera) {
    stopStream(runtime.cameraStream);
    runtime.cameraStream = null;
    return;
  }
  const current = runtime.cameraStream?.getVideoTracks()[0];
  const currentId = current?.getSettings().deviceId ?? null;
  if (current && current.readyState === 'live' && (!settings.camId || currentId === settings.camId)) {
    return;
  }
  stopStream(runtime.cameraStream);
  runtime.cameraStream = null;
  try {
    runtime.cameraStream = await getCameraStream(settings.camId);
    notifyMediaChanged();
  } catch {
    toast('Could not open the camera. Check permission and that no other app is using it.');
  }
}

export async function syncMic(): Promise<void> {
  const { settings } = store();
  if (!settings.micEnabled) {
    stopStream(runtime.micStream);
    runtime.micStream = null;
    runtime.audioGraph?.attachMic(null);
    return;
  }
  stopStream(runtime.micStream);
  try {
    runtime.micStream = await getMicStream(settings.micId, settings.micProcessing);
    ensureAudioGraph().attachMic(runtime.micStream);
    notifyMediaChanged();
  } catch {
    runtime.micStream = null;
    toast('Could not open the microphone.');
  }
}

/**
 * Preflight "Select screen": opens the browser's standard share picker (tab /
 * window / entire screen). Called directly from the user's click so the
 * gesture requirement is satisfied; the stream stays warm so the preview
 * shows the real surface and Start can go straight to the countdown.
 */
export async function selectScreen(): Promise<void> {
  const { settings } = store();
  try {
    const stream = await getDisplayStream({
      wantAudio: settings.captureSystemAudio,
      suppressLocalAudioPlayback: settings.suppressLocalAudioPlayback,
      fps: PRESETS[settings.presetId].fps,
    });
    stopStream(runtime.displayStream);
    runtime.displayStream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.addEventListener('ended', () => {
        // Browser's "Stop sharing" bar clicked while still in preflight.
        if (store().session.phase === 'preflight' && runtime.displayStream === stream) {
          clearScreenSelection();
        }
      });
    }
    store().patchSession({ screenReady: true, screenInfo: surfaceLabel(track) });
    notifyMediaChanged();
  } catch (err) {
    // Cancelling the picker is fine; anything else the user must see.
    if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
      toast(err instanceof Error ? err.message : 'Could not capture the screen.');
    }
  }
}

export function stopScreenShare(): void {
  clearScreenSelection();
}

function clearScreenSelection(): void {
  stopStream(runtime.displayStream);
  runtime.displayStream = null;
  store().patchSession({ screenReady: false, screenInfo: null });
  notifyMediaChanged();
}

function surfaceLabel(track: MediaStreamTrack | undefined): string {
  if (!track) return 'screen';
  switch (captureSurfaceOf(track)) {
    case 'tab':
      return 'browser tab (viewport only)';
    case 'window':
      return 'app window';
    case 'monitor':
      return 'entire screen';
    default:
      return 'screen';
  }
}

function ensureAudioGraph() {
  if (!runtime.audioGraph) runtime.audioGraph = createAudioGraph();
  const ctx = runtime.audioGraph.ctx;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
    // Autoplay policy keeps a gesture-less AudioContext suspended (dead level
    // meter in preflight); the first interaction wakes it.
    const kick = () => void ctx.resume().catch(() => {});
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
  }
  return runtime.audioGraph;
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Bumps a counter so React previews re-bind srcObject when streams change. */
let mediaEpochListeners: (() => void)[] = [];
export function onMediaChanged(listener: () => void): () => void {
  mediaEpochListeners.push(listener);
  return () => {
    mediaEpochListeners = mediaEpochListeners.filter((l) => l !== listener);
  };
}
function notifyMediaChanged(): void {
  for (const listener of mediaEpochListeners) listener();
}

/* ---------- library folder ---------- */

export async function connectLibraryDir(): Promise<FileSystemDirectoryHandle | null> {
  if (store().library.mode === 'opfs') {
    runtime.libraryDir ??= await getSavedDir();
    store().patchLibrary({ dirName: OPFS_DIR_LABEL, connected: true });
    await refreshLibrary();
    return runtime.libraryDir;
  }

  let dir = runtime.libraryDir ?? (await getSavedDir());
  if (dir) {
    const permission = await queryDirPermission(dir);
    if (permission === 'prompt' && !(await requestDirPermission(dir))) dir = null;
    if (permission === 'denied') dir = null;
  }
  if (!dir) {
    try {
      dir = await pickLibraryDir();
    } catch (err) {
      // Cancelling the picker is fine; anything else the user must see.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        toast(err instanceof Error ? err.message : 'Could not open the folder picker.');
      }
      return null;
    }
  }
  runtime.libraryDir = dir;
  store().patchLibrary({ dirName: dir.name, connected: true });
  await refreshLibrary();
  return dir;
}

export async function refreshLibrary(): Promise<void> {
  if (!runtime.libraryDir) return;
  try {
    const items = await scanLibrary(runtime.libraryDir);
    store().patchLibrary({ items });
  } catch {
    store().patchLibrary({ connected: false });
  }
}

export async function refreshRecoverable(): Promise<void> {
  store().patchLibrary({ recoverable: await listRecoverableParts() });
}

/* ---------- recording lifecycle ---------- */

/**
 * Preflight "Start recording" click. The screen was already picked in
 * preflight (its own user gesture), so this click only has to open the
 * always-on-top deck and run the countdown.
 */
export async function startFlow(): Promise<void> {
  const layout = store().settings.layout;
  if (layout !== 'camera' && !runtime.displayStream) {
    toast('Select the screen you want to record first.');
    return;
  }

  const dir = await connectLibraryDir();
  if (!dir) {
    toast('Pick a save folder first — recordings stream straight to disk.');
    return;
  }

  if (!isE2E() && pipSupported()) {
    const pip = await openPipWindow(380, 520);
    if (pip) adoptPipWindow(pip);
  }
  await beginRecording();
}

async function beginRecording(): Promise<void> {
  const { settings } = store();
  const layout = settings.layout;
  // Every take starts at full frame — a preflight rehearsal punch never leaks in.
  store().patchScreenFocus(DEFAULT_FOCUS);

  try {
    // Countdown FIRST, pipeline after. A constructed-but-not-started session
    // (encoders, track sources) left idle through the countdown crashes
    // Chrome's renderer when an audio track is involved — see issue #4. The
    // pipeline is built at "0" and starts encoding immediately.
    const cdOverride = Number(new URLSearchParams(location.search).get('cd'));
    const seconds = cdOverride > 0 ? cdOverride : isE2E() ? 1 : 3;
    store().patchSession({ phase: 'countdown', countdown: seconds, micMuted: false });
    await new Promise<void>((resolve) => {
      let remaining = seconds;
      countdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (countdownTimer) clearInterval(countdownTimer);
          countdownTimer = null;
          resolve();
        } else {
          store().patchSession({ countdown: remaining });
        }
      }, 1000);
    });

    // The user may have hit the browser's "Stop sharing" bar mid-countdown.
    const displayTrack = runtime.displayStream?.getVideoTracks()[0] ?? null;
    if (layout !== 'camera' && displayTrack?.readyState !== 'live') {
      throw new Error('Screen sharing ended before the recording started.');
    }

    const displayAudioTrack = runtime.displayStream?.getAudioTracks()[0] ?? null;
    let graph = runtime.audioGraph;
    if (settings.micEnabled || displayAudioTrack) {
      graph = ensureAudioGraph();
      graph.attachMic(settings.micEnabled ? runtime.micStream : null);
      graph.attachDisplayAudio(displayAudioTrack);
      graph.setMicMuted(false);
    }

    const session = await prepareSession(
      {
        layout,
        preset: PRESETS[settings.presetId],
        bubble: settings.bubble,
        frame: settings.frame,
        cameraBackground: settings.cameraBackground,
        cameraLighting: settings.cameraLighting,
        focus: store().focus,
        audioCodec: settings.micEnabled || displayAudioTrack ? store().devices.audioCodec : null,
        libraryDir: runtime.libraryDir!,
      },
      {
        displayStream: layout !== 'camera' ? runtime.displayStream : null,
        cameraStream: layout !== 'screen' ? runtime.cameraStream : null,
        audioGraph: settings.micEnabled || displayAudioTrack ? graph : null,
      },
    );
    runtime.session = session;
    session.onExternalEnd = () => void stopRecording();
    session.onError = (message) => {
      toast(message);
      void abortRecording();
    };

    await session.start();
    store().patchSession({
      phase: 'recording',
      accumulatedMs: 0,
      lastResumeAt: performance.now(),
    });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not start the recording.');
    await abortRecording();
  }
}

export function togglePause(): void {
  const { session } = store();
  const active = runtime.session;
  if (!active) return;
  if (session.phase === 'recording') {
    active.pause();
    store().patchSession({
      phase: 'paused',
      accumulatedMs: session.accumulatedMs + (performance.now() - session.lastResumeAt),
      lastResumeAt: 0,
    });
  } else if (session.phase === 'paused') {
    active.resume();
    store().patchSession({ phase: 'recording', lastResumeAt: performance.now() });
  }
}

export function setMicMuted(muted: boolean): void {
  runtime.audioGraph?.setMicMuted(muted);
  store().patchSession({ micMuted: muted });
}

export function updateBubble(patch: Partial<BubbleGeometry>): void {
  store().patchBubble(patch);
  runtime.session?.setBubble(store().settings.bubble);
}

export function updateFrame(patch: Partial<FrameSettings>): void {
  store().patchFrame(patch);
  runtime.session?.setFrame(store().settings.frame);
}

export function updateCameraBackground(patch: Partial<CameraBackground>): void {
  store().patchCameraBackground(patch);
  runtime.session?.setCameraBackground(store().settings.cameraBackground);
}

export function updateCameraLighting(patch: Partial<CameraLighting>): void {
  store().patchCameraLighting(patch);
  runtime.session?.setCameraLighting(store().settings.cameraLighting);
}

/** Sets the live screen punch-in / spotlight (glides unless reduced-motion). */
export function updateFocus(patch: Partial<ScreenFocus>, opts?: { animate?: boolean }): void {
  store().patchScreenFocus(patch);
  const animate = opts?.animate ?? !prefersReducedMotion();
  runtime.session?.setFocus(store().focus, animate);
}

/** Pull back to the full frame (Escape / 0 / the reset control). */
export function resetFocus(): void {
  updateFocus({ mode: 'none', cx: 0.5, cy: 0.5, w: 1, h: 1 });
}

export async function stopRecording(): Promise<void> {
  const phase = store().session.phase;
  if (phase !== 'recording' && phase !== 'paused') return;
  const active = runtime.session;
  if (!active) return;

  const session = store().session;
  store().patchSession({
    phase: 'finalizing',
    accumulatedMs:
      phase === 'recording'
        ? session.accumulatedMs + (performance.now() - session.lastResumeAt)
        : session.accumulatedMs,
    lastResumeAt: 0,
  });

  try {
    const { fileName, handle } = await active.stop();
    runtime.reviewFileHandle = handle;
    store().patchSession({ phase: 'review', reviewFileName: fileName });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to finalize the recording.');
    store().patchSession({ phase: 'preflight' });
  } finally {
    cleanupAfterSession();
    await refreshLibrary();
    await refreshRecoverable();
  }
}

export async function abortRecording(): Promise<void> {
  await runtime.session?.abort().catch(() => {});
  cleanupAfterSession();
  store().patchSession({ phase: 'preflight' });
  await refreshRecoverable();
}

function cleanupAfterSession(): void {
  runtime.session = null;
  stopStream(runtime.displayStream);
  runtime.displayStream = null;
  store().patchScreenFocus(DEFAULT_FOCUS);
  store().patchSession({ screenReady: false, screenInfo: null });
  runtime.audioGraph?.attachDisplayAudio(null);
  runtime.audioGraph?.setMicMuted(false);
  closePip();
}

/* ---------- PiP deck ---------- */

function adoptPipWindow(pip: Window): void {
  runtime.pipWindow = pip;
  store().patchSession({ pipOpen: true });
  pip.addEventListener('pagehide', () => {
    if (runtime.pipWindow === pip) {
      runtime.pipWindow = null;
      store().patchSession({ pipOpen: false });
    }
  });
}

export async function reopenPip(): Promise<void> {
  if (runtime.pipWindow || !pipSupported() || isE2E()) return;
  const pip = await openPipWindow(380, 520);
  if (pip) adoptPipWindow(pip);
}

export function closePip(): void {
  runtime.pipWindow?.close();
  runtime.pipWindow = null;
  store().patchSession({ pipOpen: false });
}

/* ---------- review ---------- */

export function openInReview(handle: FileSystemFileHandle, name: string): void {
  runtime.reviewFileHandle = handle;
  store().patchSession({ phase: 'review', reviewFileName: name });
  store().setView('record');
}

export function backToPreflight(): void {
  runtime.reviewFileHandle = null;
  store().patchSession({ phase: 'preflight', reviewFileName: null });
}
