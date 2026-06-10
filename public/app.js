// Frontend : appels a l'API + rendu des tableaux.
const $ = (sel) => document.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// ---- Thème clair / sombre ------------------------------------------------
$('#btn-theme').addEventListener('click', () => {
  const actuel = document.documentElement.getAttribute('data-theme');
  const nouveau = actuel === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nouveau);
  localStorage.setItem('theme', nouveau);
});

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---- Clients -------------------------------------------------------------

async function chargerClients() {
  const clients = await api('/api/clients');
  const tbody = $('#table-clients tbody');
  tbody.innerHTML = '';
  $('#table-clients').hidden = clients.length === 0;
  $('.vide').hidden = clients.length !== 0;

  for (const c of clients) {
    const tr = document.createElement('tr');
    const verrou = c.verrouille
      ? `<span class="badge err lock" title="${esc(c.dernier_message || 'Mot de passe refusé')}">🔒 verrouillé</span>`
      : '';
    tr.innerHTML = `
      <td>${esc(c.nom)} ${verrou}</td>
      <td>${esc(c.login)}</td>
      <td>${c.nb_docs}</td>
      <td>${c.dernier_run ? new Date(c.dernier_run + 'Z').toLocaleString('fr-FR') : '—'}</td>
      <td><div class="row-actions">
        <button class="btn small primary" data-act="scrape" data-id="${c.id}">Récupérer</button>
        <button class="btn small" data-act="docs" data-id="${c.id}" data-nom="${esc(c.nom)}">Documents</button>
        <button class="btn small" data-act="revenu" data-id="${c.id}" data-nom="${esc(c.nom)}">Déclarer revenu</button>
        <button class="btn small" data-act="edit" data-id="${c.id}">Modifier</button>
        <button class="btn small danger" data-act="del" data-id="${c.id}">Suppr.</button>
      </div></td>`;
    tbody.appendChild(tr);
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Option "inclure tous les documents" (memorisee).
const toggleDocs = $('#toggle-tous-docs');
toggleDocs.checked = localStorage.getItem('tousDocuments') === 'true';
toggleDocs.addEventListener('change', () => {
  localStorage.setItem('tousDocuments', toggleDocs.checked ? 'true' : 'false');
});
const tousDocuments = () => toggleDocs.checked;

// Lance une recuperation ; gere le verrou anti-blocage (statut 423).
async function lancerScrape(id, force) {
  const res = await fetch(`/api/clients/${id}/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force, tousDocuments: tousDocuments() }),
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 423 && data.error === 'verrou_mdp') {
    const ok = confirm(
      '⚠️ Compte VERROUILLÉ.\n\n' +
        (data.detail ? `Dernier échec : ${data.detail}\n\n` : '') +
        'La dernière connexion a échoué (mot de passe). CARPIMKO bloque le compte ' +
        'après plusieurs tentatives.\n\n' +
        'Le mieux est de corriger le mot de passe (bouton « Modifier »).\n\n' +
        'Forcer quand même une nouvelle tentative ?'
    );
    if (ok) return lancerScrape(id, true);
    toast('Récupération annulée (compte verrouillé).', 'err');
    return;
  }
  if (!res.ok) {
    toast(data.error || data.message || `Erreur ${res.status}`, 'err');
    return;
  }
  toast("Récupération lancée. Suis l'avancement dans l'historique.", 'ok');
}

// Delegation de clic sur les boutons d'action
$('#table-clients').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const act = btn.dataset.act;

  if (act === 'scrape') {
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await lancerScrape(id, false);
    } finally {
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Récupérer'; rafraichir(); }, 1500);
    }
  } else if (act === 'docs') {
    ouvrirDocs(id, btn.dataset.nom);
  } else if (act === 'revenu') {
    ouvrirRevenu(id, btn.dataset.nom);
  } else if (act === 'edit') {
    remplirFormulaire(id);
  } else if (act === 'del') {
    if (confirm('Supprimer ce client et ses documents enregistrés ?')) {
      await api(`/api/clients/${id}`, { method: 'DELETE' });
      toast('Client supprimé.');
      chargerClients();
    }
  }
});

// ---- Dossier de destination ----------------------------------------------

// Ouvre la boite de selection de dossier Windows ; renvoie le chemin ou null.
async function choisirDossier() {
  const r = await api('/api/pick-folder', { method: 'POST' });
  return r.folder || null;
}

async function chargerDestination() {
  try {
    const s = await api('/api/settings');
    $('#dest-global').value = s.destinationFolder || '';
  } catch { /* ignore */ }
}

$('#pick-global').addEventListener('click', async () => {
  try {
    const f = await choisirDossier();
    if (f) $('#dest-global').value = f;
  } catch (err) { toast(err.message, 'err'); }
});

$('#save-global').addEventListener('click', async () => {
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ destinationFolder: $('#dest-global').value.trim() }) });
    toast('Dossier de destination enregistré.', 'ok');
  } catch (err) { toast(err.message, 'err'); }
});

// Boutons « Parcourir… » dans les formulaires (data-pick = nom du champ)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-pick]');
  if (!btn) return;
  try {
    const f = await choisirDossier();
    if (f) { const champ = form[btn.dataset.pick]; if (champ) champ.value = f; }
  } catch (err) { toast(err.message, 'err'); }
});

// ---- Formulaire ----------------------------------------------------------

const form = $('#form-client');

async function remplirFormulaire(id) {
  const clients = await api('/api/clients');
  const c = clients.find((x) => x.id === id);
  if (!c) return;
  form.id.value = c.id;
  form.nom.value = c.nom;
  form.login.value = c.login;
  form.password.value = '';
  form.notes.value = c.notes || '';
  form.dossier.value = c.dossier || '';
  $('#btn-submit').textContent = 'Mettre à jour';
  $('#btn-cancel').hidden = false;
  form.scrollIntoView({ behavior: 'smooth' });
}

function resetFormulaire() {
  form.reset();
  form.id.value = '';
  $('#btn-submit').textContent = 'Enregistrer';
  $('#btn-cancel').hidden = true;
}

$('#btn-cancel').addEventListener('click', resetFormulaire);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    nom: form.nom.value.trim(),
    login: form.login.value.trim(),
    password: form.password.value,
    notes: form.notes.value.trim(),
    dossier: form.dossier.value.trim(),
  };
  const id = form.id.value;
  try {
    if (id) {
      await api(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Client mis à jour.', 'ok');
    } else {
      if (!payload.password) return toast('Le mot de passe est requis pour un nouveau client.', 'err');
      await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
      toast('Client ajouté.', 'ok');
    }
    resetFormulaire();
    chargerClients();
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ---- Import en masse -----------------------------------------------------

// Parse une ligne CSV en tenant compte des guillemets.
function parseLigne(ligne, sep) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < ligne.length; i++) {
    const ch = ligne[i];
    if (inQuotes) {
      if (ch === '"' && ligne[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Aliases d'en-tetes -> champ interne
const COLS = {
  nom: ['nom', 'client', 'nom du client', 'nom client', 'name'],
  login: ['login', 'identifiant', 'numero', 'numéro', 'numero de dossier', 'numéro de dossier', 'n° dossier', 'no dossier', 'dossier', 'numero dossier'],
  password: ['password', 'mot de passe', 'motdepasse', 'mdp', 'pass', 'passe'],
  notes: ['notes', 'note', 'remarque', 'remarques', 'commentaire'],
};
function trouverChamp(entete) {
  const e = entete.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const [champ, alias] of Object.entries(COLS)) {
    if (alias.includes(e)) return champ;
  }
  return null;
}

// Transforme le texte CSV/colle en tableau d'objets {nom, login, password, notes}.
function parseImport(texte) {
  const lignes = texte.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (lignes.length === 0) return { rows: [], sep: ';' };
  // Detection du separateur sur la 1ere ligne : tab, ; puis ,
  const sep = lignes[0].includes('\t') ? '\t' : lignes[0].includes(';') ? ';' : ',';

  const premiere = parseLigne(lignes[0], sep);
  const mapping = premiere.map(trouverChamp);
  const aEntete = mapping.some((m) => m !== null);

  let ordre, debut;
  if (aEntete) {
    ordre = mapping;
    debut = 1;
  } else {
    ordre = ['nom', 'login', 'password', 'notes']; // ordre par defaut
    debut = 0;
  }

  const rows = [];
  for (let i = debut; i < lignes.length; i++) {
    const champs = parseLigne(lignes[i], sep);
    const obj = { nom: '', login: '', password: '', notes: '' };
    champs.forEach((val, idx) => {
      const champ = ordre[idx];
      if (champ) obj[champ] = val;
    });
    rows.push(obj);
  }
  return { rows, sep, aEntete };
}

const importText = $('#import-text');
const importPreview = $('#import-preview');
const btnImport = $('#btn-import');
let lignesAImporter = [];

function rafraichirApercu() {
  const texte = importText.value;
  if (!texte.trim()) {
    importPreview.hidden = true;
    btnImport.disabled = true;
    lignesAImporter = [];
    return;
  }
  const { rows } = parseImport(texte);
  lignesAImporter = rows;
  const valides = rows.filter((r) => r.nom && r.login);
  const invalides = rows.length - valides.length;

  let html = `<div class="resume">${rows.length} ligne(s) détectée(s) — ${valides.length} prête(s)`;
  if (invalides) html += `, <span class="ko">${invalides} incomplète(s) (nom + n° dossier requis)</span>`;
  html += '</div>';
  html += '<table><thead><tr><th>Nom</th><th>N° dossier</th><th>Mot de passe</th><th>Notes</th></tr></thead><tbody>';
  for (const r of rows.slice(0, 50)) {
    const ok = r.nom && r.login;
    html += `<tr class="${ok ? '' : 'ko'}">
      <td>${esc(r.nom)}</td><td>${esc(r.login)}</td>
      <td>${r.password ? '••••••' : '<span class="ko">(vide)</span>'}</td>
      <td>${esc(r.notes)}</td></tr>`;
  }
  html += '</tbody></table>';
  if (rows.length > 50) html += `<p class="aide">… et ${rows.length - 50} ligne(s) de plus.</p>`;
  importPreview.innerHTML = html;
  importPreview.hidden = false;
  btnImport.disabled = valides.length === 0;
}

importText.addEventListener('input', rafraichirApercu);

$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { importText.value = reader.result; rafraichirApercu(); };
  reader.readAsText(file, 'utf-8');
});

$('#btn-import-reset').addEventListener('click', () => {
  importText.value = '';
  $('#import-file').value = '';
  rafraichirApercu();
});

btnImport.addEventListener('click', async () => {
  const clients = lignesAImporter.filter((r) => r.nom && r.login);
  if (clients.length === 0) return;
  btnImport.disabled = true;
  btnImport.textContent = 'Import en cours…';
  try {
    const r = await api('/api/clients/import', { method: 'POST', body: JSON.stringify({ clients }) });
    let msg = `${r.crees} créé(s), ${r.maj} mis à jour`;
    if (r.erreurs?.length) msg += `, ${r.erreurs.length} erreur(s)`;
    toast(msg, r.erreurs?.length ? 'err' : 'ok');
    if (r.erreurs?.length) {
      importPreview.innerHTML = '<div class="resume ko">Lignes en erreur :</div>' +
        r.erreurs.map((e) => `<div class="ko">Ligne ${e.ligne} (${esc(e.valeur || '')}) : ${esc(e.raison)}</div>`).join('');
    } else {
      importText.value = '';
      $('#import-file').value = '';
      importPreview.hidden = true;
    }
    chargerClients();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btnImport.textContent = 'Importer';
    btnImport.disabled = false;
  }
});

// Modele CSV telechargeable
$('#lien-modele').addEventListener('click', (e) => {
  e.preventDefault();
  const contenu = 'nom;numéro de dossier;mot de passe;notes\n' +
    'DUPONT Marie;1234567;motdepasse123;kinésithérapeute\n' +
    'MARTIN Paul;7654321;autreMdp456;infirmier\n';
  const blob = new Blob(['﻿' + contenu], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modele_import_clients.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// ---- Export ZIP ----------------------------------------------------------

const dialogExport = $('#dialog-export');

async function ouvrirExport() {
  const clients = await api('/api/clients');
  const liste = $('#export-liste');
  if (clients.length === 0) {
    toast('Aucun client à exporter.', 'err');
    return;
  }
  liste.innerHTML = clients
    .map(
      (c) => `<label>
        <input type="checkbox" class="export-client" value="${c.id}" ${c.nb_docs > 0 ? 'checked' : ''} />
        <span>${esc(c.nom)}</span>
        <span class="meta">${c.nb_docs} doc(s)</span>
      </label>`
    )
    .join('');
  majCompteExport();
  dialogExport.showModal();
}

function majCompteExport() {
  const coches = [...document.querySelectorAll('.export-client:checked')];
  const total = coches.reduce((s, el) => s + Number(el.closest('label').querySelector('.meta').textContent.match(/\d+/)?.[0] || 0), 0);
  $('#export-compte').textContent = `${coches.length} client(s), ${total} document(s)`;
  $('#btn-export-go').disabled = coches.length === 0;
}

$('#btn-export').addEventListener('click', ouvrirExport);
$('#btn-export-annuler').addEventListener('click', () => dialogExport.close());

$('#export-tout').addEventListener('change', (e) => {
  document.querySelectorAll('.export-client').forEach((cb) => { cb.checked = e.target.checked; });
  majCompteExport();
});
$('#export-liste').addEventListener('change', majCompteExport);

$('#btn-export-go').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.export-client:checked')].map((el) => Number(el.value));
  if (ids.length === 0) return;
  const btn = $('#btn-export-go');
  btn.disabled = true;
  btn.textContent = 'Création du ZIP…';
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientIds: ids }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Erreur ${res.status}`);
    }
    const nb = res.headers.get('X-Nb-Fichiers') || '?';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export_carpimko_${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Export téléchargé (${nb} document(s)).`, 'ok');
    dialogExport.close();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Télécharger le ZIP';
  }
});

// ---- Déclaration de revenu estimé ----------------------------------------

const dialogRevenu = $('#dialog-revenu');
let revenuClient = null;

function ouvrirRevenu(id, nom) {
  revenuClient = { id, nom };
  $('#revenu-titre').textContent = `Déclarer un revenu estimé — ${nom}`;
  $('#revenu-montant').value = '';
  $('#revenu-negatif').checked = false;
  $('#revenu-zone-apercu').hidden = true;
  $('#revenu-resultat').hidden = true;
  $('#revenu-resultat').innerHTML = '';
  $('#revenu-img').src = '';
  dialogRevenu.showModal();
}

$('#revenu-fermer').addEventListener('click', () => dialogRevenu.close());

$('#revenu-apercu').addEventListener('click', async () => {
  const montant = $('#revenu-montant').value.trim();
  if (montant === '' || Number(montant) < 0 || !Number.isInteger(Number(montant))) {
    return toast('Saisis un montant entier (euros, sans centimes).', 'err');
  }
  const btn = $('#revenu-apercu');
  btn.disabled = true; btn.textContent = 'Génération…';
  try {
    const r = await fetch(`/api/clients/${revenuClient.id}/revenu/apercu`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ montant: Number(montant), negatif: $('#revenu-negatif').checked }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || `Erreur ${r.status}`);
    $('#revenu-img').src = `/api/revenu/capture/${data.capture}?t=${Date.now()}`;
    $('#revenu-zone-apercu').hidden = false;
    $('#revenu-resultat').hidden = true;
    toast('Aperçu généré (rien envoyé).', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Générer l\'aperçu';
  }
});

$('#revenu-envoyer').addEventListener('click', async () => {
  const montant = Number($('#revenu-montant').value.trim());
  const negatif = $('#revenu-negatif').checked;
  if (!confirm(
    `⚠️ ENVOI RÉEL à CARPIMKO\n\nClient : ${revenuClient.nom}\nRevenu estimé déclaré : ${montant} €` +
    (negatif ? ' (négatifs)' : '') +
    '\n\nCela modifiera les cotisations appelées du client. Confirmer l\'envoi ?'
  )) return;
  const btn = $('#revenu-envoyer');
  btn.disabled = true; btn.textContent = 'Envoi en cours…';
  try {
    const r = await fetch(`/api/clients/${revenuClient.id}/revenu/envoyer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ montant, negatif }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || `Erreur ${r.status}`);
    $('#revenu-zone-apercu').hidden = true;
    const cls = data.succesDetecte ? 'revenu-ok' : 'revenu-warn';
    const msg = data.succesDetecte ? '✅ Demande envoyée et confirmée par CARPIMKO.' : '⚠️ Demande envoyée — vérifie la capture de confirmation ci-dessous.';
    $('#revenu-resultat').innerHTML = `<p class="${cls}">${msg}</p><img src="/api/revenu/capture/${data.capture}?t=${Date.now()}" alt="Confirmation" />`;
    $('#revenu-resultat').hidden = false;
    toast('Déclaration envoyée.', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = '✓ Confirmer et envoyer à CARPIMKO';
  }
});

