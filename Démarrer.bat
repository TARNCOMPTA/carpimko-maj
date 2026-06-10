@echo off
REM Lanceur du site CARPIMKO. Double-cliquer pour demarrer.
cd /d "%~dp0"
set "PATH=%PATH%;C:\Users\Dell\nodejs"
echo Demarrage du serveur CARPIMKO...
echo Ouvre ton navigateur sur http://localhost:3000
echo (Laisse cette fenetre ouverte. Ferme-la pour arreter le serveur.)
echo.
node --disable-warning=ExperimentalWarning server.js
pause
