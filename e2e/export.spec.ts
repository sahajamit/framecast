import { expect, test } from '@playwright/test';
import { freshApp, inspectFile, listLibrary, startRecording, stopRecording } from './helpers';

test('converts a recording to WebM and MOV locally', async ({ page }) => {
  await freshApp(page);
  await startRecording(page);
  await page.waitForTimeout(4_000);
  await stopRecording(page);

  // WebM (VP9 + Opus re-encode).
  await page.getByRole('button', { name: /^webm$/i }).click();
  await expect(page.getByText('local processing')).toBeHidden({ timeout: 90_000 });
  const webm = (await listLibrary(page)).find((n) => n.endsWith('.webm'));
  expect(webm).toBeTruthy();
  const webmInfo = await inspectFile(page, webm!);
  expect(webmInfo.video?.codec).toBe('vp9');
  expect(webmInfo.audio?.codec).toBe('opus');
  expect(webmInfo.duration).toBeGreaterThan(2.5);

  // MOV (video packets copied).
  await page.getByRole('button', { name: /^mov$/i }).click();
  await expect(page.getByText('local processing')).toBeHidden({ timeout: 90_000 });
  const mov = (await listLibrary(page)).find((n) => n.endsWith('.mov'));
  expect(mov).toBeTruthy();
  const movInfo = await inspectFile(page, mov!);
  expect(movInfo.video?.codec).toBe('avc');
  expect(movInfo.duration).toBeGreaterThan(2.5);
});

test('trim cuts the tail without re-encoding', async ({ page }) => {
  await freshApp(page);
  await startRecording(page);
  await page.waitForTimeout(6_000);
  await stopRecording(page);

  // Pull the out-handle to ~3s, keep in-handle at 0 (fast copy path).
  const handles = page.locator('input.trim-range');
  await handles.nth(1).fill('3');
  await page.getByRole('button', { name: /apply trim/i }).click();
  await expect(page.getByText('local processing')).toBeHidden({ timeout: 60_000 });

  const trimmed = (await listLibrary(page)).find((n) => n.includes('(trimmed)'));
  expect(trimmed).toBeTruthy();
  const info = await inspectFile(page, trimmed!);
  expect(info.duration).toBeGreaterThan(2);
  expect(info.duration).toBeLessThan(4);
});