// ---- Documents -----------------------------------------------------------

async function ouvrirDocs(id, nom) {
  const docs = await api(`/api/clients/${id}/documents`);
  $('#docs-titre').textContent = `Documents — ${nom}`;
  const ul = $('#docs-liste');
  ul.innerHTML = '';
  $('.vide-docs').hidden = docs.length !== 0;
  for (const d of docs) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>
        <span class="lib">${esc(d.libelle || d.fichier.split(/[\\/]/).pop())}</span><br/>
        <span class="date">${new Date(d.recupere_le + 'Z').toLocaleString('fr-FR')}</span>
      </span>
      <a class="btn small primary" href="/api/documents/${d.id}/file">Télécharger</a>`;
    ul.appendChild(li);
  }
  $('#dialog-docs').showModal();
}

// ---- Historique ----------------------------------------------------------

async function chargerRuns() {
  const runs = await api('/api/runs');
  const tbody = $('#table-runs tbody');
  tbody.innerHTML = '';
  for (const r of runs) {
    const cls = r.statut === 'succes' ? 'ok' : 'err';
    const libelle = { succes: 'succès', echec: 'échec', echec_mdp: '🔒 mot de passe' }[r.statut] || r.statut;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(r.lance_le + 'Z').toLocaleString('fr-FR')}</td>
      <td>${esc(r.client_nom || '—')}</td>
      <td><span class="badge ${cls}">${libelle}</span></td>
      <td>${r.nb_docs}</td>
      <td>${esc(r.message || '')}</td>`;
    tbody.appendChild(tr);
  }
}

