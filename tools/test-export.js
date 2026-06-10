// Test de l'export ZIP : cree 2 clients + faux PDF, appelle /api/export, verifie le ZIP.
import 'dotenv/config';
import JSZip from 'jszip';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from '../src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DL = resolve(__dirname, '..', 'downloads');
const PDF = Buffer.from('%PDF-1.5\n% faux pdf de test\n', 'utf8');

function fakePdf(clientId, nom, fichierNom) {
  const dir = resolve(DL, `${clientId}_${nom}`.replace(/[^\w.\- ]+/g, '_'));
  mkdirSync(dir, { recursive: true });
  const f = resolve(dir, fichierNom);
  writeFileSync(f, PDF);
  return f;
}

const c1 = db.createClient({ nom: '_EXP A', login: '7100001', password: 'x' });
const c2 = db.createClient({ nom: '_EXP B', login: '7100002', password: 'x' });
db.addDocument(c1.id, { libelle: 'a1', fichier: fakePdf(c1.id, '_EXP A', '2026-06-07_APPEL.pdf'), date_doc: '2026-06-07' });
db.addDocument(c1.id, { libelle: 'a2', fichier: fakePdf(c1.id, '_EXP A', '2025-06-09_APPEL.pdf'), date_doc: '2025-06-09' });
db.addDocument(c2.id, { libelle: 'b1', fichier: fakePdf(c2.id, '_EXP B', '2024-01-01_ATTESTATION.pdf'), date_doc: '2024-01-01' });

const base = 'http://localhost:3052';

// 1) Export d'un seul client
let res = await fetch(`${base}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientIds: [c1.id] }) });
console.log('Export 1 client -> HTTP', res.status, '| X-Nb-Fichiers:', res.headers.get('X-Nb-Fichiers'));
let zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
console.log('  Entrees:', Object.keys(zip.files));

// 2) Export des deux
res = await fetch(`${base}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientIds: [c1.id, c2.id] }) });
console.log('Export 2 clients -> HTTP', res.status, '| X-Nb-Fichiers:', res.headers.get('X-Nb-Fichiers'));
zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
console.log('  Entrees:', Object.keys(zip.files));
const contenu = await zip.file(Object.keys(zip.files)[0]).async('string');
console.log('  1er fichier commence par:', JSON.stringify(contenu.slice(0, 8)));

// Nettoyage
db.deleteClient(c1.id);
db.deleteClient(c2.id);
console.log('Clients de test supprimes.');
