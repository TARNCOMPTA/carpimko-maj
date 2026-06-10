// Scraper Playwright de l'espace personnel CARPIMKO (espace "Affilie").
//
// Parcours verifie le 10/06/2026 sur un compte reel :
//   1. Connexion  : https://www2.carpimko.com/Comptes/Connexion
//        - radio "TypeUtilisateur" (Affilie) + #Login (n° dossier) + #MotDePasse
//        - submit dans le formulaire #connexionForm
//   2. Documents  : https://www2.carpimko.com/migration/MesDocuments?tab=docs
//        - tableau (Date | Nom du document) ; chaque ligne a un lien de
//          telechargement (/MesDemandes/download?token=...) et un lien d'apercu
//          (/MesDemandes/viewDocument?token=...&fileName=...).
//   3. On filtre les "appels de cotisations" et on telecharge les PDF.
//
// Les PDF sont nommes d'apres la DATE du document (stable) -> pas de doublon
// d'un run a l'autre.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDocument, addRun } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOWNLOADS_DIR = resolve(__dirname, '..', 'downloads');

const LOGIN_URL =
  process.env.CARPIMKO_LOGIN_URL || 'https://www2.carpimko.com/Comptes/Connexion?ReturnUrl=%2F';
const DOCUMENTS_URL = 'https://www2.carpimko.com/migration/MesDocuments?tab=docs';

// Reconnaissance d'un "appel de cotisations" (nom du document, insensible a la casse/accents)
const REGEX_APPEL = /appel\s*de\s*cotisation/i;

// Valeur par defaut (config .env) : recuperer tous les documents ou seulement
// les appels. Peut etre surchargee a chaque appel via opts.tousDocuments.
const TOUS_DOCUMENTS_DEFAUT = String(process.env.TOUS_DOCUMENTS ?? 'false').toLowerCase() === 'true';

function sanitize(name) {
  return String(name).replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').trim().slice(0, 120);
}

// "07/06/2026" -> "2026-06-07" (pour un nom de fichier triable)
function dateIso(fr) {
  const m = String(fr).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : 'sans-date';
}

// L'echec d'ecriture de l'historique ne doit jamais faire planter un run.
function addRunSafe(clientId, run) {
  try {
    addRun(clientId, run);
  } catch (e) {
    console.warn(`(historique non enregistre pour client ${clientId} : ${e.message})`);
  }
}

async function fermerCookies(page) {
  for (const sel of ['#tarteaucitronAllDenied2', '#tarteaucitronPersonalize2', 'button:has-text("Tout refuser")', 'button:has-text("Tout accepter")']) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {});
      return;
    }
  }
}

// Extrait la liste des documents (date, nom, lien de telechargement) de la page courante.
async function extraireDocuments(page) {
  return page.$$eval('table tr', (rows) =>
    rows
      .map((tr) => {
        const dl = tr.querySelector('a[href*="download"]');
        const view = tr.querySelector('a[href*="viewDocument"]');
        if (!dl && !view) return null;
        const cells = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim());
        let fileName = '';
        if (view) {
          try {
            fileName = new URL(view.href).searchParams.get('fileName') || '';
          } catch {
            /* ignore */
          }
        }
        return {
          date: cells[0] || '',
          nom: cells[1] || (dl ? dl.innerText.trim() : ''),
          downloadHref: dl ? dl.href : view ? view.href : '',
          fileName,
        };
      })
      .filter(Boolean)
  );
}

/**
 * Recupere les appels de cotisations d'un client (espace "Affilie").
 * @param {{id:number, nom:string, login:string, password:string}} client
 * @param {{onLog?: (msg:string)=>void, tousDocuments?: boolean, baseFolder?: string}} [opts]
 */