// ---- Tout récupérer ------------------------------------------------------

$('#btn-scrape-all').addEventListener('click', async (e) => {
  if (!confirm('Lancer la récupération pour TOUS les clients ? (traitement en série)')) return;
  e.target.disabled = true;
  try {
    const r = await api('/api/scrape-all', { method: 'POST', body: JSON.stringify({ tousDocuments: tousDocuments() }) });
    let msg = `Récupération lancée pour ${r.total} client(s).`;
    if (r.ignores?.length) {
      msg += ` ${r.ignores.length} client(s) verrouillé(s) ignoré(s) : ${r.ignores.join(', ')}.`;
    }
    toast(msg, r.ignores?.length ? 'err' : 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setTimeout(() => { e.target.disabled = false; }, 2000);
  }
});

// ---- Rafraichissement ----------------------------------------------------

async function rafraichir() {
  await Promise.all([chargerClients(), chargerRuns()]);
}

// ---- Mise a jour ---------------------------------------------------------

async function verifierMaj() {
  try {
    const v = await api('/api/version');
    $('#pied-version').textContent = 'v' + v.version;
  } catch { /* ignore */ }
  try {
    const m = await api('/api/update/check');
    if (m.updateAvailable) {
      $('#maj-texte').textContent =
        `Mise à jour disponible : v${m.latest}` + (m.notes ? ` — ${m.notes}` : '');
      $('#maj-banner').hidden = false;
    }
  } catch { /* hors-ligne ou non configure : on ignore */ }
}

$('#maj-plustard').addEventListener('click', () => { $('#maj-banner').hidden = true; });

$('#maj-install').addEventListener('click', async () => {
  const btn = $('#maj-install');
  btn.disabled = true;
  btn.textContent = 'Installation…';
  try {
    await api('/api/update/apply', { method: 'POST' });
    $('#maj-texte').textContent = 'Mise à jour en cours, redémarrage de l\'application…';
    $('#maj-plustard').hidden = true;
    attendreRedemarrage();
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false;
    btn.textContent = 'Installer';
  }
});

// Attend que le serveur soit ressuscite apres redemarrage, puis recharge la page.
function attendreRedemarrage() {
  let essais = 0;
  const timer = setInterval(async () => {
    essais++;
    try {
      const r = await fetch('/api/version', { cache: 'no-store' });
      if (r.ok) { clearInterval(timer); location.reload(); }
    } catch { /* serveur pas encore repondu */ }
    if (essais > 60) { clearInterval(timer); toast('Le redémarrage prend du temps — recharge la page manuellement.', 'err'); }
  }, 1500);
}

rafraichir();
verifierMaj();
chargerDestination();
setInterval(chargerRuns, 5000); // suit l'avancement des runs
