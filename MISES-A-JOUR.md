# Mises à jour automatiques — mode d'emploi

L'application sait se mettre à jour toute seule depuis le web (GitHub). Voici comment ça marche
et ce qu'il faut faire **une seule fois** pour l'activer.

## Le principe

- Le **code** de l'app est publié sur un dépôt GitHub (un petit fichier `version.json` + une archive
  `app.zip` de ~25 Ko).
- Chaque poste, au démarrage, compare sa version à celle publiée. Si une version plus récente existe,
  un bandeau **« Mise à jour disponible — Installer »** apparaît.
- En 1 clic : téléchargement, remplacement du code, redémarrage automatique.
- **Tes données ne sont jamais touchées** (clients, mots de passe, PDF restent en place).

## Configuration unique (à faire une fois)

1. **Crée un compte GitHub** (gratuit) sur https://github.com si tu n'en as pas.
2. **Crée un dépôt** : bouton « New repository » → nomme-le par ex. `carpimko-maj` →
   coche **Public** → « Create repository ». Copie son URL (ex. `https://github.com/toncompte/carpimko-maj.git`).
3. **Lance la configuration** depuis le dossier `carpimko-scraper`, dans PowerShell :

   ```powershell
   .\configurer-github.ps1 -RepoUrl "https://github.com/toncompte/carpimko-maj.git" -Nom "Ton Nom" -Email "toi@exemple.fr"
   ```

   La première fois, Git ouvrira une fenêtre pour te connecter à GitHub (navigateur) — c'est normal,
   une seule fois. Le script publie la version initiale et configure ton package portable pour
   recevoir les mises à jour.

## Publier une mise à jour (à chaque nouvelle version)

Après une modification du code :

```powershell
.\publier-maj.ps1 -Version 1.1.0 -Notes "Ce qui change dans cette version"
```

→ Les postes verront le bandeau de mise à jour au prochain démarrage (ou rafraîchissement).

## Activer la mise à jour sur d'autres postes

Sur un poste qui a reçu le package portable, ajoute cette ligne dans `app\.env` :

```
UPDATE_MANIFEST_URL=https://raw.githubusercontent.com/toncompte/carpimko-maj/main/update/version.json
```

(`configurer-github.ps1` le fait automatiquement pour le package situé sur cette machine.)

## Notes

- Les mises à jour concernent le **code** (server.js, src, public). Si un jour une mise à jour ajoute
  une **dépendance** (nouveau module), il faudra redistribuer le package complet — c'est rare.
- Mode « 1 clic » : rien ne s'installe sans ton accord. Si tu veux du 100 % automatique, dis-le-moi.