export async function scrapeClient(client, opts = {}) {
  const log = (m) => {
    const line = `[${client.nom}] ${m}`;
    console.log(line);
    opts.onLog?.(line);
  };

  const headless = String(process.env.HEADLESS ?? 'false').toLowerCase() !== 'false';
  const navTimeout = Number(process.env.NAV_TIMEOUT ?? 45000);
  // Tous les documents, ou seulement les appels de cotisations (defaut).
  const tousDocuments = opts.tousDocuments ?? TOUS_DOCUMENTS_DEFAUT;

  // Dossier de destination, par ordre de priorite :
  //   1. dossier propre au client (client.dossier)
  //   2. dossier global choisi (opts.baseFolder) -> sous-dossier au nom du client
  //   3. dossier par defaut de l'application (downloads/<id>_<nom>)
  let clientDir;
  if (client.dossier && client.dossier.trim()) {
    clientDir = client.dossier.trim();
  } else if (opts.baseFolder && opts.baseFolder.trim()) {
    clientDir = resolve(opts.baseFolder.trim(), sanitize(client.nom));
  } else {
    clientDir = resolve(DOWNLOADS_DIR, sanitize(`${client.id}_${client.nom}`));
  }
  mkdirSync(clientDir, { recursive: true });
  log(`Destination : ${clientDir}`);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(navTimeout);

  const docsRecuperes = [];

  try {
    // ---- 1. Connexion ----
    log('Ouverture de la page de connexion');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await fermerCookies(page);

    const radioAffilie = page.locator('input[name="TypeUtilisateur"]').first();
    await radioAffilie.waitFor({ state: 'visible' });
    await radioAffilie.check().catch(async () => {
      const id = await radioAffilie.getAttribute('id');
      if (id) await page.locator(`label[for="${id}"]`).click();
    });

    log('Saisie du numero de dossier et du mot de passe');
    await page.locator('#Login').fill(client.login);
    await page.locator('#MotDePasse').fill(client.password);

    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('#connexionForm button[type="submit"]').click(),
    ]);
    await page.waitForTimeout(2000);

    if (/Comptes\/Connexion/i.test(page.url())) {
      const erreur = await page
        .locator('.validation-summary-errors, .field-validation-error, .alert-danger')
        .first()
        .innerText()
        .catch(() => '');
      const detail = erreur ? erreur.trim().replace(/\s+/g, ' ') : '(identifiants incorrects ?)';
      const e = new Error(`Connexion refusee : ${detail}`);
      // Echec d'authentification -> declenche le verrou anti-blocage de compte.
      e.kind = 'mdp';
      throw e;
    }
    log('Connecte.');

    // Verification supplementaire eventuelle (code email/SMS) : laisser la main en mode visible
    if (!headless) await page.waitForTimeout(1500);

    // ---- 2. Page des documents ----
    log('Ouverture de la page « Mes documents & attestations »');
    await page.goto(DOCUMENTS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // Collecte sur toutes les pages du tableau (pagination « ‹ 1 2 › »)
    const tous = [];
    const vus = new Set();
    for (let p = 0; p < 30; p++) {
      const lot = await extraireDocuments(page);
      for (const d of lot) {
        const cle = d.fileName || `${d.date}|${d.nom}`;
        if (!vus.has(cle)) {
          vus.add(cle);
          tous.push(d);
        }
      }
      // Page suivante si disponible
      const suivant = page.locator('a[aria-label="Next"], a:has-text("›"), li:not(.disabled) > a[rel="next"]').first();
      if (await suivant.isVisible().catch(() => false)) {
        const avant = page.url() + (await page.locator('table').first().innerText().catch(() => ''));
        await suivant.click().catch(() => {});
        await page.waitForTimeout(1500);
        const apres = page.url() + (await page.locator('table').first().innerText().catch(() => ''));
        if (avant === apres) break; // plus de changement -> fin
      } else {
        break;
      }
    }

    log(`${tous.length} document(s) liste(s) au total.`);

    // ---- 3. Filtrage appels de cotisations (ou tous les documents) ----
    const cibles = tousDocuments
      ? tous
      : tous.filter((d) => REGEX_APPEL.test(d.nom) || REGEX_APPEL.test(d.fileName.replace(/_/g, ' ')));

    if (cibles.length === 0) {
      log(tousDocuments ? 'Aucun document trouve.' : 'Aucun appel de cotisations trouve.');
      const shot = resolve(clientDir, `_page_documents_${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    } else {
      const motDoc = tousDocuments ? 'document(s)' : 'appel(s) de cotisations';
      log(`${cibles.length} ${motDoc} a telecharger.`);
      for (const d of cibles) {
        if (!d.downloadHref) continue;
        const base = `${dateIso(d.date)}_${sanitize(d.nom || 'document')}`;
        const dest = resolve(clientDir, `${base}.pdf`);
        try {
          // Telechargement via requete HTTP authentifiee (cookies de session)
          const resp = await context.request.get(d.downloadHref, { timeout: navTimeout });
          if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`);
          const buf = await resp.body();
          // Garde-fou : un PDF commence par "%PDF"
          if (buf.length < 100 || buf.subarray(0, 4).toString() !== '%PDF') {
            throw new Error('reponse non-PDF (lien expire ou page HTML)');
          }
          writeFileSync(dest, buf);
          addDocument(client.id, { libelle: `${d.date} — ${d.nom}`, fichier: dest, date_doc: dateIso(d.date) });
          docsRecuperes.push({ libelle: d.nom, fichier: dest });
          log(`OK : ${base}.pdf (${Math.round(buf.length / 1024)} Ko)`);
        } catch (e) {
          log(`Echec "${d.nom}" (${d.date}) : ${e.message}`);
        }
      }
    }

    addRunSafe(client.id, {
      statut: docsRecuperes.length > 0 || cibles.length === 0 ? 'succes' : 'echec',
      message: `${docsRecuperes.length} ${tousDocuments ? 'document(s)' : 'appel(s) de cotisations'} recupere(s) sur ${cibles.length} detecte(s)`,
      nb_docs: docsRecuperes.length,
    });
    log(`Termine : ${docsRecuperes.length} document(s) telecharge(s).`);
    return { ok: true, docs: docsRecuperes };
  } catch (err) {
    const shot = resolve(clientDir, `_debug_${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    // 'echec_mdp' = authentification refusee -> verrou anti-blocage ; 'echec' = autre cause.
    addRunSafe(client.id, {
      statut: err.kind === 'mdp' ? 'echec_mdp' : 'echec',
      message: err.message,
      nb_docs: docsRecuperes.length,
    });
    log(`ERREUR : ${err.message} (capture : ${shot})`);
    return { ok: false, error: err.message, docs: docsRecuperes };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
