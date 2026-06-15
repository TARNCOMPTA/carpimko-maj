@echo off
setlocal
REM Lanceur du site CARPIMKO. Double-cliquer pour demarrer.
REM Au premier lancement : cree la configuration et installe les dependances.
cd /d "%~dp0"

REM --- Resolution de Node / npm ---
set "NODE_DIR=C:\Program Files\nodejs"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CMD=%NODE_DIR%\npm.cmd"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
if not exist "%NPM_CMD%" set "NPM_CMD=npm"

REM Verifier que Node.js est disponible
"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo ERREUR : Node.js est introuvable.
  echo Installe Node.js depuis https://nodejs.org puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

REM Navigateurs Playwright deplaces hors de AppData (bloque par l'antivirus sur certains postes).
REM On ne force le chemin que si le dossier existe sur ce poste.
if exist "C:\Users\Public\pw-browsers" set "PLAYWRIGHT_BROWSERS_PATH=C:\Users\Public\pw-browsers"

REM --- Premier lancement : configuration .env (cle de chiffrement) ---
if not exist ".env" (
  echo Premiere utilisation : creation de la configuration...
  "%NODE_EXE%" tools\init-env.mjs
)

REM --- Premier lancement : installation des dependances Node ---
if not exist "node_modules" (
  echo Installation des dependances ^(quelques minutes au 1er lancement^)...
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo.
    echo ERREUR : l'installation des dependances a echoue. Verifie ta connexion Internet.
    echo.
    pause
    exit /b 1
  )
)

REM --- Verifier / installer le navigateur Chromium de Playwright ---
"%NODE_EXE%" -e "const{chromium}=require('playwright');const fs=require('fs');process.exit(fs.existsSync(chromium.executablePath())?0:1)" >nul 2>&1
if errorlevel 1 (
  echo Installation du navigateur Chromium ^(Playwright^)...
  call "%NPM_CMD%" exec -- playwright install chromium
)

echo.
echo Demarrage de CARPIMKO en arriere-plan...
echo Le navigateur va s'ouvrir sur http://localhost:3002
echo (Pour arreter le serveur : double-clic sur Quitter.bat)

REM Lance le serveur SANS fenetre visible + ouverture du navigateur, via le script VBS.
REM La mise a jour automatique et la boucle de redemarrage sont gerees dans le VBS.
start "" wscript.exe "%~dp0_serveur-cache.vbs"

REM Cette fenetre se ferme aussitot : l'application tourne en arriere-plan.
exit /b 0
