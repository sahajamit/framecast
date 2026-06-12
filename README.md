# framecast

**A fully-local screen + camera recorder for creators. Nothing ever leaves your machine.**

Record your screen (a Chrome tab, a window, or the whole display) with an optional camera bubble
you can **drag around and zoom — live, while recording**. Every take streams straight to a folder
you choose as a crash-safe MP4. Trim it, convert it, clean up the audio — all in the browser,
all offline, no accounts, no uploads, no telemetry.

Built for the daily-video workflow: open tab → hit record → talk → stop → upload to YouTube.

## Features

- **Three layouts** — screen + camera bubble, screen only, camera only
- **The camera bubble** — circle or rounded, draggable in the preview *and during the take*
  (position is baked into the video), snap-to-corner, size slider, and a **zoom slider** so you
  can frame just your head, not your shoulders
- **Tab-viewport capture** — sharing a Chrome tab records exactly the page, no omnibox, no chrome
- **Floating control deck** — an always-on-top mini window (Document Picture-in-Picture) with
  live preview, drag-to-move bubble, mic mute + level meter, pause/resume, timer and stop
- **Crash-safe direct-to-disk recording** — WebCodecs hardware H.264 muxed into a fragmented MP4,
  flushed to disk every 2 seconds; a crashed tab leaves a recoverable take, not a lost one
- **Pause / resume** with a gapless timeline, plus a 3‑2‑1 countdown
- **Quality presets** — 1080p/1440p/4K at 30 or 60 fps (default: 1440p30, crisp text on YouTube)
- **Microphone done right** — device picker, live LED meter, noise suppression / echo
  cancellation / auto-gain toggles, tab/system audio mixing when available
- **Review screen** — player, **trim** with filmstrip handles (tail cuts are instant packet
  copies), export to **MP4 / WebM / MOV**, and one-click **audio enhance** (RNNoise neural
  denoise + loudness normalization to YouTube's −14 LUFS) — all processed locally
- **Recordings library** — your save folder, scanned with thumbnails, durations and quick actions
- **Installable PWA**, works fully offline
- **Keyboard shortcuts** — `Space` pause · `S` stop · `M` mic · `C` bubble · `1–4` snap corners

## Quick start

```bash
git clone https://github.com/sahajamit/framecast.git
cd framecast
npm install
npm run dev
```

Open http://localhost:5173 in **Chrome or Edge** (the app uses Chrome-only capture APIs:
Document Picture-in-Picture, WebCodecs, MediaStreamTrackProcessor, File System Access).

> **macOS note:** the first screen capture asks for the *Screen Recording* permission —
> System Settings → Privacy & Security → Screen Recording → enable your browser, then restart it.
> Tab and window audio capture works; full-screen *system* audio is not reliably available on
> macOS (that's a Chrome/macOS limitation, not a framecast one).

## How it stays local

- Capture: `getDisplayMedia` + `getUserMedia`
- Compositing: a Web Worker draws screen + camera bubble onto an `OffscreenCanvas`,
  frame-driven so it keeps compositing while the tab is hidden
- Encoding: WebCodecs hardware H.264 (AAC audio when the browser can encode it, Opus otherwise)
- Muxing: [mediabunny](https://mediabunny.dev) writes a fragmented MP4 **incrementally into OPFS**
  (synchronous, durable writes), then promotes the finished file into your chosen folder
- Post-processing (trim / convert / enhance): mediabunny + RNNoise WASM, in-browser

No servers. The GitHub Pages deployment is a static site; you can also just `npm run build`
and serve `dist/` from anywhere — or install it as a PWA and go offline.

## Development

```bash
npm test        # unit tests (bubble geometry, BS.1770 loudness, encoder presets)
npm run e2e     # Playwright end-to-end against real Chrome with fake capture devices
npm run lint
npm run build
```

The e2e suite records real files (using Chrome's fake camera/mic and auto-selected tab capture),
then re-opens them with mediabunny to assert duration, codecs and A/V sync — including a
renderer-crash recovery test.

## Roadmap (phase 2)

Teleprompter in the floating deck · dual-mic mixing / separate tracks · background blur ·
zoom-on-click effects · wallpaper padding · GIF export · 9:16 vertical mode · keyframe-snapped
instant head-trim · optional Electron wrapper (global hotkeys, full system audio).

## License

MIT © [Amit Rawat](https://amitrawat.dev). Bundles [mediabunny](https://github.com/Vanilagy/mediabunny)
(MPL-2.0) as a dependency.

---

*Inspired by [addyosmani/recorder](https://github.com/addyosmani/recorder) — rebuilt around a
2026-grade pipeline: WebCodecs, crash-safe direct-to-disk fragmented MP4, draggable/zoomable
camera bubble, and local post-production.*
