# CARPIMKO — Récupération des appels de cotisations

Petit site interne qui se connecte à l'espace personnel CARPIMKO de **chaque client avec ses propres identifiants** (pas d'espace tiers déclarant) et télécharge les appels de cotisations, via [Playwright](https://playwright.dev/).

## Fonctionnement

- Interface web locale pour gérer les clients (nom, identifiant, mot de passe).
- Mots de passe **chiffrés** (AES-256-GCM) dans une base SQLite locale — jamais en clair.
- Bouton « Récupérer » par client, ou « Tout récupérer » (en série).
- Les PDF sont rangés dans `downloads/<id>_<nom>/` et consultables depuis l'interface.
- Historique des récupérations (succès/échec + message).

## Installation

```powershell
cd C:\Users\Dell\carpimko-scraper
npm install            # installe les dépendances + le navigateur Chromium (Playwright)
```

Configurer l'environnement :

```powershell
Copy-Item .env.example .env
# Générer une clé de chiffrement et la coller dans .env (MASTER_KEY=...)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Lancement

```powershell
npm start
```

Puis ouvrir <http://localhost:3002>.

## Parcours automatisé (vérifié sur compte réel le 10/06/2026)

1. **Connexion** sur `https://www2.carpimko.com/Comptes/Connexion`
   (type « Affilié », numéro de dossier à 7 chiffres + mot de passe).
2. Ouverture de **« Mes documents & attestations »** (`/migration/MesDocuments`).
3. Lecture du tableau des documents (toutes les pages), **filtrage des appels de cotisations**,
   puis téléchargement des PDF (requête HTTP authentifiée via les cookies de session).
4. Les fichiers sont nommés d'après la **date du document** (`2026-06-07_APPEL_DE_COTISATIONS.pdf`),
   ce qui évite les doublons d'un run à l'autre.

Pour récupérer **tous** les documents (attestations comprises), mettre `TOUS_DOCUMENTS=true` dans `.env`.

### Réglages / dépannage

- `HEADLESS=false` (défaut) : le navigateur s'affiche — pratique pour le 1er run / une éventuelle
  vérification par code email/SMS (60 s sont laissées). `HEADLESS=true` : fonctionnement invisible.
- En cas d'échec, une **capture d'écran** est enregistrée dans `downloads/<client>/_debug_*.png`.
- Si CARPIMKO modifie son portail, les sélecteurs et URL sont en haut de [`src/scraper.js`](src/scraper.js).

## Import en masse de clients

Panneau « Import en masse » sur la page d'accueil :

- **Fichier CSV** (export Excel : *Fichier → Enregistrer sous → CSV*) ou **copier-coller** direct depuis Excel.
- Séparateur détecté automatiquement (`;`, `,` ou tabulation).
- Colonnes reconnues par leur en-tête (dans n'importe quel ordre) : `nom`, `numéro de dossier`
  (alias : identifiant / login / dossier), `mot de passe`, `notes`. Sans en-tête, l'ordre par défaut
  est : nom, numéro de dossier, mot de passe, notes.
- Un **aperçu** affiche les lignes prêtes / incomplètes avant validation.
- Un client dont le **numéro de dossier existe déjà** est **mis à jour** (pas de doublon) ; son mot de
  passe n'est remplacé que si une valeur est fournie dans l'import.
- Bouton « Télécharger un modèle CSV » pour partir d'un exemple.

## Export ZIP des documents

Bouton **« Exporter (ZIP) »** dans l'en-tête :

- Une fenêtre liste les clients avec des **cases à cocher** (sélection « tout cocher / décocher »)
  et affiche le nombre de clients et de documents sélectionnés.
- L'archive ZIP contient les **PDF déjà récupérés localement**, classés dans **un dossier par client**.
- Nom de l'archive : `export_carpimko_AAAA-MM-JJ.zip`.

> L'export reprend les fichiers déjà présents dans `downloads/`. Pour qu'il contienne *tous* les
> types de documents (attestations comprises), il faut au préalable avoir activé `TOUS_DOCUMENTS=true`
> dans `.env` puis relancé une récupération (sinon seuls les appels de cotisations sont présents).

## Sécurité anti-blocage de compte

CARPIMKO **verrouille un compte après plusieurs mots de passe erronés**. Pour éviter de bloquer
les comptes de tes clients :

- Si la dernière connexion d'un client a échoué pour **mot de passe invalide**, il est marqué
  **🔒 verrouillé** dans la liste.
- Les clients verrouillés sont **automatiquement ignorés** par « Tout récupérer » (un message
  indique lesquels).
- Une récupération **individuelle** d'un client verrouillé demande une **confirmation explicite**
  avant de réessayer.
- Le verrou se **lève automatiquement** dès que tu modifies le client (donc dès que tu corriges
  son mot de passe via « Modifier »).

## Sécurité & bonnes pratiques

- Outil destiné à un **usage interne** sur ta machine. Ne pas exposer le port sur Internet.
- La clé `MASTER_KEY` protège les mots de passe : la sauvegarder ailleurs. Si elle change,
  les mots de passe enregistrés deviennent illisibles (il faudra les re-saisir).
- Le dossier `data/` (base SQLite) et `downloads/` sont exclus de Git (`.gitignore`).
- N'utiliser qu'avec les identifiants de clients qui t'ont mandaté pour accéder à leur espace.

## Structure

```
server.js          API Express + service de l'interface
src/db.js          SQLite : clients, documents, historique
src/crypto.js      chiffrement des mots de passe
src/scraper.js     logique Playwright (sélecteurs à ajuster ici)
public/            interface web
downloads/         PDF récupérés (par client)
data/              base SQLite
```
