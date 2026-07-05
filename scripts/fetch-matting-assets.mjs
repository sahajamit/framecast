#!/usr/bin/env node
/**
 * Stages the high-tier matting assets (issue #11) into public/ so they ship
 * same-origin (local-first promise — no CDN at runtime):
 *
 *  - public/ort/     onnxruntime-web's WebGPU wasm runtime, copied from
 *                    node_modules (kept out of git; version follows the dep).
 *  - public/models/  RobustVideoMatting fp32 ONNX (~15 MB), downloaded once
 *                    from the official release and kept out of git.
 *
 * Runs automatically before dev/build (predev/prebuild). Idempotent and
 * offline-safe once the files exist.
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ORT_FILES = [
  // The single-file ESM runtime, imported at runtime from /ort/ (never
  // bundled by Vite — keeps 20+ MB of ORT wasm variants out of dist).
  'ort.webgpu.bundle.min.mjs',
  // ORT 1.27's WebGPU EP loads the asyncify wasm runtime; jsep stays as the
  // fallback pair some code paths still probe for.
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];
const ORT_SRC = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ORT_DST = join(root, 'public', 'ort');

const MODEL_URL =
  'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx';
const MODEL_DST = join(root, 'public', 'models', 'rvm_mobilenetv3_fp32.onnx');
/** Sanity floor: the real model is ~15 MB; anything tiny is an error page. */
const MODEL_MIN_BYTES = 10 * 1024 * 1024;

mkdirSync(ORT_DST, { recursive: true });
for (const f of ORT_FILES) {
  const src = join(ORT_SRC, f);
  const dst = join(ORT_DST, f);
  if (!existsSync(src)) {
    console.error(`[matting-assets] missing ${src} — is onnxruntime-web installed?`);
    process.exit(1);
  }
  if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) {
    copyFileSync(src, dst);
    console.log(`[matting-assets] staged ort/${f}`);
  }
}

mkdirSync(dirname(MODEL_DST), { recursive: true });
if (!existsSync(MODEL_DST) || statSync(MODEL_DST).size < MODEL_MIN_BYTES) {
  // A missing model must never block local development (offline clone,
  // firewalled machine): the runtime demotes high → balanced gracefully.
  // Deploy builds (CI/Netlify) DO fail hard — shipping without the model
  // would silently strip the high tier from every user.
  const deployBuild = !!process.env.CI || !!process.env.NETLIFY;
  const fail = (msg) => {
    console.error(`[matting-assets] ${msg}`);
    if (deployBuild) process.exit(1);
    console.warn(
      '[matting-assets] continuing without the RVM model: the High matting tier will demote to Balanced until it is staged (re-run with network access).',
    );
  };
  console.log('[matting-assets] downloading RobustVideoMatting fp32 (~15 MB, one-time)…');
  try {
    const res = await fetch(MODEL_URL, { redirect: 'follow' });
    if (!res.ok) {
      fail(`model download failed: HTTP ${res.status}`);
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < MODEL_MIN_BYTES) {
        fail(`model download truncated (${buf.length} bytes)`);
      } else {
        writeFileSync(MODEL_DST, buf);
        console.log(`[matting-assets] staged models/rvm_mobilenetv3_fp32.onnx (${buf.length} bytes)`);
      }
    }
  } catch (err) {
    fail(`model download failed: ${err?.message ?? err}`);
  }
}
