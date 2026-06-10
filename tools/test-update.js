// Test du mecanisme de mise a jour avec un serveur factice (aucune publication reelle).
import http from 'node:http';
import JSZip from 'jszip';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// 1) Archive de maj factice (v9.9.9)
const zip = new JSZip();
zip.file('server.js', '// nouvelle version factice\n');
zip.file('version.json', JSON.stringify({ version: '9.9.9' }));
zip.file('public/marqueur.txt', 'fichier ajoute par la maj');
const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

// 2) Serveur factice
const srv = http.createServer((req, res) => {
  if (req.url === '/manifest.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ version: '9.9.9', notes: 'Version de test', url: 'http://localhost:3099/app.zip' }));
  } else if (req.url === '/app.zip') {
    res.setHeader('Content-Type', 'application/zip');
    res.end(zipBuf);
  } else { res.statusCode = 404; res.end(); }
});
await new Promise((r) => srv.listen(3099, r));

process.env.UPDATE_MANIFEST_URL = 'http://localhost:3099/manifest.json';
const upd = await import('../src/update.js');

// 3) Verification
const chk = await upd.verifierMaj();
console.log('verifierMaj ->', JSON.stringify({ current: chk.current, latest: chk.latest, dispo: chk.updateAvailable }));
console.log('comparerVersions 1.2.0 vs 1.10.0 ->', upd.comparerVersions('1.2.0', '1.10.0'), '(doit etre < 0)');

// 4) Application (on neutralise process.exit pour ne pas tuer le test)
const vraiExit = process.exit;
process.exit = () => {};
await upd.appliquerMaj((m) => console.log('  [maj]', m));
await new Promise((r) => setTimeout(r, 1200));

// 5) Verifications du staging
const base = resolve(process.cwd(), '..');          // = C:\Users\Dell (dev: parent de carpimko-scraper)
const staging = resolve(base, 'app_update');
const flag = resolve(base, 'restart.flag');
console.log('Staging server.js present :', existsSync(resolve(staging, 'server.js')));
console.log('Staging version.json      :', existsSync(resolve(staging, 'version.json')) ? readFileSync(resolve(staging, 'version.json'), 'utf8') : 'ABSENT');
console.log('Staging fichier ajoute    :', existsSync(resolve(staging, 'public', 'marqueur.txt')));
console.log('restart.flag present      :', existsSync(flag), existsSync(flag) ? '(' + readFileSync(flag, 'utf8') + ')' : '');

// 6) Nettoyage
rmSync(staging, { recursive: true, force: true });
rmSync(flag, { force: true });
srv.close();
console.log('Nettoye. Test termine.');
vraiExit(0);
