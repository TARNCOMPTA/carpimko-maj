// Serveur web local : interface de gestion des clients + lancement du scraping.
import 'dotenv/config';
import express from 'express';
import JSZip from 'jszip';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import {
  listClients, getClient, getClientCredentials, createClient, updateClient,
  deleteClient, listDocuments, listAllDocuments, listRuns, importClients, clientVerrouille,
  getSetting, setSetting,
} from './src/db.js';
import { spawn } from 'node:child_process';
import { scrapeClient } from './src/scraper.js';
import { verifierMaj, appliquerMaj, versionLocale } from './src/update.js';
import { apercuRevenu, envoyerRevenu } from './src/declaration.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

// Etat en memoire des scraping en cours (pour eviter les lancements doubles)
const enCours = new Set();

// ---- Suivi d'avancement (en memoire, lu par l'interface via /api/progress) --
const progression = {
  actif: false,
  total: 0,
  fait: 0,
  courant: null,      // nom du client en cours
  demarre_le: null,
  fini_le: null,
  resultats: [],      // { nom, ok, message, nb_docs }
  logs: [],           // dernieres lignes du scraper
};
function progLog(ligne) {
  progression.logs.push(`${new Date().toLocaleTimeString('fr-FR')}  ${ligne}`);
  if (progression.logs.length > 300) progression.logs.splice(0, progression.logs.length - 300);
}
function demarrerSuivi(total) {
  progression.actif = true;
  progression.total = total;
  progression.fait = 0;
  progression.courant = null;
  progression.resultats = [];
  progression.logs = [];
  progression.demarre_le = new Date().toISOString();
  progression.fini_le = null;
}
function terminerSuivi() {
  progression.actif = false;
  progression.courant = null;
  progression.fini_le = new Date().toISOString();
}

// ---- API Clients ---------------------------------------------------------

app.get('/api/clients', (req, res) => {
  res.json(listClients());
});

app.post('/api/clients', (req, res) => {
  const { nom, login, password, notes, dossier } = req.body || {};
  if (!nom || !login || !password) {
    return res.status(400).json({ error: 'nom, login et password sont requis.' });
  }
  res.status(201).json(createClient({ nom, login, password, notes, dossier }));
});

// Import en masse : body = { clients: [{nom, login, password, notes}, ...] }
app.post('/api/clients/import', (req, res) => {
  const clients = req.body?.clients;
  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ error: 'Aucune ligne a importer.' });
  }
  if (clients.length > 5000) {
    return res.status(400).json({ error: 'Trop de lignes (max 5000).' });
  }
  res.json(importClients(clients));
});

app.put('/api/clients/:id', (req, res) => {
  const c = updateClient(Number(req.params.id), req.body || {});
  if (!c) return res.status(404).json({ error: 'Client introuvable.' });
  res.json(c);
});

app.delete('/api/clients/:id', (req, res) => {
  deleteClient(Number(req.params.id));
  res.status(204).end();
});

app.get('/api/clients/:id/documents', (req, res) => {
  if (!getClient(Number(req.params.id))) return res.status(404).json({ error: 'Client introuvable.' });
  res.json(listDocuments(Number(req.params.id)));
});

// Tous les documents (tous clients), du plus recent au plus ancien (date d'emission).
app.get('/api/documents', (req, res) => {
  res.json(listAllDocuments());
});

// ---- Telechargement d'un document recupere -------------------------------

app.get('/api/documents/:id/file', (req, res) => {
  // On retrouve le doc via la liste (simple, volume faible)
  const all = listClients().flatMap((c) => listDocuments(c.id));
  const doc = all.find((d) => d.id === Number(req.params.id));
  if (!doc || !existsSync(doc.fichier)) return res.status(404).json({ error: 'Fichier introuvable.' });
  res.download(doc.fichier, basename(doc.fichier));
});

// ---- Export ZIP de tous les documents ------------------------------------

