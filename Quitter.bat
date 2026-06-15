@echo off
title CARPIMKO - Arret
cd /d "%~dp0"
echo Arret du serveur CARPIMKO...

rem Tente d'abord un arret propre via l'API, puis force si besoin.
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:3002/api/quit' -Method Post -TimeoutSec 3 -UseBasicParsing | Out-Null } catch {}" >nul 2>nul

rem Termine le processus Node qui ecoute encore sur le port 3002.
set "TROUVE="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3002" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul
  set "TROUVE=1"
)

if defined TROUVE (echo Serveur arrete.) else (echo Aucun serveur en cours sur le port 3002.)
timeout /t 2 >nul
