import { expect, test } from '@playwright/test';
import { freshApp, newestRecording, startRecording, stopRecording } from './helpers';

test('pause leaves no gap and keeps audio/video in sync', async ({ page }) => {
  await freshApp(page);
  await startRecording(page);

  await page.waitForTimeout(4_000);
  await page.getByRole('button', { name: /pause/i }).first().click();
  await expect(page.locator('[data-phase="paused"]')).toBeVisible();

  await page.waitForTimeout(3_000); // this span must NOT appear in the file
  await page.getByRole('button', { name: /resume/i }).first().click();
  await expect(page.locator('[data-phase="recording"]')).toBeVisible();

  await page.waitForTimeout(4_000);
  await stopRecording(page);

  const { info } = await newestRecording(page);
  // ~8 s recorded, 3 s paused: the pause must be cut out of the timeline.
  expect(info.duration).toBeGreaterThan(6.5);
  expect(info.duration).toBeLessThan(10);
  expect(info.video).toBeTruthy();
  expect(info.audio).toBeTruthy();
  // A/V duration parity guards against pause-induced sync drift.
  expect(Math.abs(info.video!.duration - info.audio!.duration)).toBeLessThan(0.3);
});
