/**
 * Mixes the microphone and (optional) captured tab/system audio into a single
 * 48 kHz track for the recorder, with an analyser tap for level meters.
 * Nothing is routed to the speakers — no monitoring echo.
 */
export interface AudioGraph {
  ctx: AudioContext;
  analyser: AnalyserNode;
  outputTrack: MediaStreamTrack;
  attachMic(stream: MediaStream | null): void;
  attachDisplayAudio(track: MediaStreamTrack | null): void;
  setMicMuted(muted: boolean): void;
  close(): Promise<void>;
}

export function createAudioGraph(): AudioGraph {
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
  const micGain = ctx.createGain();
  const displayGain = ctx.createGain();
  const mixBus = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const dest = ctx.createMediaStreamDestination();

  micGain.connect(mixBus);
  displayGain.connect(mixBus);
  mixBus.connect(analyser);
  mixBus.connect(dest);

  let micSource: MediaStreamAudioSourceNode | null = null;
  let displaySource: MediaStreamAudioSourceNode | null = null;
  let micMuted = false;

  const outputTrack = dest.stream.getAudioTracks()[0];
  if (!outputTrack) throw new Error('AudioContext produced no output track');

  return {
    ctx,
    analyser,
    outputTrack,
    attachMic(stream) {
      micSource?.disconnect();
      micSource = null;
      if (stream && stream.getAudioTracks().length > 0) {
        micSource = ctx.createMediaStreamSource(stream);
        micSource.connect(micGain);
      }
      micGain.gain.value = micMuted ? 0 : 1;
    },
    attachDisplayAudio(track) {
      displaySource?.disconnect();
      displaySource = null;
      if (track) {
        displaySource = ctx.createMediaStreamSource(new MediaStream([track]));
        displaySource.connect(displayGain);
      }
    },
    setMicMuted(muted) {
      micMuted = muted;
      // Short ramp avoids clicks; silence keeps flowing so A/V sync is unaffected.
      micGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.015);
    },
    async close() {
      outputTrack.stop();
      await ctx.close();
    },
  };
}
