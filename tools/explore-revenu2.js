// Avance jusqu'a l'etape du REVENU ESTIME et cartographie ses champs.
// On clique "Valider vos informations" (re-enregistre les infos perso inchangees)
// puis on s'ARRETE : aucune declaration de revenu n'est soumise.
// On NE dump PAS les valeurs personnelles (uniquement noms/libelles/types).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , LOGIN, PWD] = process.argv;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'downloads', '_explore_revenu');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
page.setDefaultTimeout(30000);

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

await page.goto('https://www2.carpimko.com/mesDemarches/EXERCE/DECLREVESTIME/1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
console.log('Etape 1 :', page.url());

// Avancer : valider les infos perso (inchangees)
const valider = page.locator('#ValidationDonnees, button:has-text("Valider vos informations")').first();
if (await valider.isVisible().catch(() => false)) {
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), valider.click()]);
  await page.waitForTimeout(3500);
}
console.log('Etape 2 :', page.url());
console.log('Titre :', await page.title());
await page.screenshot({ path: resolve(OUT, '2_revenu.png'), fullPage: true });

// Texte (libelles) en masquant d'eventuels nombres
const txt = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n'));
const zone = txt.replace(/\d/g, '#').slice(0, 1800);
console.log('\n===== TEXTE (chiffres masques) =====\n' + zone);

// Champs : noms/labels/types UNIQUEMENT (pas de valeurs)
const inputs = await page.$$eval('input, select, textarea', (els) =>
  els.map((e) => ({
    tag: e.tagName.toLowerCase(), type: e.type || '', name: e.name || '', id: e.id || '',
    label: e.labels && e.labels[0] ? e.labels[0].innerText.trim().replace(/\s+/g, ' ').slice(0, 90) : '',
    placeholder: e.placeholder || '',
    visible: !!(e.offsetWidth || e.offsetHeight),
    options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).slice(0, 15) : undefined,
  })).filter((x) => x.visible || x.type === 'hidden')
);
console.log('\n===== CHAMPS (sans valeurs) =====');
for (const i of inputs) console.log(JSON.stringify(i));

const btns = await page.$$eval('button, input[type=submit]', (els) =>
  els.map((e) => ({ type: e.type || '', text: (e.innerText || e.value || '').trim().slice(0, 50), id: e.id || '' })).filter((b) => b.text)
);
console.log('\n===== BOUTONS =====');
for (const b of btns) console.log(JSON.stringify(b));

console.log('\n(Arret avant toute soumission. Capture : 2_revenu.png)');
await browser.close();
