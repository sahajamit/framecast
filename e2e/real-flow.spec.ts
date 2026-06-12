import { expect, test, type Page } from '@playwright/test';

/**
 * Regression for issue #4: records in REAL mode — no ?e2e=1, so the real
 * 3-second countdown runs, the real Document PiP deck is attempted, and the
 * library uses the production folder-mode path (handle seeded into IDB,
 * since the native picker can't be automated). The original bug crashed the
 * renderer at the countdown→recording transition whenever a mic was on.
 */
test('real flow with mic: 3s countdown, PiP deck, record → review without a renderer crash', async ({
  page,
}) => {
  let crashed = false;
  page.on('crash', () => {
    crashed = true;
  });

  await page.goto('/');
  await seedLibraryFolder(page);
  await page.reload();
  await expect(page.locator('[data-phase="preflight"]')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /select screen/i }).click();
  await expect(page.getByRole('button', { name: /start recording/i })).toBeEnabled({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /start recording/i }).click();

  // Real countdown is 3 s; the crash fired right as recording began.
  await expect(page.locator('[data-phase="recording"]')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(6_000);
  expect(crashed, 'renderer must not crash while recording with a mic').toBe(false);

  // Stop from whichever surface is available (PiP deck renders in its own
  // window; the in-tab fallback buttons always exist).
  await page.getByRole('button', { name: /stop & save/i }).first().click();
  await expect(page.locator('[data-phase="review"]')).toBeVisible({ timeout: 30_000 });
  expect(crashed).toBe(false);

  // The take landed in the library folder.
  const names = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('real-flow-library');
    const found: string[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') found.push(entry.name);
    }
    return found;
  });
  expect(names.some((n) => /^framecast-.*\.mp4$/.test(n))).toBe(true);
});

/**
 * Folder-mode boot needs a saved directory handle. An OPFS handle is
 * structured-cloneable into idb-keyval's store and satisfies the production
 * code path (queryPermission included) without a native picker.
 */
async function seedLibraryFolder(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('real-flow-library', { recursive: true }).catch(() => {});
    const dir = await root.getDirectoryHandle('real-flow-library', { create: true });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('keyval-store');
      open.onupgradeneeded = () => open.result.createObjectStore('keyval');
      open.onsuccess = () => {
        const tx = open.result.transaction('keyval', 'readwrite');
        tx.objectStore('keyval').put(dir, 'framecast-library-dir');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('idb error'));
      };
      open.onerror = () => reject(open.error ?? new Error('idb open error'));
    });
  });
}
