import { expect, test } from '@playwright/test';
import { freshApp, newestRecording, startRecording, stopRecording } from './helpers';

test('records screen + camera + mic into a playable H.264 MP4', async ({ page }) => {
  await freshApp(page);
  await startRecording(page);
  await page.waitForTimeout(8_000);
  await stopRecording(page);

  const { name, info } = await newestRecording(page);
  expect(name).toMatch(/^framecast-.*\.mp4$/);
  expect(info.video).toBeTruthy();
  expect(info.video!.codec).toBe('avc');
  expect(info.video!.width).toBeGreaterThan(0);
  expect(info.duration).toBeGreaterThan(6);
  expect(info.duration).toBeLessThan(12);
  // Mic was enabled by default, so an audio track must exist (AAC or Opus).
  expect(info.audio).toBeTruthy();
  expect(['aac', 'opus']).toContain(info.audio!.codec);
});

test('screen-only layout records without an audio-less camera bubble', async ({ page }) => {
  await freshApp(page);
  await page.getByRole('button', { name: /^screen$/i }).click();
  await startRecording(page);
  await page.waitForTimeout(4_000);
  await stopRecording(page);

  const { info } = await newestRecording(page);
  expect(info.video).toBeTruthy();
  expect(info.duration).toBeGreaterThan(2.5);
});
