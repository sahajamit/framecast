/**
 * Orchestrates the recording lifecycle between the UI, capture layer and the
 * recording engine. All functions are module-level so both the main window UI
 * and the PiP deck call into the same instance.
 */
import { useStore } from '../state/store';
import type { BubbleGeometry } from '../types';
import { runtime } from '../recorder/runtime';
import { prepareSession } from '../recorder/recordingSession';
import { PRESETS, probeAudioCodec } from '../recorder/encoderConfig';
import { listRecoverableParts } from '../recorder/recovery';
import { createAudioGraph } from '../audio/audioGraph';
import { getDisplayStream } from '../capture/displayCapture';
import { getCameraStream } from '../capture/cameraCapture';
import { getMicStream } from '../capture/micCapture';
import { listDevices, onDeviceChange, primePermissions } from '../capture/devices';
import {
  getSavedDir,
  isE2E,
  pickLibraryDir,
  queryDirPermission,
  requestDirPermission,
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

  const dir = await getSavedDir();
  if (dir) {
    runtime.libraryDir = dir;
    const permission = isE2E() ? 'granted' : await queryDirPermission(dir);
    store().patchLibrary({ dirName: dir.name, connected: permission === 'granted' });
    if (permission === 'granted') await refreshLibrary();
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

function ensureAudioGraph() {
  if (!runtime.audioGraph) runtime.audioGraph = createAudioGraph();
  if (runtime.audioGraph.ctx.state === 'suspended') void runtime.audioGraph.ctx.resume();
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
  let dir = runtime.libraryDir ?? (await getSavedDir());
  if (dir && !isE2E()) {
    const permission = await queryDirPermission(dir);
    if (permission === 'prompt' && !(await requestDirPermission(dir))) dir = null;
    if (permission === 'denied') dir = null;
  }
  if (!dir) {
    try {
      dir = await pickLibraryDir();
    } catch {
      return null; // user cancelled the picker
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

/** Preflight "Start" click: connect folder, open the deck, then capture. */
export async function startFlow(): Promise<void> {
  const dir = await connectLibraryDir();
  if (!dir) {
    toast('Pick a save folder first — recordings stream straight to disk.');
    return;
  }

  const layout = store().settings.layout;
  const needsPicker = layout !== 'camera';

  if (!isE2E() && pipSupported()) {
    const pip = await openPipWindow(380, 470);
    if (pip) {
      adoptPipWindow(pip);
      if (needsPicker) {
        // Wait for the user's "choose screen" click inside the deck — that
        // click carries the user gesture getDisplayMedia needs.
        store().patchSession({ armed: true });
        return;
      }
    }
  }
  await armAndCapture();
}

/** Deck "choose screen & go" click (or direct path when no PiP). */
export async function armAndCapture(): Promise<void> {
  const { settings } = store();
  const layout = settings.layout;
  store().patchSession({ armed: false });

  try {
    if (layout !== 'camera') {
      const mediaDevices = (runtime.pipWindow?.navigator ?? navigator).mediaDevices;
      runtime.displayStream = await getDisplayStream(
        {
          wantAudio: settings.captureSystemAudio,
          suppressLocalAudioPlayback: settings.suppressLocalAudioPlayback,
          fps: PRESETS[settings.presetId].fps,
        },
        mediaDevices,
      );
    }
  } catch {
    // User cancelled Chrome's picker — stay armed for another try.
    if (runtime.pipWindow) store().patchSession({ armed: true });
    return;
  }

  try {
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

    // Countdown, then start encoding exactly at zero.
    const seconds = isE2E() ? 1 : 3;
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
  store().patchSession({ phase: 'preflight', armed: false });
  await refreshRecoverable();
}

function cleanupAfterSession(): void {
  runtime.session = null;
  stopStream(runtime.displayStream);
  runtime.displayStream = null;
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
      store().patchSession({ pipOpen: false, armed: false });
    }
  });
}

export async function reopenPip(): Promise<void> {
  if (runtime.pipWindow || !pipSupported() || isE2E()) return;
  const pip = await openPipWindow(380, 470);
  if (pip) adoptPipWindow(pip);
}

export function closePip(): void {
  runtime.pipWindow?.close();
  runtime.pipWindow = null;
  store().patchSession({ pipOpen: false, armed: false });
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
