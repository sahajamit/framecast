import { expect, test } from '@playwright/test';
import { freshApp, newestRecording, startRecording, stopRecording } from './helpers';

/**
 * Scene framing (issue #5): a recording made with a backdrop must bake that
 * frame into the actual MP4. We use a bright `bone` backdrop with generous
 * padding so a decoded top-left pixel is unambiguously the backdrop, not the
 * (dark) captured screen.
 */
test('bakes a scene backdrop into the recorded output', async ({ page }) => {
  await freshApp(page);
  await page.evaluate(() =>
    window.__framecast!.setFrame({ backdrop: 'bone', pad: 0.08, radius: 16, shadow: true }),
  );

  await startRecording(page);
  await page.waitForTimeout(4_000);
  await stopRecording(page);

  const { name, info } = await newestRecording(page);
  expect(name).toMatch(/^framecast-.*\.mp4$/);
  expect(info.video).toBeTruthy();
  expect(info.video!.codec).toBe('avc');
  expect(info.duration).toBeGreaterThan(2.5);

  // The framed corner shows the bright `bone` backdrop, not the captured screen.
  const [r, g, b] = await page.evaluate((n) => window.__framecast!.sampleTopLeft(n), name);
  expect(r).toBeGreaterThan(170);
  expect(g).toBeGreaterThan(150);
  expect(b).toBeGreaterThan(120);
});
