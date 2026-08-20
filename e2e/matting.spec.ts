import { expect, test } from '@playwright/test';
import { freshApp, newestRecording, startRecording, stopRecording } from './helpers';

/**
 * v2 matting tiers (issue #11): force each quality through the test hook and
 * prove the recording pipeline stays healthy on every path — the WebGPU
 * matting tier where the machine has it, the CPU/WASM lite tier everywhere,
 * and the demotion chain when a tier can't run (headless CI often has no
 * usable GPU delegate: the engine must degrade to a lower tier or the raw
 * camera, never to a broken take). Edge *quality* remains a manual,
 * real-hardware check; ?dbg=seg exists for exactly that.
 */
async function recordWithQuality(
  page: import('@playwright/test').Page,
  quality: 'high' | 'lite',
): Promise<void> {
  await freshApp(page);
  await page.evaluate(
    (q) =>
      window.__framecast!.setCameraBackground({ mode: 'builtin', builtinId: 'studio', quality: q }),
    quality,
  );
  await startRecording(page);
  await page.waitForTimeout(3000);
  await stopRecording(page);
  const { info } = await newestRecording(page);
  expect(info.video).toBeTruthy();
  expect(info.duration).toBeGreaterThan(2.5);
}

test('lite quality (CPU/WASM path) records a healthy take', async ({ page }) => {
  await recordWithQuality(page, 'lite');
});

test('refined mask preserves orientation (WebGL V-flip regression)', async ({ page }) => {
  // Feed the refiner a mask whose TOP half is white and assert the published
  // canvas reads top-down through drawImage. Guards the texture-vs-framebuffer
  // V-flip that once rendered every person cutout upside down.
  await freshApp(page);
  const res = await page.evaluate(async () => {
    // Resolved by the Vite dev server inside the page, not by tsc.
    const modulePath = '/src/compositor/matting/refine.ts';
    const { createMaskRefiner } = (await import(modulePath)) as {
      createMaskRefiner: () => {
        render(i: {
          mask: Uint8Array;
          maskW: number;
          maskH: number;
          guideLo: OffscreenCanvas;
          guideHi: OffscreenCanvas;
        }): OffscreenCanvas | null;
        close(): void;
      } | null;
    };
    const refiner = createMaskRefiner();
    if (!refiner) return null; // no WebGL2 in this environment: nothing to guard
    const mw = 64;
    const mh = 64;
    const mask = new Uint8Array(mw * mh);
    for (let y = 0; y < mh / 2; y++) mask.fill(255, y * mw, (y + 1) * mw);
    const guide = (w: number, h: number) => {
      const cnv = new OffscreenCanvas(w, h);
      const cx = cnv.getContext('2d')!;
      cx.fillStyle = '#777';
      cx.fillRect(0, 0, w, h);
      return cnv;
    };
    const out = refiner.render({
      mask,
      maskW: mw,
      maskH: mh,
      guideLo: guide(mw, mh),
      guideHi: guide(256, 256),
    });
    if (!out) return null;
    const read = new OffscreenCanvas(out.width, out.height);
    const rc = read.getContext('2d')!;
    rc.drawImage(out, 0, 0);
    const top = rc.getImageData(128, 32, 1, 1).data[3]!;
    const bottom = rc.getImageData(128, 224, 1, 1).data[3]!;
    refiner.close();
    return { top, bottom };
  });
  test.skip(res === null, 'WebGL2 unavailable in this environment');
  expect(res!.top).toBeGreaterThan(200);
  expect(res!.bottom).toBeLessThan(50);
});

test('high quality (WebGPU matting or graceful demotion) records a healthy take', async ({ page }) => {
  await recordWithQuality(page, 'high');
});
