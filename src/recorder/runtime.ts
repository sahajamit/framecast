import type { ActiveSession } from './recordingSession';
import type { AudioGraph } from '../audio/audioGraph';

/**
 * Non-serializable live objects (streams, workers, handles). Kept outside the
 * zustand store on purpose — React state holds only serializable mirrors.
 */
interface SessionRuntime {
  cameraStream: MediaStream | null;
  micStream: MediaStream | null;
  displayStream: MediaStream | null;
  audioGraph: AudioGraph | null;
  session: ActiveSession | null;
  libraryDir: FileSystemDirectoryHandle | null;
  pipWindow: Window | null;
  reviewFileHandle: FileSystemFileHandle | null;
}

export const runtime: SessionRuntime = {
  cameraStream: null,
  micStream: null,
  displayStream: null,
  audioGraph: null,
  session: null,
  libraryDir: null,
  pipWindow: null,
  reviewFileHandle: null,
};
