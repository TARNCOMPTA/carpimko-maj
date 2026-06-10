// Inspection de la vraie page de connexion de l'espace personnel CARPIMKO.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'downloads', '_inspect');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(30000);

await page.goto('https://www2.carpimko.com/Comptes/Connexion?ReturnUrl=%2F', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
console.log('URL:', page.url());
console.log('Titre:', await page.title());

const inputs = await page.$$eval('input', (ins) =>
  ins.map((i) => ({
    type: i.type, name: i.name, id: i.id,
    placeholder: i.placeholder,
    label: i.labels && i.labels[0] ? i.labels[0].innerText.trim() : '',
    visible: !!(i.offsetWidth || i.offsetHeight),
  }))
);
console.log('\nInputs:');
for (const i of inputs) console.log(' -', JSON.stringify(i));

const buttons = await page.$$eval('button, input[type=submit], a.btn', (bs) =>
  bs.map((b) => ({ tag: b.tagName, type: b.type || '', id: b.id, classes: b.className?.slice?.(0, 60), text: (b.innerText || b.value || '').trim().slice(0, 60) }))
);
console.log('\nBoutons:');
for (const b of buttons) console.log(' -', JSON.stringify(b));

const formsInfo = await page.$$eval('form', (fs) => fs.map((f) => ({ action: f.action, method: f.method, id: f.id })));
console.log('\nForms:', JSON.stringify(formsInfo, null, 1));

// Texte visible global (debut) pour comprendre la page
const text = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1500));
console.log('\nTexte de la page:\n', text);

await page.screenshot({ path: resolve(OUT, '3_connexion_reelle.png'), fullPage: true });
console.log('\nCapture: 3_connexion_reelle.png');
await browser.close();
