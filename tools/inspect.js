// Outil ponctuel : inspecte le site CARPIMKO pour identifier les selecteurs reels
// (lien espace personnel, formulaire de connexion). Dump en console + captures.
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

console.log('=== 1. Page d\'accueil ===');
await page.goto('https://www.carpimko.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
console.log('URL:', page.url());
console.log('Titre:', await page.title());

// Fermer un eventuel bandeau cookies
for (const sel of ['button:has-text("Accepter")', 'button:has-text("Tout accepter")', '#tarteaucitronPersonalize2', 'button:has-text("OK")']) {
  const b = page.locator(sel).first();
  if (await b.isVisible().catch(() => false)) {
    console.log('Bandeau cookies ferme via:', sel);
    await b.click().catch(() => {});
    break;
  }
}

// Lister les liens qui ressemblent a un acces espace personnel / connexion
const links = await page.$$eval('a', (as) =>
  as
    .map((a) => ({ text: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80), href: a.href }))
    .filter((l) => l.text && /connex|connect|espace|compte|login|identifi/i.test(l.text + ' ' + l.href))
);
console.log('\nLiens candidats connexion/espace:');
for (const l of links.slice(0, 20)) console.log(' -', JSON.stringify(l.text), '->', l.href);

await page.screenshot({ path: resolve(OUT, '1_accueil.png'), fullPage: false });

// Essayer de naviguer vers l'espace personnel
const candidates = [
  'a:has-text("Espace personnel")',
  'a:has-text("Mon espace")',
  'a:has-text("Se connecter")',
  'a:has-text("Connexion")',
  'a:has-text("Mon compte")',
];
let navigated = false;
for (const sel of candidates) {
  const loc = page.locator(sel).first();
  if (await loc.isVisible().catch(() => false)) {
    console.log('\n=== 2. Clic sur', sel, '===');
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), loc.click()]);
    await page.waitForTimeout(3000);
    navigated = true;
    break;
  }
}
if (!navigated && links.length) {
  console.log('\n=== 2. Navigation directe vers', links[0].href, '===');
  await page.goto(links[0].href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}

console.log('URL connexion:', page.url());
console.log('Titre:', await page.title());

// Dump des inputs visibles
const inputs = await page.$$eval('input', (ins) =>
  ins.map((i) => ({
    type: i.type, name: i.name, id: i.id,
    placeholder: i.placeholder, autocomplete: i.autocomplete,
    visible: !!(i.offsetWidth || i.offsetHeight),
  }))
);
console.log('\nInputs de la page de connexion:');
for (const i of inputs) console.log(' -', JSON.stringify(i));

// Dump des boutons
const buttons = await page.$$eval('button, input[type=submit]', (bs) =>
  bs.map((b) => ({ tag: b.tagName, type: b.type, id: b.id, text: (b.innerText || b.value || '').trim().slice(0, 60) }))
);
console.log('\nBoutons:');
for (const b of buttons) console.log(' -', JSON.stringify(b));

// Dump des iframes (certains portails mettent le login dans une iframe)
const frames = page.frames().map((f) => f.url());
console.log('\nFrames:', JSON.stringify(frames, null, 1));

await page.screenshot({ path: resolve(OUT, '2_connexion.png'), fullPage: true });
console.log('\nCaptures enregistrees dans', OUT);
await browser.close();
