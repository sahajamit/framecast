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
import { discardPart, recoverPart } from '../recorder/recovery';
import { installTestHook } from './testHook';

export function App() {
  const phase = useStore((s) => s.session.phase);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const error = useStore((s) => s.session.error);
  const library = useStore((s) => s.library);
  const audioCodec = useStore((s) => s.devices.audioCodec);
  const theme = useStore((s) => s.settings.theme);
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

  // Don't let a tab close kill a take silently.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      const p = useStore.getState().session.phase;
      if (p === 'recording' || p === 'paused' || p === 'finalizing') e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const activeTake = phase !== 'preflight' && phase !== 'review';
  const recording = phase === 'recording' || phase === 'paused';

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

  return (
    <div className="min-h-full flex flex-col" data-phase={phase}>
      <header className="border-b border-line">
        <div className="max-w-[1200px] mx-auto px-5 py-3.5 flex items-center gap-5">
          <div className="flex items-center gap-2.5 mr-auto">
            <LogoLockup live={recording} />
            <span className="label-mono hidden sm:inline !text-faint">local recording studio</span>
          </div>

          <nav className="flex items-center gap-1">
            {(['record', 'library'] as const).map((v) => (
              <button
                key={v}
                type="button"
                disabled={activeTake}
                onClick={() => setView(v)}
                className={`font-mono text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 rounded-md cursor-pointer
                  transition-colors disabled:opacity-40 ${
                    view === v && !activeTake ? 'bg-panel-2 text-ink border border-line' : 'text-mute hover:text-ink'
                  }`}
              >
                {v}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => void connectLibraryDir()}
            title="Recordings folder"
            className="hairline-btn !py-1.5 hidden md:block max-w-[180px] truncate"
          >
            ⌂ {library.connected ? library.dirName : 'choose folder'}
          </button>
          <button
            type="button"
            onClick={() => patchSettings({ theme: theme === 'light' ? 'dark' : 'light' })}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            className="hairline-btn !py-1.5 !px-2.5"
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <span className="label-mono hidden lg:inline" title="Recording codecs">
            h.264{audioCodec ? ` + ${audioCodec}` : ''}
          </span>
        </div>
      </header>

      {library.recoverable.length > 0 && !activeTake && (
        <div className="bg-accent/10 border-b border-accent/30">
          <div className="max-w-[1200px] mx-auto px-5 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="text-[13px] text-accent">
              {library.recoverable.length === 1
                ? 'An interrupted recording can be recovered.'
                : `${library.recoverable.length} interrupted recordings can be recovered.`}
            </span>
            <button
              type="button"
              className="hairline-btn !py-1 !border-accent/50 !text-accent hover:!border-accent"
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
              recover
            </button>
            <button
              type="button"
              className="hairline-btn !py-1"
              onClick={() =>
                void (async () => {
                  for (const part of useStore.getState().library.recoverable) await discardPart(part);
                  await refreshRecoverable();
                })()
              }
            >
              discard
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-5 py-6">{content}</main>

      <footer className="border-t border-line">
        <div className="max-w-[1200px] mx-auto px-5 py-3 flex items-center justify-between">
          <span className="label-mono">100% local · no uploads · no telemetry</span>
          <a
            href="https://github.com/sahajamit/framecast"
            target="_blank"
            rel="noreferrer"
            className="label-mono hover:text-ink transition-colors"
          >
            github ↗
          </a>
        </div>
      </footer>

      <PipPortal />

      {error && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 panel !border-rec/40 px-4 py-3 max-w-[480px] rise-in">
          <span className="text-[13px]">{error}</span>
        </div>
      )}
    </div>
  );
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
