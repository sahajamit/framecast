import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { runtime } from '../recorder/runtime';
import {
  bootApp,
  connectLibraryDir,
  refreshLibrary,
  refreshRecoverable,
  toast,
} from './controller';
import { PreflightScreen } from './PreflightScreen';
import { RecordingScreen } from './RecordingScreen';
import { ReviewScreen } from './ReviewScreen';
import { LibraryScreen } from './LibraryScreen';
import { ControlDeck } from '../pip/ControlDeck';
import { LogoLockup } from '../ui/Logo';
import { Lamp } from '../ui/controls';
import { discardPart, recoverPart } from '../recorder/recovery';
import { installTestHook } from './testHook';
import { storageEstimate } from '../library/fsAccess';
import { formatSize } from '../library/scan';
import { PRESETS } from '../recorder/encoderConfig';

async function explainStorage(): Promise<void> {
  const est = await storageEstimate();
  const usage = est ? `${formatSize(est.usage)} used of ${formatSize(est.quota)} available. ` : '';
  toast(
    `Takes are kept in this browser's private storage. ${usage}Use download to export files. Chrome and Edge can write straight into a folder you pick.`,
  );
}

export function App() {
  const phase = useStore((s) => s.session.phase);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const error = useStore((s) => s.session.error);
  const library = useStore((s) => s.library);
  const audioCodec = useStore((s) => s.devices.audioCodec);
  const theme = useStore((s) => s.settings.theme);
  const presetId = useStore((s) => s.settings.presetId);
  const patchSettings = useStore((s) => s.patchSettings);

  useEffect(() => {
    installTestHook();
    void bootApp();
  }, []);

  useEffect(() => {
    const resolved = theme ?? 'dark';
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [theme]);

  const activeTake = phase !== 'preflight' && phase !== 'review';
  const recording = phase === 'recording' || phase === 'paused';

  // The favicon lens flips red while rolling.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = recording ? withBase('icon-onair.svg') : withBase('icon.svg');
  }, [recording]);

  // Don't let a tab close kill a take silently.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      const p = useStore.getState().session.phase;
      if (p === 'recording' || p === 'paused' || p === 'finalizing') e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const content =
    view === 'library' && !activeTake ? (
      <LibraryScreen />
    ) : phase === 'preflight' ? (
      <PreflightScreen />
    ) : phase === 'review' ? (
      <ReviewScreen />
    ) : (
      <RecordingScreen />
    );

  const preset = PRESETS[presetId];
  const lampText = recording
    ? 'Recording · streaming to disk'
    : library.connected
      ? library.mode === 'opfs'
        ? 'On-disk · browser storage'
        : `On-disk · ${library.dirName}`
      : 'Choose a folder for your takes';

  return (
    <div className="min-h-full flex flex-col" data-phase={phase}>
      <header className="fc-header">
        <LogoLockup live={recording} />
        <div className="flex-1" />
        <nav className="fc-nav">
          {(['record', 'library'] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={activeTake}
              onClick={() => setView(v)}
              className={`nav-item ${view === v && !activeTake ? 'on' : ''}`}
            >
              {v}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="lamp-block"
          title={library.mode === 'opfs' ? 'Takes storage' : 'Takes folder'}
          onClick={() => void (library.mode === 'opfs' ? explainStorage() : connectLibraryDir())}
        >
          <Lamp kind={recording ? 'rec' : library.connected ? 'ok' : 'off'} pulse={recording} />
          <span className="txt">{lampText}</span>
        </button>
        <button
          type="button"
          className="btn-s"
          onClick={() => patchSettings({ theme: theme === 'light' ? 'dark' : 'light' })}
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? '☾ dark' : '☀ light'}
        </button>
        <span className="hdr-read hidden lg:inline" title="Recording format">
          {preset.maxHeight}P/{preset.fps} · H.264{audioCodec ? `+${audioCodec.toUpperCase()}` : ''}
        </span>
      </header>

      {library.recoverable.length > 0 && !activeTake && (
        <div className="max-w-[1200px] w-full mx-auto px-6 pt-4">
          <div className="banner">
            <Lamp kind="warn" />
            <div className="b-msg">
              <b>Interrupted take found</b>
              {library.recoverable.length === 1
                ? 'A take stopped mid-roll. The file is intact on your disk — recover it to the library or discard it.'
                : `${library.recoverable.length} takes stopped mid-roll. The files are intact on your disk — recover them to the library or discard them.`}
            </div>
            <div className="b-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void (async () => {
                    const dir = runtime.libraryDir ?? (await connectLibraryDir());
                    if (!dir) return;
                    for (const part of useStore.getState().library.recoverable) {
                      try {
                        const { outName } = await recoverPart(part, dir);
                        toast(`Recovered ${outName}`);
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Recovery failed.');
                      }
                    }
                    await refreshRecoverable();
                    await refreshLibrary();
                  })()
                }
              >
                Recover take
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() =>
                  void (async () => {
                    for (const part of useStore.getState().library.recoverable)
                      await discardPart(part);
                    await refreshRecoverable();
                  })()
                }
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-6 py-5">{content}</main>

      <footer style={{ borderTop: '1px solid var(--color-line)' }}>
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between">
          <span className="label">It happens here · no uploads · no telemetry</span>
          <a
            href="https://github.com/sahajamit/framecast"
            target="_blank"
            rel="noreferrer"
            className="label"
            style={{ textDecoration: 'none' }}
          >
            github ↗
          </a>
        </div>
      </footer>

      <PipPortal />

      {error && (
        <div className="fixed bottom-5 right-5 z-100">
          <div className="toast">
            <Lamp kind="warn" />
            <div className="t-msg">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function withBase(file: string): string {
  return `${import.meta.env.BASE_URL}${file}`;
}

/** Renders the deck into the Document PiP window whenever it's open. */
function PipPortal() {
  const pipOpen = useStore((s) => s.session.pipOpen);
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), [pipOpen]);
  const pip = runtime.pipWindow;
  if (!pipOpen || !pip) return null;
  return createPortal(<ControlDeck windowRef={pip} />, pip.document.body);
}
