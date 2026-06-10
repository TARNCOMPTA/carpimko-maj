# Publie une nouvelle version sur GitHub (manifeste + archive de code).
# Usage :  .\publier-maj.ps1 -Version 1.1.0 -Notes "Ce qui change"
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "",
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

# 1) Verifie le depot git et deduit l'URL "raw" GitHub
if ($DryRun) {
  $owner = 'EXEMPLE'; $repo = 'carpimko-maj'
} else {
  $remote = (git config --get remote.origin.url) 2>$null
  if (-not $remote) { throw "Aucun depot GitHub configure. Lance d'abord : .\configurer-github.ps1" }
  if ($remote -match 'github\.com[:/](.+?)/(.+?)(\.git)?$') {
    $owner = $Matches[1]; $repo = $Matches[2]
  } else { throw "URL de depot non reconnue : $remote" }
}
$rawBase = "https://raw.githubusercontent.com/$owner/$repo/main"
$zipUrl  = "$rawBase/update/app.zip"
$manifestUrl = "$rawBase/update/version.json"

Write-Host "Publication de la version $Version sur $owner/$repo ..."

# 2) Met a jour version.json (embarque dans l'archive) - sans BOM
[System.IO.File]::WriteAllText("$root\version.json", (@{ version = $Version } | ConvertTo-Json))

# 3) Construit update\app.zip (code uniquement)
New-Item -ItemType Directory -Force -Path "$root\update" | Out-Null
$appzip = "$root\update\app.zip"
if (Test-Path $appzip) { Remove-Item $appzip -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fs = [System.IO.File]::Open($appzip, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
function Add-File($full, $entry) {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
# Fichiers racine
foreach ($f in 'server.js','package.json','version.json') { Add-File "$root\$f" $f }
# Dossiers de code
foreach ($d in 'src','public') {
  Get-ChildItem "$root\$d" -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1).Replace('\','/')
    Add-File $_.FullName $rel
  }
}
$zip.Dispose(); $fs.Close()
Write-Host "Archive creee : $([math]::Round((Get-Item $appzip).Length/1KB)) Ko"

# 4) Manifeste (sans BOM)
[System.IO.File]::WriteAllText("$root\update\version.json", (@{ version = $Version; notes = $Notes; url = $zipUrl } | ConvertTo-Json))

# 5) Commit + push
if ($DryRun) {
  Write-Host "[DryRun] Git ignore. Manifeste genere :"
  Get-Content "$root\update\version.json"
  return
}
git add -A
git commit -m "Mise a jour v$Version" | Out-Null
git push origin main
Write-Host ""
Write-Host "============================================================"
Write-Host " Version $Version publiee."
Write-Host " Les postes se mettront a jour si leur .env contient :"
Write-Host "   UPDATE_MANIFEST_URL=$manifestUrl"
Write-Host "============================================================"
