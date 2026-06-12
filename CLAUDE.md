# framecast

Fully-local screen + camera recorder web app (Chrome-only APIs). Everything — capture, compositing, encoding, muxing, trim/convert/audio-enhance — runs in the browser. Nothing leaves the machine. MIT, owned by Amit Rawat (@sahajamit), part of the Agentic Engineer brand.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` (open in Chrome/Edge 122+) |
| Unit tests (vitest) | `npm test` |
| E2E (Playwright + real Chrome) | `npm run e2e` |
| Typecheck | `npx tsc -b` |
| Lint / format | `npm run lint` / `npm run format` |
| Build (includes typecheck) | `npm run build` |

CI (`.github/workflows/ci.yml`) runs lint + build + unit + e2e. `pages.yml` deploys `dist/` to https://sahajamit.github.io/framecast/ on every push to main (`GITHUB_PAGES=true` sets the `/framecast/` base path).

## Architecture (the 60-second version)

```
getDisplayMedia / getUserMedia
  → MediaStreamTrackProcessor readables (transferred to worker)
  → compositor.worker.ts: OffscreenCanvas draw (frame-driven + 1 Hz heartbeat)
  → MediaStreamTrackGenerator
  → mediabunny MediaStreamVideo/AudioTrackSource (WebCodecs H.264 + AAC|Opus)
  → fragmented MP4 (1 s fragments) via StreamTarget
  → disk.worker.ts: OPFS createSyncAccessHandle, flush every 2 s
  → on stop: finalize + copy into the user's library folder (FSA dir handle)
```

Module map: `src/capture` (device acquisition) · `src/audio` (mix graph + meters) · `src/compositor` (worker, **pure geometry in `layout.ts`**, shared renderer in `scene.ts`) · `src/recorder` (session orchestrator, encoder presets, OPFS writer, crash recovery) · `src/convert` (trim + MP4/WebM/MOV via mediabunny Conversion) · `src/enhance` (RNNoise + BS.1770 loudness, video packets pass through untouched) · `src/library` (FSA folder, scan, thumbs) · `src/pip` (Document PiP deck) · `src/state` (zustand; **live objects go in `src/recorder/runtime.ts`, never the store**) · `src/app` (screens + `controller.ts` orchestration).

## Invariants — do not break these

1. **Never record through FSA `createWritable()`.** It commits only on `close()`; a crash loses everything. Live recording writes through OPFS `createSyncAccessHandle` in `disk.worker.ts` (durable, flushed every 2 s), then `promotePartToLibrary` copies the finished file out. Crash recovery (`recovery.ts`) depends on `.part.mp4` files in OPFS.
2. **The user-gesture chain.** One click cannot both open the Document PiP deck and call `getDisplayMedia`, so the two privileged calls live on separate gestures: the preflight "Select screen" click acquires the display stream (and the live preview shows the real surface), and the "Start recording" click only opens the deck and runs the countdown. Don't merge them back into one click.
3. **Pause = `videoSource.pause()` + `audioSource.pause()` in the same microtask** (mediabunny offsets timestamps for a gapless file). Mic mute is gain = 0, never `track.stop()` — silence must keep flowing for sync. The UI clock (`accumulatedMs`) is display-only.
4. **Compositing is frame-driven, never rAF/timer-driven** (hidden tabs throttle timers to 1 Hz; capture frame pumps keep flowing). The 1 Hz heartbeat redraw exists so static screens still emit fragments.
5. **Bubble geometry has one source of truth**: `compositor/layout.ts` pure functions, consumed identically by preflight canvas, PiP deck overlay and the worker. Change the math once, everywhere follows. These are unit-tested; keep them DOM-free.
6. **Recordings are fragmented MP4; every post-op output (trim/convert/enhance/recover) is standard MP4** (`fastStart: false`) for player compatibility.
7. AAC is probed at boot (`getFirstEncodableAudioCodec`); Opus is the fallback. Never hardcode AAC (Linux CI has no AAC encoder — e2e asserts accept both).

## Testing conventions

- E2E mode is `?e2e=1` (`src/library/fsAccess.ts isE2E()`): library backed by OPFS (no native picker), deck rendered inline (no PiP), 1 s countdown. Playwright launches real Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --auto-select-tab-capture-source-by-title=framecast`.
- Test hooks live on `window.__framecast` (`src/app/testHook.ts`), only in e2e mode: `listLibrary()`, `inspectFile(name)` (re-opens output with mediabunny and returns duration/codecs — this is how specs assert real file contents).
- CDP `Page.crash` never resolves its promise; send it fire-and-forget (see `e2e/recovery.spec.ts`).
- Unit tests cover pure math only (layout, BS.1770 loudness with sine reference vectors, encoder presets). Keep them free of DOM/media APIs.

## Brand & theming

- Palette mirrors amitrawat.dev (`_tokens.scss` there is the upstream source): warm black `#0B0B0C` / cream `#F5F0E8`, amber accent (`#FFB020` dark mode, `#C97A0E` light mode), coral `#FF5A4E`.
- **Semantics: amber = interactive** (toggles, sliders, links, trim, focus). **Coral = recording states only** (REC button, tally, stop, danger). Don't mix them.
- Light/dark themes flip via `data-theme` on `<html>` (tokens in `src/index.css`, runtime-switchable through Tailwind `@theme inline`). **Video surfaces never flip**: anything showing or framing video (stage, PiP deck, players, filmstrips) sits inside a `.force-dark` scope. The PiP window is always dark.
- Fonts stay Bricolage Grotesque (display) + Spline Sans Mono (UI mono) — framecast's own voice; the palette is what ties it to the brand.
- Logo: screen outline + amber camera bubble overlapping at the corner, coral lens intersection. Canonical SVG lives in `src/ui/Logo.tsx` (app header; bubble pulses coral while recording) and `public/icon.svg` (favicon/PWA). README lockups are rendered to PNG by `brand/render.mjs` — re-run it after changing the mark.

## Writing style (README, release notes, anything outward)

No em dashes. Use periods, commas, colons or parentheses. (House rule for everything shipped under Amit's byline.)

## Phase 2 backlog

Tracked in README "Roadmap": teleprompter in the deck, dual-mic, background blur, zoom-on-click, wallpaper padding, GIF export, 9:16 vertical, keyframe-snapped head-trim, Electron wrapper.
