# Configuration unique du depot GitHub pour les mises a jour automatiques.
# Usage :
#   .\configurer-github.ps1 -RepoUrl "https://github.com/TON_COMPTE/carpimko-maj.git" `
#                           -Nom "Ton Nom" -Email "toi@exemple.fr"
param(
  [Parameter(Mandatory = $true)][string]$RepoUrl,
  [string]$Nom = "CARPIMKO",
  [string]$Email = "carpimko@local",
  # Chemin du package portable a configurer pour recevoir les maj (facultatif)
  [string]$Portable = "C:\Users\Dell\CARPIMKO-Portable"
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

if ($RepoUrl -notmatch 'github\.com[:/](.+?)/(.+?)(\.git)?$') { throw "URL GitHub invalide : $RepoUrl" }
$owner = $Matches[1]; $repo = $Matches[2]
$manifestUrl = "https://raw.githubusercontent.com/$owner/$repo/main/update/version.json"

# 1) Depot git
if (-not (Test-Path "$root\.git")) { git init | Out-Null; git branch -M main }
git config user.name $Nom
git config user.email $Email
if ((git remote) -contains 'origin') { git remote set-url origin $RepoUrl } else { git remote add origin $RepoUrl }
Write-Host "Depot configure -> $owner/$repo"

# 2) Configure le package portable pour recevoir les mises a jour
$envPath = Join-Path $Portable "app\.env"
if (Test-Path $envPath) {
  $lignes = Get-Content $envPath | Where-Object { $_ -notmatch '^\s*UPDATE_MANIFEST_URL=' }
  $lignes += "UPDATE_MANIFEST_URL=$manifestUrl"
  $lignes | Set-Content $envPath -Encoding utf8
  Write-Host "Package portable configure (UPDATE_MANIFEST_URL ajoute)."
} else {
  Write-Host "(.env du package portable introuvable : $envPath - a configurer plus tard)"
}

# 3) Premiere publication (version 1.0.0)
Write-Host "Premiere publication..."
& "$root\publier-maj.ps1" -Version 1.0.0 -Notes "Version initiale"

Write-Host ""
Write-Host "Termine. Pour publier une future mise a jour :"
Write-Host "   .\publier-maj.ps1 -Version 1.1.0 -Notes 'ce qui change'"
Write-Host "Pour distribuer le client, mets UPDATE_MANIFEST_URL dans le .env des autres postes :"
Write-Host "   $manifestUrl"
