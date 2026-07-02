import { expect, test } from '@playwright/test';
import { freshApp, newestRecording, startRecording, stopRecording } from './helpers';

/**
 * Turning on a camera background exercises the per-frame segmentation stage in
 * the compositor worker. This asserts the pipeline PATH survives it: a valid
 * recording of the expected duration, no renderer crash, no encoder stall — even
 * when segmentation can't run (headless Chrome may lack a GPU delegate), because
 * the compositor then falls back to the raw camera. Segmentation *quality* is a
 * manual, real-hardware check (see issue #9), not something a fake camera can
 * meaningfully assert.
 */
test('records with a built-in camera background without breaking the pipeline', async ({ page }) => {
  await freshApp(page);
  await page.evaluate(() =>
    window.__framecast!.setCameraBackground({ mode: 'builtin', builtinId: 'studio' }),
  );

  await startRecording(page);
  await page.waitForTimeout(2500);
  await stopRecording(page);

  const { info } = await newestRecording(page);
  expect(info.video).toBeTruthy();
  expect(info.duration).toBeGreaterThan(2);
});

test('switching to Blur mid-preflight leaves recording healthy', async ({ page }) => {
  await freshApp(page);
  await page.evaluate(() => window.__framecast!.setCameraBackground({ mode: 'blur', blur: 24 }));

  await startRecording(page);
  await page.waitForTimeout(2500);
  await stopRecording(page);

  const { info } = await newestRecording(page);
  expect(info.video).toBeTruthy();
  expect(info.duration).toBeGreaterThan(2);
});
