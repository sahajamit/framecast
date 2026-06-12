import { useStore, elapsedMs, formatElapsed } from '../state/store';
import { useEffect, useState } from 'react';
import { reopenPip, stopRecording, togglePause } from './controller';
import { ControlDeck } from '../pip/ControlDeck';
import { TallyDot } from '../ui/controls';
import { pipSupported } from '../pip/pipWindow';
import { isE2E } from '../library/fsAccess';

/**
 * What the framecast tab shows while a take is in progress. The real controls
 * live in the floating PiP deck; when that's unavailable (or closed), the
 * deck renders inline here instead.
 */
export function RecordingScreen() {
  const phase = useStore((s) => s.session.phase);
  const pipOpen = useStore((s) => s.session.pipOpen);
  const armed = useStore((s) => s.session.armed);
  const countdown = useStore((s) => s.session.countdown);
  const [clock, setClock] = useState('00:00');

  useEffect(() => {
    const t = setInterval(
      () => setClock(formatElapsed(elapsedMs(useStore.getState().session))),
      500,
    );
    return () => clearInterval(t);
  }, []);

  if (phase === 'finalizing') {
    return (
      <CenterCard>
        <TallyDot size={16} />
        <h2 className="font-display font-semibold text-xl">Finalizing…</h2>
        <p className="text-[13px] text-mute">Flushing encoder and moving the file to your folder.</p>
      </CenterCard>
    );
  }

  if (pipOpen) {
    return (
      <CenterCard>
        {phase === 'countdown' ? (
          <span key={countdown} className="count-pop font-display font-bold text-7xl">
            {countdown}
          </span>
        ) : (
          <>
            <TallyDot live={phase === 'recording'} size={16} />
            <div className="font-mono text-3xl tabular-nums">{clock}</div>
            <p className="text-[13px] text-mute max-w-[300px] text-center">
              {armed
                ? 'Pick what to share in the floating deck.'
                : phase === 'paused'
                  ? 'Paused — resume from the floating deck.'
                  : 'Recording. Drag the camera bubble, pause or stop from the floating deck.'}
            </p>
            <div className="flex gap-2">
              <button type="button" className="hairline-btn" onClick={togglePause}>
                {phase === 'paused' ? '▶ resume' : '❚❚ pause'}
              </button>
              <button type="button" className="danger-btn" onClick={() => void stopRecording()}>
                ■ stop & save
              </button>
            </div>
          </>
        )}
      </CenterCard>
    );
  }

  // Inline deck (no PiP available, PiP closed, or e2e mode).
  return (
    <div className="max-w-[430px] mx-auto rise-in">
      <div className="panel overflow-hidden" style={{ height: 470 }}>
        <ControlDeck windowRef={window} />
      </div>
      {pipSupported() && !isE2E() && (
        <button type="button" className="hairline-btn w-full mt-3" onClick={() => void reopenPip()}>
          ⇱ pop out floating controls
        </button>
      )}
    </div>
  );
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[430px] mx-auto rise-in">
      <div className="panel p-10 flex flex-col items-center gap-4">{children}</div>
    </div>
  );
}
