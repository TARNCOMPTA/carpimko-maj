@echo off
REM Lanceur du site CARPIMKO. Double-cliquer pour demarrer.
cd /d "%~dp0"
REM Navigateurs Playwright deplaces hors de AppData (bloque par l'antivirus sur certains postes).
REM On ne force le chemin que si le dossier existe sur ce poste.
if exist "C:\Users\Public\pw-browsers" set "PLAYWRIGHT_BROWSERS_PATH=C:\Users\Public\pw-browsers"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
echo Demarrage du serveur CARPIMKO...
echo Ouvre ton navigateur sur http://localhost:3000
echo (Laisse cette fenetre ouverte. Ferme-la pour arreter le serveur.)
echo.
"%NODE_EXE%" --disable-warning=ExperimentalWarning server.js
pause
