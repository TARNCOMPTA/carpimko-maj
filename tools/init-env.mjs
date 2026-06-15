// Cree le fichier .env au premier lancement (mode source / Demarrer.bat).
// Genere une MASTER_KEY aleatoire et reprend les valeurs par defaut de .env.example.
// Ne fait rien si .env existe deja (on ne touche jamais a une cle existante).
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(racine, '.env');
const examplePath = resolve(racine, '.env.example');

if (existsSync(envPath)) {
  console.log('.env deja present : conservation de la cle existante.');
  process.exit(0);
}

const cle = crypto.randomBytes(32).toString('hex');

// On part de .env.example pour garder les commentaires/valeurs a jour,
// en remplacant uniquement la ligne MASTER_KEY par la cle generee.
let contenu;
if (existsSync(examplePath)) {
  contenu = readFileSync(examplePath, 'utf8').replace(
    /^MASTER_KEY=.*$/m,
    `MASTER_KEY=${cle}`
  );
} else {
  contenu =
    `PORT=3002\r\n` +
    `MASTER_KEY=${cle}\r\n` +
    `HEADLESS=true\r\n` +
    `CARPIMKO_LOGIN_URL=https://www2.carpimko.com/Comptes/Connexion?ReturnUrl=%2F\r\n` +
    `NAV_TIMEOUT=45000\r\n` +
    `TOUS_DOCUMENTS=false\r\n`;
}

writeFileSync(envPath, contenu);
console.log('Premiere utilisation : .env cree (cle de chiffrement generee).');
