import { expect, test } from '@playwright/test';
import { freshApp, listLibrary, startRecording } from './helpers';

test('a crashed tab leaves a recoverable recording', async ({ page, context }) => {
  await freshApp(page);
  await startRecording(page);
  // Record long enough for several 2 s OPFS flushes to land on disk.
  await page.waitForTimeout(6_000);

  // Kill the renderer mid-recording — no stop, no finalize.
  const cdp = await context.newCDPSession(page);
  // The renderer dies before CDP can reply — never await this call.
  void cdp.send('Page.crash').catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  const revived = await context.newPage();
  await revived.goto('/?e2e=1');
  await expect(revived.getByText(/interrupted take/i)).toBeVisible({ timeout: 15_000 });
  await revived.getByRole('button', { name: /^recover take$/i }).click();
  await expect(revived.getByText(/^Recovered /)).toBeVisible({ timeout: 60_000 });

  const recovered = (await listLibrary(revived)).find((n) => n.includes('recovered'));
  expect(recovered).toBeTruthy();
  const info = await revived.evaluate((n) => window.__framecast!.inspectFile(n), recovered!);
  // At least the flushed fragments must be playable.
  expect(info.duration).toBeGreaterThan(1);
  expect(info.video).toBeTruthy();
});