// Nettoie un nom pour l'utiliser comme dossier/fichier dans le ZIP.
function nomSur(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'client';
}

// POST { clientIds?: number[] }  -> archive ZIP des PDF, classes par client.
// Sans clientIds (ou liste vide) => tous les clients.
app.post('/api/export', async (req, res) => {
  const demandes = Array.isArray(req.body?.clientIds) ? req.body.clientIds.map(Number) : null;
  const clients = listClients().filter((c) => !demandes || demandes.includes(c.id));
  if (clients.length === 0) return res.status(400).json({ error: 'Aucun client a exporter.' });

  const zip = new JSZip();
  let nbFichiers = 0;
  const nomsUtilises = new Map(); // evite les collisions de noms de dossier

  for (const c of clients) {
    let dossier = nomSur(c.nom);
    if (nomsUtilises.has(dossier)) {
      const n = nomsUtilises.get(dossier) + 1;
      nomsUtilises.set(dossier, n);
      dossier = `${dossier} (${n})`;
    } else {
      nomsUtilises.set(dossier, 1);
    }

    for (const d of listDocuments(c.id)) {
      if (!d.fichier || !existsSync(d.fichier)) continue; // fichier absent -> ignore
      try {
        zip.file(`${dossier}/${basename(d.fichier)}`, readFileSync(d.fichier));
        nbFichiers++;
      } catch {
        /* fichier illisible -> ignore */
      }
    }
  }

  if (nbFichiers === 0) {
    return res.status(404).json({ error: 'Aucun document a exporter (rien de recupere localement).' });
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="export_carpimko_${date}.zip"`);
  res.setHeader('X-Nb-Fichiers', String(nbFichiers));
  res.send(buffer);
});

// ---- Lancement du scraping -----------------------------------------------

async function lancer(clientId, res, opts = {}) {
  const creds = getClientCredentials(clientId);
  if (!creds) return res?.status(404).json({ error: 'Client introuvable.' });
  if (enCours.has(clientId)) {
    return res?.status(409).json({ error: 'Un scraping est deja en cours pour ce client.' });
  }
  enCours.add(clientId);
  res?.json({ started: true, client: creds.nom });
  const suiviLocal = !progression.actif; // pas de reset si un "Tout recuperer" est deja suivi
  if (suiviLocal) demarrerSuivi(1);
  progression.courant = creds.nom;
  try {
    const r = await scrapeClient(creds, { ...opts, onLog: progLog });
    progression.resultats.push({
      nom: creds.nom,
      ok: !!r?.ok,
      message: r?.ok ? `${r.docs?.length ?? 0} nouveau(x)${r.dejaPresents ? ` + ${r.dejaPresents} déjà présent(s)` : ''}` : (r?.error || 'erreur'),
      nb_docs: r?.docs?.length ?? 0,
    });
  } catch (e) {
    // Un crash (navigateur impossible a lancer, etc.) ne doit pas tuer le serveur.
    progLog(`ERREUR : ${e.message}`);
    progression.resultats.push({ nom: creds.nom, ok: false, message: e.message, nb_docs: 0 });
  } finally {
    enCours.delete(clientId);
    if (suiviLocal) { progression.fait = 1; terminerSuivi(); }
  }
}

app.post('/api/clients/:id/scrape', (req, res) => {
  const id = Number(req.params.id);
  // Securite anti-blocage : on refuse une recuperation individuelle d'un client
  // verrouille (dernier echec = mot de passe) sauf si forcage explicite.
  const verrou = clientVerrouille(id);
  if (verrou.verrouille && !req.body?.force) {
    return res.status(423).json({
      error: 'verrou_mdp',
      message:
        'Compte verrouille : la derniere connexion a echoue (mot de passe). ' +
        'Corrige le mot de passe du client, ou force la tentative en connaissance de cause.',
      detail: verrou.message,
    });
  }
  lancer(id, res, { tousDocuments: !!req.body?.tousDocuments, baseFolder: getSetting('destination_folder') });
});

// Lance le scraping pour TOUS les clients, en serie (un seul navigateur a la fois).
// Les clients verrouilles (echec mot de passe non corrige) sont AUTOMATIQUEMENT ignores.
app.post('/api/scrape-all', async (req, res) => {
  const tousDocuments = !!req.body?.tousDocuments;
  const baseFolder = getSetting('destination_folder');
  const clients = listClients();
  const aTraiter = clients.filter((c) => !c.verrouille);
  const ignores = clients.filter((c) => c.verrouille).map((c) => c.nom);
  res.json({ started: true, total: aTraiter.length, ignores });
  demarrerSuivi(aTraiter.length);
  if (ignores.length) progLog(`${ignores.length} client(s) verrouille(s) ignore(s) : ${ignores.join(', ')}`);
  try {
    for (const c of aTraiter) {
      if (enCours.has(c.id)) { progression.fait++; continue; }
      enCours.add(c.id);
      progression.courant = c.nom;
      try {
        const creds = getClientCredentials(c.id);
        if (creds) {
          const r = await scrapeClient(creds, { tousDocuments, baseFolder, onLog: progLog });
          progression.resultats.push({
            nom: c.nom,
            ok: !!r?.ok,
            message: r?.ok ? `${r.docs?.length ?? 0} nouveau(x)${r.dejaPresents ? ` + ${r.dejaPresents} déjà présent(s)` : ''}` : (r?.error || 'erreur'),
            nb_docs: r?.docs?.length ?? 0,
          });
        }
      } catch (e) {
        // Un client qui plante ne doit pas interrompre la serie ni tuer le serveur.
        progLog(`[${c.nom}] ERREUR : ${e.message}`);
        progression.resultats.push({ nom: c.nom, ok: false, message: e.message, nb_docs: 0 });
      } finally {
        enCours.delete(c.id);
        progression.fait++;
      }
    }
  } finally {
    terminerSuivi();
    progLog('Recuperation terminee.');
  }
});

// ---- Suivi d'avancement ----------------------------------------------------

app.get('/api/progress', (req, res) => res.json(progression));

// ---- Reglages : dossier de destination -----------------------------------

app.get('/api/settings', (req, res) => {
  res.json({ destinationFolder: getSetting('destination_folder', '') });
});

app.post('/api/settings', (req, res) => {
  if (typeof req.body?.destinationFolder === 'string') {
    setSetting('destination_folder', req.body.destinationFolder.trim());
  }
  res.json({ destinationFolder: getSetting('destination_folder', '') });
});

// Ouvre une boite de selection de dossier Windows (l'app tourne sur la machine de l'utilisateur).
app.post('/api/pick-folder', (req, res) => {
  const script =
    'Add-Type -AssemblyName System.Windows.Forms;' +
    '$f = New-Object System.Windows.Forms.FolderBrowserDialog;' +
    '$f.Description = "Choisir le dossier de destination des appels de cotisations";' +
    '$f.ShowNewFolderButton = $true;' +
    '$top = New-Object System.Windows.Forms.Form; $top.TopMost = $true; $top.ShowInTaskbar = $false;' +
    'if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }';
  const ps = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], { windowsHide: true });
  let out = '';
  let err = '';
  const minuteur = setTimeout(() => { ps.kill(); }, 120000);
  ps.stdout.on('data', (d) => (out += d));
  ps.stderr.on('data', (d) => (err += d));
  ps.on('close', () => {
    clearTimeout(minuteur);
    const chemin = out.trim();
    if (chemin) res.json({ folder: chemin });
    else res.json({ folder: null, annule: true, erreur: err.trim() || undefined });
  });
  ps.on('error', (e) => { clearTimeout(minuteur); res.status(500).json({ error: e.message }); });
});

// ---- Declaration de revenus estimes --------------------------------------

const REVENU_DIR = resolve(__dirname, 'downloads', '_revenu');

function valideMontant(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 100000000 ? n : null;
}

// Aperçu : remplit le formulaire et renvoie une capture, SANS envoyer.
app.post('/api/clients/:id/revenu/apercu', async (req, res) => {
  const id = Number(req.params.id);
  const creds = getClientCredentials(id);
  if (!creds) return res.status(404).json({ error: 'Client introuvable.' });
  const montant = valideMontant(req.body?.montant);
  if (montant === null) return res.status(400).json({ error: 'Montant invalide (entier, en euros sans centimes).' });
  const verrou = clientVerrouille(id);
  if (verrou.verrouille) return res.status(423).json({ error: 'verrou_mdp', message: 'Compte verrouillé (mot de passe). Corrige-le avant de déclarer.' });
  try {
    const r = await apercuRevenu(creds, montant, { negatif: !!req.body?.negatif });
    res.json({ ok: true, capture: basename(r.capture), montant });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Envoi RÉEL : remplit, soumet et confirme. Renvoie la capture de confirmation.
app.post('/api/clients/:id/revenu/envoyer', async (req, res) => {
  const id = Number(req.params.id);
  const creds = getClientCredentials(id);
  if (!creds) return res.status(404).json({ error: 'Client introuvable.' });
  const montant = valideMontant(req.body?.montant);
  if (montant === null) return res.status(400).json({ error: 'Montant invalide.' });
  const verrou = clientVerrouille(id);
  if (verrou.verrouille) return res.status(423).json({ error: 'verrou_mdp', message: 'Compte verrouillé (mot de passe).' });
  try {
    const r = await envoyerRevenu(creds, montant, { negatif: !!req.body?.negatif });
    res.json({ ok: true, capture: basename(r.capture), succesDetecte: r.succesDetecte, montant });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sert une capture de declaration (image), avec garde anti-traversee de chemin.
app.get('/api/revenu/capture/:file', (req, res) => {
  const f = basename(req.params.file);
  if (!/^[\w.\-]+\.png$/.test(f)) return res.status(400).end();
  const p = resolve(REVENU_DIR, f);
  if (!existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

// ---- Historique ----------------------------------------------------------

app.get('/api/runs', (req, res) => res.json(listRuns()));
app.get('/api/status', (req, res) => res.json({ enCours: [...enCours] }));

// Arret propre du serveur (utilise au relancement pour liberer le port, et par Quitter.bat).
app.post('/api/quit', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 200);
});

// ---- Mise a jour ---------------------------------------------------------

app.get('/api/version', (req, res) => res.json({ version: versionLocale() }));

app.get('/api/update/check', async (req, res) => {
  res.json(await verifierMaj());
});

app.post('/api/update/apply', async (req, res) => {
  try {
    const r = await appliquerMaj();
    res.json(r); // l'application va ensuite se fermer et etre relancee par le lanceur
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PORT = Number(process.env.PORT || 3002);

// Mise a jour OBLIGATOIRE au demarrage : si une version plus recente est publiee,
// on l'installe automatiquement (telechargement + staging + redemarrage applique par
// le lanceur Carpimko.exe ou par Demarrer.bat). Le serveur ne demarre pas tant que la
// mise a jour n'est pas appliquee. Les donnees (data/, .env, downloads/) ne sont jamais touchees.
let majDeclenchee = false;
try {
  const etat = await verifierMaj();
  if (etat.updateAvailable && etat.url) {
    majDeclenchee = true;
    console.log(`\n  Mise a jour ${etat.latest} disponible — installation automatique...`);
    await appliquerMaj((m) => console.log('  ' + m));
    // appliquerMaj programme process.exit(0) : le lanceur applique la maj puis relance.
  }
} catch (e) {
  console.log('  Verification de mise a jour ignoree (' + e.message + ').');
}

if (!majDeclenchee) {
  app.listen(PORT, () => {
    console.log(`\n  CARPIMKO scraper -> http://localhost:${PORT}\n`);
  });
}
