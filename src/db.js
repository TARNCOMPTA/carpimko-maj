// Base SQLite : un client = un identifiant CARPIMKO (login + mot de passe chiffre).
// Stocke aussi l'historique des recuperations (runs) et les documents recuperes.

// Utilise le module SQLite natif de Node (node:sqlite) : aucune compilation
// native requise. L'API (prepare/run/get/all/exec) est compatible avec ce code.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from './crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(resolve(DATA_DIR, 'carpimko.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nom          TEXT NOT NULL,
    login        TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    notes        TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    libelle     TEXT,
    fichier     TEXT,
    recupere_le TEXT DEFAULT (datetime('now')),
    UNIQUE(client_id, fichier)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    statut     TEXT NOT NULL,
    message    TEXT,
    nb_docs    INTEGER DEFAULT 0,
    lance_le   TEXT DEFAULT (datetime('now'))
  );
`);

// ---- Migration : colonne date_doc (date du document, format ISO YYYY-MM-DD) --
// Permet de classer les documents par date du document (et non par date de
// telechargement). Backfill des lignes existantes a partir du nom de fichier
// (les PDF sont nommes "YYYY-MM-DD_...").
const colonnes = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
if (!colonnes.includes('date_doc')) {
  db.exec('ALTER TABLE documents ADD COLUMN date_doc TEXT');
  // Backfill : extraire la date ISO du nom de fichier (les PDF sont nommes "YYYY-MM-DD_...").
  const rows = db.prepare('SELECT id, fichier FROM documents').all();
  const maj = db.prepare('UPDATE documents SET date_doc = ? WHERE id = ?');
  for (const r of rows) {
    const base = String(r.fichier).split(/[\\/]/).pop() || '';
    const m = base.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) maj.run(m[1], r.id);
  }
}

// ---- Clients -------------------------------------------------------------

export function listClients() {
  const rows = db.prepare(`
    SELECT c.id, c.nom, c.login, c.notes, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id) AS nb_docs,
           (SELECT lance_le FROM runs r WHERE r.client_id = c.id ORDER BY r.lance_le DESC, r.id DESC LIMIT 1) AS dernier_run,
           (SELECT statut   FROM runs r WHERE r.client_id = c.id ORDER BY r.lance_le DESC, r.id DESC LIMIT 1) AS dernier_statut,
           (SELECT message  FROM runs r WHERE r.client_id = c.id ORDER BY r.lance_le DESC, r.id DESC LIMIT 1) AS dernier_message
    FROM clients c
    ORDER BY c.nom COLLATE NOCASE
  `).all();
  // Verrou anti-blocage : actif si le dernier run a echoue pour mot de passe ET
  // que le client n'a pas ete modifie depuis (corriger/editer le client le leve).
  for (const r of rows) {
    r.verrouille =
      r.dernier_statut === 'echec_mdp' && (!r.dernier_run || r.updated_at <= r.dernier_run);
  }
  return rows;
}

// Renvoie l'etat de verrou d'un client (usage serveur).
export function clientVerrouille(id) {
  const c = listClients().find((x) => x.id === Number(id));
  return c ? { verrouille: !!c.verrouille, message: c.dernier_message } : { verrouille: false };
}

export function getClient(id) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

// Renvoie le client avec le mot de passe dechiffre (usage interne scraper).
export function getClientCredentials(id) {
  const c = getClient(id);
  if (!c) return null;
  return { id: c.id, nom: c.nom, login: c.login, password: decrypt(c.password_enc) };
}

export function createClient({ nom, login, password, notes }) {
  const info = db.prepare(`
    INSERT INTO clients (nom, login, password_enc, notes)
    VALUES (?, ?, ?, ?)
  `).run(nom, login, encrypt(password), notes ?? null);
  return getClient(info.lastInsertRowid);
}

export function updateClient(id, { nom, login, password, notes }) {
  const c = getClient(id);
  if (!c) return null;
  const password_enc = password ? encrypt(password) : c.password_enc;
  db.prepare(`
    UPDATE clients
    SET nom = ?, login = ?, password_enc = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(nom ?? c.nom, login ?? c.login, password_enc, notes ?? c.notes, id);
  return getClient(id);
}

export function deleteClient(id) {
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
}

export function getClientByLogin(login) {
  return db.prepare('SELECT * FROM clients WHERE login = ?').get(String(login).trim());
}

/**
 * Import en masse. Pour chaque ligne : cree le client, ou met a jour celui qui a
 * deja le meme numero de dossier (login). Renvoie un bilan detaille.
 * @param {Array<{nom?:string, login?:string, password?:string, notes?:string}>} rows
 */
export function importClients(rows) {
  const bilan = { crees: 0, maj: 0, ignores: 0, erreurs: [] };
  rows.forEach((r, i) => {
    const ligne = i + 1;
    const nom = (r.nom ?? '').toString().trim();
    const login = (r.login ?? '').toString().trim();
    const password = (r.password ?? '').toString();
    const notes = (r.notes ?? '').toString().trim() || null;

    if (!nom && !login) {
      bilan.ignores++;
      return; // ligne vide
    }
    if (!nom || !login) {
      bilan.erreurs.push({ ligne, raison: 'nom et numero de dossier obligatoires', valeur: nom || login });
      return;
    }

    const existant = getClientByLogin(login);
    try {
      if (existant) {
        // Met a jour ; ne remplace le mot de passe que s'il est fourni dans l'import.
        updateClient(existant.id, { nom, login, password: password || undefined, notes });
        bilan.maj++;
      } else {
        if (!password) {
          bilan.erreurs.push({ ligne, raison: 'mot de passe manquant pour un nouveau client', valeur: nom });
          return;
        }
        createClient({ nom, login, password, notes });
        bilan.crees++;
      }
    } catch (e) {
      bilan.erreurs.push({ ligne, raison: e.message, valeur: nom });
    }
  });
  return bilan;
}

// ---- Documents -----------------------------------------------------------

export function addDocument(client_id, { libelle, fichier, date_doc }) {
  db.prepare(`
    INSERT OR IGNORE INTO documents (client_id, libelle, fichier, date_doc)
    VALUES (?, ?, ?, ?)
  `).run(client_id, libelle ?? null, fichier, date_doc ?? null);
}

export function listDocuments(client_id) {
  // Classement du plus recent au plus vieux selon la DATE DU DOCUMENT.
  // Les documents sans date connue passent en dernier ; on departage par
  // date de telechargement.
  return db.prepare(`
    SELECT * FROM documents
    WHERE client_id = ?
    ORDER BY (date_doc IS NULL), date_doc DESC, recupere_le DESC, id DESC
  `).all(client_id);
}

// ---- Runs ----------------------------------------------------------------

export function addRun(client_id, { statut, message, nb_docs }) {
  db.prepare(`
    INSERT INTO runs (client_id, statut, message, nb_docs)
    VALUES (?, ?, ?, ?)
  `).run(client_id, statut, message ?? null, nb_docs ?? 0);
}

export function listRuns(limit = 50) {
  return db.prepare(`
    SELECT r.*, c.nom AS client_nom
    FROM runs r LEFT JOIN clients c ON c.id = r.client_id
    ORDER BY r.lance_le DESC, r.id DESC
    LIMIT ?
  `).all(limit);
}

export default db;
