// Mise a jour automatique de l'application (cote serveur).
//
// Principe : un "manifeste" est publie sur le web (URL dans .env : UPDATE_MANIFEST_URL).
//   { "version": "1.1.0", "notes": "...", "url": "https://.../app.zip" }
// L'app compare sa version locale (version.json) a celle du manifeste. Si une version
// plus recente existe, l'utilisateur peut l'installer : on telecharge l'archive, on
// l'extrait dans un dossier "app_update" (a cote de "app"), on pose un drapeau
// "restart.flag", puis on quitte. Le lanceur (Carpimko.exe) applique alors la mise a
// jour (copie app_update -> app) et relance. Les donnees (data/, .env, downloads/)
// ne sont jamais touchees.

import JSZip from 'jszip';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DIR = resolve(APP_DIR, '..');            // dossier du package (a cote de app/)
const STAGING = resolve(BASE_DIR, 'app_update');     // code de la nouvelle version
const RESTART_FLAG = resolve(BASE_DIR, 'restart.flag');

export function versionLocale() {
  try {
    const raw = readFileSync(resolve(APP_DIR, 'version.json'), 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Compare deux versions "x.y.z". Renvoie >0 si a>b, <0 si a<b, 0 si egales.
export function comparerVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Verifie s'il existe une mise a jour. Renvoie un objet d'etat (jamais d'exception).
export async function verifierMaj() {
  const url = process.env.UPDATE_MANIFEST_URL;
  const current = versionLocale();
  if (!url) return { configure: false, current, updateAvailable: false };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = (await res.text()).replace(/^﻿/, '');
    const manifest = JSON.parse(txt);
    const latest = manifest.version || '0.0.0';
    return {
      configure: true,
      current,
      latest,
      notes: manifest.notes || '',
      url: manifest.url || '',
      updateAvailable: comparerVersions(latest, current) > 0,
    };
  } catch (e) {
    return { configure: true, current, updateAvailable: false, erreur: e.message };
  }
}

// Telecharge et prepare la mise a jour ; pose le drapeau de redemarrage ; quitte.
export async function appliquerMaj(onLog = () => {}) {
  const etat = await verifierMaj();
  if (!etat.updateAvailable || !etat.url) {
    throw new Error('Aucune mise a jour disponible.');
  }
  onLog(`Telechargement de la version ${etat.latest}...`);
  const res = await fetch(etat.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Telechargement echoue (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());

  const zip = await JSZip.loadAsync(buf);
  // Securite : l'archive doit contenir server.js a sa racine.
  if (!zip.file('server.js')) {
    throw new Error("Archive invalide (server.js absent) - mise a jour annulee.");
  }

  // Extraction dans un dossier de staging propre.
  rmSync(STAGING, { recursive: true, force: true });
  mkdirSync(STAGING, { recursive: true });
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    const dest = resolve(STAGING, entry.name);
    if (entry.dir) {
      mkdirSync(dest, { recursive: true });
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, await entry.async('nodebuffer'));
    }
  }
  onLog('Mise a jour preparee. Redemarrage de l\'application...');

  // Drapeau lu par le lanceur pour appliquer la maj puis relancer.
  writeFileSync(RESTART_FLAG, etat.latest, 'utf8');

  // Laisse le temps a la reponse HTTP de partir, puis quitte pour declencher le relancement.
  setTimeout(() => process.exit(0), 800);
  return { ok: true, version: etat.latest };
}
