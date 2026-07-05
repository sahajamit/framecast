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
test('page is cross-origin isolated (COOP/COEP), enabling threaded WASM', async ({ page }) => {
  // v2 (issue #11): the CPU segmentation tier relies on SharedArrayBuffer,
  // which only exists under cross-origin isolation. Headers live in
  // netlify.toml (prod) and vite.config.ts (dev/preview); this guards both
  // against silent drift and against a future asset that breaks COEP.
  await freshApp(page);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
});

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

// 1x1 red PNG — enough for the import pipeline (decode → scale → store).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('imports a custom background image, persists it across reload, records with it', async ({
  page,
}) => {
  await freshApp(page);
  await page.evaluate(() => window.__framecast!.setCameraBackground({ mode: 'builtin' }));
  await page.getByRole('tab', { name: 'Camera', exact: true }).click();

  await page
    .getByTestId('camera-bg-import')
    .setInputFiles({ name: 'my-room.png', mimeType: 'image/png', buffer: TINY_PNG });

  // Imported image appears in the gallery and becomes the active backdrop.
  const swatch = page.getByRole('button', { name: 'my-room', exact: true });
  await expect(swatch).toBeVisible();
  await expect(swatch).toHaveAttribute('aria-pressed', 'true');

  // Survives a reload: stored in IndexedDB, selection persisted in settings.
  await page.reload();
  await expect(page.locator('[data-phase="preflight"]')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'my-room', exact: true })).toBeVisible();

  await startRecording(page);
  await page.waitForTimeout(2000);
  await stopRecording(page);
  const { info } = await newestRecording(page);
  expect(info.video).toBeTruthy();
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
