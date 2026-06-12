import { expect, type Page } from '@playwright/test';

export async function freshApp(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  // Isolate: wipe OPFS (library + parts) and persisted settings.
  await page.evaluate(async () => {
    localStorage.clear();
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const entry of root.values()) names.push(entry.name);
    for (const name of names) {
      await root.removeEntry(name, { recursive: true }).catch(() => {});
    }
  });
  await page.reload();
  await expect(page.locator('[data-phase="preflight"]')).toBeVisible({ timeout: 15_000 });
}

export async function startRecording(page: Page): Promise<void> {
  await page.getByRole('button', { name: /start recording/i }).click();
  await expect(page.locator('[data-phase="recording"]')).toBeVisible({ timeout: 20_000 });
}

export async function stopRecording(page: Page): Promise<void> {
  await page.getByRole('button', { name: /stop & save/i }).first().click();
  await expect(page.locator('[data-phase="review"]')).toBeVisible({ timeout: 30_000 });
}

export interface InspectInfo {
  duration: number;
  video: { codec: string | null; width: number; height: number; duration: number } | null;
  audio: { codec: string | null; duration: number } | null;
}

export async function listLibrary(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__framecast!.listLibrary());
}

export async function inspectFile(page: Page, name: string): Promise<InspectInfo> {
  return page.evaluate((n) => window.__framecast!.inspectFile(n), name);
}

export async function newestRecording(page: Page): Promise<{ name: string; info: InspectInfo }> {
  const names = (await listLibrary(page)).filter((n) => /\.(mp4|webm|mov)$/.test(n));
  const name = names[names.length - 1];
  if (!name) throw new Error('library is empty');
  return { name, info: await inspectFile(page, name) };
}

declare global {
  interface Window {
    __framecast?: {
      inspectFile(name: string): Promise<InspectInfo>;
      listLibrary(): Promise<string[]>;
    };
  }
}
