// Cartographie le formulaire "Anticiper une baisse ou une hausse de revenus".
// LECTURE SEULE : on n'envoie/ne valide RIEN. Identifiants en argv, non enregistres.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , LOGIN, PWD] = process.argv;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'downloads', '_explore_revenu');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);

// Connexion
await page.goto('https://www2.carpimko.com/Comptes/Connexion?ReturnUrl=%2F', { waitUntil: 'domcontentloaded' });
for (const sel of ['#tarteaucitronAllDenied2', 'button:has-text("Tout refuser")']) {
  const b = page.locator(sel).first();
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
}
await page.locator('input[name="TypeUtilisateur"]').first().check().catch(() => {});
await page.locator('#Login').fill(LOGIN);
await page.locator('#MotDePasse').fill(PWD);
await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('#connexionForm button[type="submit"]').click()]);
await page.waitForTimeout(2500);
if (/Comptes\/Connexion/i.test(page.url())) { console.log('ECHEC connexion'); await browser.close(); process.exit(1); }
console.log('Connecte.');

// Ouverture de la demarche
await page.goto('https://www2.carpimko.com/mesDemarches/EXERCE/DECLREVESTIME/1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
console.log('URL demarche :', page.url());
console.log('Titre :', await page.title());

await page.screenshot({ path: resolve(OUT, '1_formulaire.png'), fullPage: true });

// Texte visible (structure / libelles)
const txt = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 2500));
console.log('\n===== TEXTE VISIBLE =====\n' + txt);

// Tous les champs de saisie
const inputs = await page.$$eval('input, select, textarea', (els) =>
  els.map((e) => ({
    tag: e.tagName.toLowerCase(),
    type: e.type || '',
    name: e.name || '',
    id: e.id || '',
    placeholder: e.placeholder || '',
    value: (e.value || '').slice(0, 30),
    label: e.labels && e.labels[0] ? e.labels[0].innerText.trim().replace(/\s+/g, ' ').slice(0, 80) : '',
    visible: !!(e.offsetWidth || e.offsetHeight),
    options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).slice(0, 12) : undefined,
  }))
);
console.log('\n===== CHAMPS =====');
for (const i of inputs.filter((x) => x.visible || x.type === 'hidden')) console.log(JSON.stringify(i));

// Boutons
const btns = await page.$$eval('button, input[type=submit], a.btn', (els) =>
  els.map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type || '', text: (e.innerText || e.value || '').trim().slice(0, 50), id: e.id || '', classes: (e.className || '').slice(0, 50) }))
    .filter((b) => b.text)
);
console.log('\n===== BOUTONS =====');
for (const b of btns) console.log(JSON.stringify(b));

console.log('\nCapture : 1_formulaire.png');
await browser.close();
