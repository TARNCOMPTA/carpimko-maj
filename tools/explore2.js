// Explore la page "Mes documents & attestations" et teste le telechargement
// d'un appel de cotisations. Identifiants en argv, non enregistres.
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

console.log('=== Page Mes documents & attestations ===');
await page.goto('https://www2.carpimko.com/migration/MesDocuments', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
console.log('URL:', page.url(), '| Titre:', await page.title());
await page.screenshot({ path: resolve(OUT, 'mes_documents.png'), fullPage: true });

// Texte visible (structure de la page)
const txt = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 2000));
console.log('\nTexte:\n', txt);

// Tous les liens download/viewDocument avec leur fileName
const docs = await page.$$eval('a[href*="download"], a[href*="viewDocument"], a[href$=".pdf"]', (as) =>
  as.map((a) => {
    const u = new URL(a.href);
    return {
      type: u.pathname.includes('viewDocument') ? 'view' : 'download',
      fileName: u.searchParams.get('fileName') || '',
      text: (a.closest('tr,li,div')?.innerText || a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      href: a.href,
    };
  })
);
console.log(`\n=== ${docs.length} lien(s) document ===`);
for (const d of docs) console.log(`  [${d.type}] ${d.fileName} | ctx="${d.text}"`);

// Test telechargement d'un appel de cotisations (lien "download")
const appel = docs.find((d) => d.type === 'download' && /APPEL_DE_COTISATIONS/i.test(d.fileName));
if (appel) {
  console.log('\n>>> Test telechargement:', appel.fileName);
  const link = page.locator(`a[href="${appel.href.replace(/"/g, '&quot;')}"]`).first();
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      link.click({ force: true }),
    ]);
    const dest = resolve(OUT, dl.suggestedFilename() || 'appel_test.pdf');
    await dl.saveAs(dest);
    console.log('Telecharge via clic ->', dest);
  } catch (e) {
    console.log('Clic download a echoue, essai via requete HTTP avec cookies:', e.message);
    const resp = await context.request.get(appel.href);
    const buf = await resp.body();
    const fs = await import('node:fs');
    const dest = resolve(OUT, appel.fileName || 'appel_test.pdf');
    fs.writeFileSync(dest, buf);
    console.log(`Telecharge via HTTP (${buf.length} octets) ->`, dest);
  }
} else {
  console.log('\nAucun lien "download" APPEL_DE_COTISATIONS sur cette page (verifier captures).');
}

await browser.close();
