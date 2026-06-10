// Exploration ponctuelle de l'espace personnel (apres connexion) pour caler les
// selecteurs de la rubrique "appels de cotisations". Identifiants passes en argv,
// JAMAIS enregistres. Captures dans downloads/_explore.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , LOGIN, PWD] = process.argv;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'downloads', '_explore');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);

async function dumpLinks(tag) {
  const links = await page.$$eval('a', (as) =>
    as
      .map((a) => ({ text: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60), href: a.href }))
      .filter((l) => l.text || /carpimko/i.test(l.href))
  );
  console.log(`\n--- Liens (${tag}) : ${links.length} ---`);
  for (const l of links) console.log('  ', JSON.stringify(l.text), '->', l.href);
}

await page.goto('https://www2.carpimko.com/Comptes/Connexion?ReturnUrl=%2F', { waitUntil: 'domcontentloaded' });
for (const sel of ['#tarteaucitronAllDenied2', 'button:has-text("Tout refuser")']) {
  const b = page.locator(sel).first();
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
}
await page.locator('input[name="TypeUtilisateur"]').first().check().catch(() => {});
await page.locator('#Login').fill(LOGIN);
await page.locator('#MotDePasse').fill(PWD);
await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('#connexionForm button[type="submit"]').click()]);
await page.waitForTimeout(3000);

console.log('URL apres connexion:', page.url());
console.log('Titre:', await page.title());
if (/Comptes\/Connexion/i.test(page.url())) {
  const err = await page.locator('.field-validation-error, .alert-danger, .validation-summary-errors').first().innerText().catch(() => '');
  console.log('ECHEC connexion:', err);
  await page.screenshot({ path: resolve(OUT, 'echec.png'), fullPage: true });
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: resolve(OUT, 'accueil_espace.png'), fullPage: true });
await dumpLinks('accueil espace');

// Cherche un lien/onglet lie aux cotisations
const motsCles = ['cotisation', 'appel', 'document', 'courrier', 'paiement', 'attestation', 'echeance'];
const cibles = await page.$$eval('a', (as, mots) =>
  as
    .map((a) => ({ text: (a.innerText || '').trim().replace(/\s+/g, ' '), href: a.href }))
    .filter((l) => mots.some((m) => (l.text + ' ' + l.href).toLowerCase().includes(m))),
  motsCles
);
console.log('\n=== Cibles cotisations/documents ===');
for (const c of cibles) console.log('  ', JSON.stringify(c.text), '->', c.href);

// Suivre la 1ere cible la plus pertinente (priorite "cotisation")
const prio = cibles.sort((a, b) => {
  const score = (t) => (/cotisation/i.test(t) ? 0 : /appel/i.test(t) ? 1 : /document|courrier/i.test(t) ? 2 : 3);
  return score(a.text + a.href) - score(b.text + b.href);
});
if (prio.length) {
  const target = prio[0];
  console.log('\n>>> Navigation vers:', JSON.stringify(target.text), target.href);
  await page.goto(target.href, { waitUntil: 'domcontentloaded' }).catch(async () => {
    await page.locator(`a:has-text("${target.text}")`).first().click().catch(() => {});
  });
  await page.waitForTimeout(3000);
  console.log('URL rubrique:', page.url());
  await page.screenshot({ path: resolve(OUT, 'rubrique.png'), fullPage: true });
  await dumpLinks('rubrique');

  // Liste des liens PDF / telechargement sur cette page
  const pdfs = await page.$$eval('a', (as) =>
    as.map((a) => ({ text: (a.innerText || '').trim().slice(0, 60), href: a.href }))
      .filter((l) => /\.pdf|telecharg|document|download/i.test(l.href + ' ' + l.text))
  );
  console.log('\n=== Liens documents/PDF sur la rubrique ===');
  for (const p of pdfs) console.log('  ', JSON.stringify(p.text), '->', p.href);
}

console.log('\nCaptures dans', OUT);
await browser.close();
