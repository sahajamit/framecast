import { expect, test } from '@playwright/test';
import { freshApp, newestRecording, startRecording, stopRecording } from './helpers';

/**
 * Live zoom + spotlight (issue #6): driving focus mid-take through the worker
 * must produce a valid, playable recording and never crash the renderer. The
 * crop/spotlight math and the glide are unit-tested; this guards the live
 * pipeline end to end, including the screen-only path (no camera bubble, which
 * is the main way demos are recorded).
 */
test('records mid-take zoom + spotlight (screen-only) into a playable file', async ({ page }) => {
  let crashed = false;
  page.on('crash', () => {
    crashed = true;
  });

  await freshApp(page);
  await page.getByRole('button', { name: /^screen$/i }).click();
  await startRecording(page);

  // Punch into an off-center region…
  await page.evaluate(() =>
    window.__framecast!.setFocus({ mode: 'zoom', cx: 0.7, cy: 0.4, w: 0.25, h: 0.25 }),
  );
  await page.waitForTimeout(1500);
  // …switch to a spotlight…
  await page.evaluate(() =>
    window.__framecast!.setFocus({ mode: 'spotlight', cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 }),
  );
  await page.waitForTimeout(1500);
  // …then pull all the way back out.
  await page.evaluate(() =>
    window.__framecast!.setFocus({ mode: 'none', cx: 0.5, cy: 0.5, w: 1, h: 1 }),
  );
  await page.waitForTimeout(800);

  await stopRecording(page);
  expect(crashed, 'renderer must not crash while changing focus').toBe(false);

  const { name, info } = await newestRecording(page);
  expect(name).toMatch(/^framecast-.*\.mp4$/);
  expect(info.video).toBeTruthy();
  expect(info.video!.codec).toBe('avc');
  expect(info.duration).toBeGreaterThan(2.5);
});
