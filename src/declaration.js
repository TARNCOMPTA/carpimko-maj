// Declaration de revenus estimes sur l'espace CARPIMKO ("Anticiper une baisse ou
// une hausse de revenus"). Deux modes :
//   - apercuRevenu()  : remplit le formulaire et fait une CAPTURE, sans envoyer.
//   - envoyerRevenu() : remplit ET soumet la demande (action reelle), puis capture
//                       la confirmation.
//
// Parcours verifie le 10/06/2026 :
//   1. Connexion (Affilie)
//   2. /mesDemarches/EXERCE/DECLREVESTIME/1 -> page "Validation de Donnees"
//   3. clic "Valider vos informations" (#ValidationDonnees) -> formulaire revenu
//   4. champ #RevenuEstime (montant en euros, sans centimes) ; case #RevenusNegatifs
//   5. "Valider la demande" puis "Confirmer" (#btnConfirmer)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = resolve(__dirname, '..', 'downloads', '_revenu');

const LOGIN_URL =
  process.env.CARPIMKO_LOGIN_URL || 'https://www2.carpimko.com/Comptes/Connexion?ReturnUrl=%2F';
const DEMARCHE_URL = 'https://www2.carpimko.com/mesDemarches/EXERCE/DECLREVESTIME/1';

function sanitize(s) {
  return String(s).replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

async function fermerCookies(page) {
  for (const sel of ['#tarteaucitronAllDenied2', 'button:has-text("Tout refuser")']) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); return; }
  }
}

// Connexion + navigation jusqu'au formulaire de revenu + remplissage du montant.
// Renvoie { browser, page } pret pour capture ou soumission.
async function ouvrirEtRemplir(client, montant, negatif, log) {
  const headless = String(process.env.HEADLESS ?? 'false').toLowerCase() !== 'false';
  const navTimeout = Number(process.env.NAV_TIMEOUT ?? 45000);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(navTimeout);

  // 1) Connexion
  log('Connexion...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await fermerCookies(page);
  await page.locator('input[name="TypeUtilisateur"]').first().check().catch(() => {});
  await page.locator('#Login').fill(client.login);
  await page.locator('#MotDePasse').fill(client.password);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('#connexionForm button[type="submit"]').click()]);
  await page.waitForTimeout(1800);
  if (/Comptes\/Connexion/i.test(page.url())) {
    const e = new Error('Connexion refusee (mot de passe ?)');
    e.kind = 'mdp';
    throw e;
  }

  // 2) Ouverture de la demarche -> page de validation des infos
  log('Ouverture de la demarche...');
  await page.goto(DEMARCHE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 3) Valider les infos perso (inchangees) pour atteindre le formulaire de revenu
  const valider = page.locator('#ValidationDonnees, button:has-text("Valider vos informations")').first();
  if (await valider.isVisible().catch(() => false)) {
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), valider.click()]);
    await page.waitForTimeout(3000);
  }

  // 4) Le champ du montant doit etre present
  const champMontant = page.locator('#RevenuEstime');
  await champMontant.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    throw new Error("Formulaire de revenu introuvable (page CARPIMKO modifiee ?).");
  });

  // Remplissage
  if (negatif) {
    log('Revenus negatifs : case cochee.');
    await page.locator('#RevenusNegatifs').check().catch(() => {});
  }
  await champMontant.fill(String(montant));
  log(`Montant saisi : ${montant} € (sans centimes).`);

  return { browser, page };
}

// APERCU : remplit, capture, ne soumet PAS.
export async function apercuRevenu(client, montant, opts = {}) {
  const log = opts.onLog || (() => {});
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const { browser, page } = await ouvrirEtRemplir(client, montant, !!opts.negatif, log);
  try {
    const fichier = resolve(CAPTURES_DIR, `apercu_${client.id}_${Date.now()}.png`);
    await page.screenshot({ path: fichier, fullPage: true });
    log('Aperçu prêt (rien n\'a été envoyé).');
    return { ok: true, capture: fichier };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ENVOI REEL : remplit ET soumet la demande, puis capture la confirmation.
export async function envoyerRevenu(client, montant, opts = {}) {
  const log = opts.onLog || (() => {});
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const { browser, page } = await ouvrirEtRemplir(client, montant, !!opts.negatif, log);
  try {
    log('Envoi de la demande...');
    const valider = page.locator('button:has-text("Valider la demande")').first();
    await valider.click();
    await page.waitForTimeout(1500);

    // Fenetre de confirmation eventuelle
    const confirmer = page.locator('#btnConfirmer, button:has-text("Confirmer")').first();
    if (await confirmer.isVisible().catch(() => false)) {
      log('Confirmation...');
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), confirmer.click()]);
      await page.waitForTimeout(3000);
    }

    const fichier = resolve(CAPTURES_DIR, `envoi_${client.id}_${Date.now()}.png`);
    await page.screenshot({ path: fichier, fullPage: true });
    const texte = await page.evaluate(() => document.body.innerText).catch(() => '');
    const succes = /succès|enregistr|prise en compte|confirm|merci/i.test(texte);
    log(succes ? 'Demande envoyée et confirmée.' : 'Demande envoyée (vérifie la capture).');
    return { ok: true, capture: fichier, succesDetecte: succes };
  } finally {
    await browser.close().catch(() => {});
  }
}
