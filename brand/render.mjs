// Renders the README brand lockups (transparent PNGs) from render.html.
// Run from the repo root: node brand/render.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const page_url = (variant) => `file://${path.join(here, 'render.html')}?variant=${variant}`;

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--allow-file-access-from-files'],
});
const page = await browser.newPage({ deviceScaleFactor: 2 });

for (const variant of ['dark', 'light']) {
  await page.goto(page_url(variant));
  await page.evaluate(() => document.fonts.ready);
  const lockup = page.locator('#lockup');
  await lockup.screenshot({
    path: path.join(here, `framecast-lockup-${variant}.png`),
    omitBackground: true,
  });
  console.log(`rendered framecast-lockup-${variant}.png`);
}

await browser.close();
