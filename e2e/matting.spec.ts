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

test('high quality (WebGPU matting or graceful demotion) records a healthy take', async ({ page }) => {
  await recordWithQuality(page, 'high');
});
