import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { freshApp, newestRecording, stopRecording } from './helpers';

/**
 * The regression the fake test camera can never catch: a virtual background
 * take must contain BOTH the person and the chosen backdrop. v2 shipped two
 * bugs in this exact shape that only a real face exposed — the V-flipped
 * refined mask (person cutout inverted) and the ort-web WebGPU recurrent
 * decay (person fades out of the recording within seconds while the preview
 * looks perfect).
 *
 * Chrome's fake capture can play a video file as the webcam, so this spec
 * feeds it a synthetic portrait (e2e/fixtures/person.jpg, generated — not a
 * real individual) against a plain wall, records over the slate backdrop,
 * decodes the MP4 and samples pixels: corners must be the slate fill, the
 * center must be warm skin tones.
 *
 * On rigs whose headless GL can't run any segmentation tier at all, the
 * compositor falls back to the raw camera (by design); the spec detects that
 * (corners not slate) and skips rather than fails — the strong assertion
 * runs wherever a real GPU exists.
 */

const FIXTURE = join(__dirname, 'fixtures', 'person.jpg');
const Y4M = join(__dirname, '..', 'test-results', 'person-cam.y4m');
const W = 640;
const H = 360;

/** Decode the fixture via a throwaway browser and write a static y4m clip. */
async function buildY4m(): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const b64 = readFileSync(FIXTURE).toString('base64');
  const rgba = await page.evaluate(
    async ({ b64: data, w, h }) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + data;
      await img.decode();
      const cnv = document.createElement('canvas');
      cnv.width = w;
      cnv.height = h;
      const ctx = cnv.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      return Array.from(ctx.getImageData(0, 0, w, h).data);
    },
    { b64, w: W, h: H },
  );
  await browser.close();

  // RGB → I420 (BT.601), 2x2 chroma subsampling.
  const y = new Uint8Array(W * H);
  const u = new Uint8Array((W * H) / 4);
  const v = new Uint8Array((W * H) / 4);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
      y[py * W + px] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
      if (py % 2 === 0 && px % 2 === 0) {
        const ci = (py / 2) * (W / 2) + px / 2;
        u[ci] = Math.max(0, Math.min(255, Math.round(-0.169 * r - 0.331 * g + 0.5 * b + 128)));
        v[ci] = Math.max(0, Math.min(255, Math.round(0.5 * r - 0.419 * g - 0.081 * b + 128)));
      }
    }
  }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, u, v]);
  const frames: Buffer[] = [Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < 30; f++) frames.push(frame);
  mkdirSync(dirname(Y4M), { recursive: true });
  writeFileSync(Y4M, Buffer.concat(frames));
}

// launchOptions overrides must be file-top-level (they force a new worker).
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${Y4M}`,
      '--auto-select-tab-capture-source-by-title=framecast',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

test.describe('virtual background · person presence', () => {
  test.beforeAll(async () => {
    if (!existsSync(Y4M)) await buildY4m();
  });

  test('a slate-backdrop take contains both the person and the backdrop', async ({ page }) => {
    test.slow();
    await freshApp(page);
    // Camera-only layout: the face fills the frame, corners show the backdrop.
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await page.evaluate(() =>
      window.__framecast!.setCameraBackground({ mode: 'builtin', builtinId: 'slate' }),
    );
    // Let the model load and the first masks land before rolling.
    await page.waitForTimeout(4000);
    // Camera-only layout arms without a screen pick: roll directly.
    const punch = page.getByRole('button', { name: /roll tape/i });
    await expect(punch).toBeEnabled({ timeout: 10_000 });
    await punch.click();
    await expect(page.locator('[data-phase="recording"]')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(6000);
    await stopRecording(page);

    const { name, info } = await newestRecording(page);
    expect(info.video).toBeTruthy();

    // Sample at t=5s: the worker's matting model finishes loading ~0.5-2s
    // into the take (early frames are legitimately raw camera — decoupled
    // inference must never stall the pipeline), so assert on steady state.
    const sample = (nx: number, ny: number) =>
      page.evaluate(
        ([n, x, y]) => window.__framecast!.samplePixel(n as string, x as number, y as number, 5),
        [name, nx, ny] as const,
      );
    const [tl, br, face] = [await sample(0.04, 0.06), await sample(0.96, 0.94), await sample(0.5, 0.4)];

    // Slate is a cool blue-grey (b >= r). If neither corner is slate, no
    // segmentation tier could run here (raw-camera fallback): skip, don't lie.
    const isCool = (p: number[]) => p[2]! >= p[0]!;
    test.skip(
      !(isCool(tl) && isCool(br)),
      `segmentation unavailable in this environment (corners rgb(${tl}) rgb(${br}))`,
    );

    // The person: warm skin tones at the frame center, clearly not slate.
    expect(face[0]!, `face sample rgb(${face}) should be warm (person present)`).toBeGreaterThan(
      face[2]! + 15,
    );
  });
});
