// Reecrit les chemins des documents dans la base portable + verifie la coherence.
// argv: [dbPath, ancienBase, nouveauBase, envPath]
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const [dbPath, ancien, nouveau, envPath] = process.argv.slice(2);
const db = new DatabaseSync(dbPath);

// Reecriture des chemins
const docs = db.prepare('SELECT id, fichier FROM documents').all();
const upd = db.prepare('UPDATE documents SET fichier = ? WHERE id = ?');
let n = 0;
for (const d of docs) {
  if (d.fichier && d.fichier.startsWith(ancien)) {
    upd.run(nouveau + d.fichier.slice(ancien.length), d.id);
    n++;
  }
}
console.log(`Chemins reecrits : ${n}/${docs.length}`);

// Verification fichiers presents
const apres = db.prepare('SELECT fichier FROM documents').all();
const presents = apres.filter((d) => d.fichier && existsSync(d.fichier)).length;
console.log(`Fichiers presents sur disque : ${presents}/${apres.length}`);

// Verification dechiffrement avec la cle du .env copie
const env = readFileSync(envPath, 'utf8');
const key = (env.match(/MASTER_KEY=([0-9a-f]+)/) || [])[1];
function decrypt(payload, keyHex) {
  const [iv, tag, data] = payload.split(':').map((x) => Buffer.from(x, 'base64'));
  const dc = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  dc.setAuthTag(tag);
  return Buffer.concat([dc.update(data), dc.final()]).toString('utf8');
}
const clients = db.prepare('SELECT nom, login, password_enc FROM clients').all();
console.log(`Clients : ${clients.length}`);
for (const c of clients) {
  let ok = false;
  try { decrypt(c.password_enc, key); ok = true; } catch {}
  console.log(`   ${c.nom} (${c.login}) -> dechiffrement mot de passe : ${ok ? 'OK' : 'ECHEC'}`);
}
db.close();
