import { useEffect, useState } from 'react';
import { useStore, elapsedMs, formatElapsed } from '../state/store';
import { abortRecording, reopenPip, stopRecording, togglePause } from './controller';
import { ControlDeck } from '../pip/ControlDeck';
import { Lamp } from '../ui/controls';
import { pipSupported } from '../pip/pipWindow';
import { isE2E } from '../library/fsAccess';

/**
 * What the framecast tab shows while a take is in progress: the countdown
 * takeover, then the quiet ON AIR card (controls live in the floating deck),
 * or the inline deck when PiP is unavailable.
 */
export function RecordingScreen() {
  const phase = useStore((s) => s.session.phase);
  const pipOpen = useStore((s) => s.session.pipOpen);
  const countdown = useStore((s) => s.session.countdown);
  const screenInfo = useStore((s) => s.session.screenInfo);
  const [clock, setClock] = useState('00:00');

  useEffect(() => {
    const t = setInterval(
      () => setClock(formatElapsed(elapsedMs(useStore.getState().session))),
      500,
    );
    return () => clearInterval(t);
  }, []);

  // ESC cancels the take during the countdown.
  useEffect(() => {
    if (phase !== 'countdown') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void abortRecording();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase === 'countdown') {
    return (
      <div className="cd-wrap force-dark">
        <div className="cd-frame" />
        <div className="cd">
          <div className="cd-tally">
            {[3, 2, 1].map((n) => (
              <i key={n} className={countdown <= n ? 'on' : ''} />
            ))}
          </div>
          <div className="cd-num-well">
            <span key={countdown} className="cd-num slam">
              {countdown}
            </span>
          </div>
          <div className="cd-cap">
            Stand by — <b>rolling in {countdown}</b>
          </div>
        </div>
        <div className="cd-esc">
          <span>ESC</span>Cancel take
        </div>
      </div>
    );
  }

  if (phase === 'finalizing') {
    return (
      <div className="max-w-[620px] mx-auto rise-in pt-10">
        <div className="onair-card">
          <div className="onair-sign standby">
            <Lamp kind="warn" pulse />
            Saving
          </div>
          <div className="big-tc">{clock}</div>
          <div className="onair-sub">Flushing the encoder · moving the take to your library</div>
        </div>
      </div>
    );
  }

  if (pipOpen) {
    const paused = phase === 'paused';
    return (
      <div className="max-w-[620px] mx-auto rise-in pt-6">
        <div className="onair-card">
          <div className={`onair-sign ${paused ? 'standby' : ''}`}>
            <Lamp kind={paused ? 'warn' : 'rec'} pulse={!paused} />
            {paused ? 'Paused' : 'On air'}
            <Lamp kind={paused ? 'warn' : 'rec'} pulse={!paused} />
          </div>
          <div className="big-tc">{clock}</div>
          <div className="onair-sub">{screenInfo ?? 'recording'}</div>
          <div className="onair-note">
            Your controls live in the floating deck. This tab stays open —<br />
            the take is writing to your disk as you speak.
          </div>
          <div className="flex gap-3 mt-7">
            <button type="button" className="btn lg" onClick={togglePause}>
              {paused ? '▶ Resume' : '❚❚ Pause'}
            </button>
            <button type="button" className="btn lg danger fill" onClick={() => void stopRecording()}>
              ■ Stop &amp; save
            </button>
          </div>
          <div className="onair-strip">
            <span>Direct to disk</span>
            <span className="sep" />
            <span>Nothing leaves this machine</span>
          </div>
        </div>
      </div>
    );
  }

  // Inline deck (no PiP available, PiP closed, or e2e mode).
  return (
    <div className="max-w-[420px] mx-auto rise-in">
      <div style={{ height: 470, borderRadius: 'var(--radius-5)', overflow: 'hidden', boxShadow: 'var(--shadow-pop)' }}>
        <ControlDeck windowRef={window} />
      </div>
      {pipSupported() && !isE2E() && (
        <button type="button" className="btn w-full mt-3" onClick={() => void reopenPip()}>
          ⇱ Pop out floating deck
        </button>
      )}
    </div>
  );
}
