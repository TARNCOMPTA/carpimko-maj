import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'downloads', '_ui');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });

// Ajoute un client temporaire via l'API pour que les tableaux ne soient pas vides
await page.goto('http://localhost:3050');
await page.waitForTimeout(800);

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, `ui_${theme}.png`), fullPage: true });
  console.log('Capture', theme);
}
await browser.close();
