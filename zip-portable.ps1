# Cree le ZIP de distribution du package portable, en EXCLUANT les donnees personnelles
# (base clients, cle .env, PDF telecharges). Resultat = modele vierge a distribuer.
$ErrorActionPreference = 'Stop'
$base = "C:\Users\Dell\CARPIMKO-Portable"
$zipPath = "C:\Users\Dell\CARPIMKO-Portable.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function EstExclu($rel) {
  return ($rel -like 'app\data\*') -or ($rel -like 'app\downloads\*') -or
         ($rel -eq 'app\.env') -or ($rel -like 'app_update\*') -or ($rel -eq 'app_update') -or
         ($rel -eq 'restart.flag')
}

$fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$prefixLen = $base.Length + 1
$n = 0
Get-ChildItem $base -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($prefixLen)
  if (EstExclu $rel) { return }
  $entry = "CARPIMKO-Portable/" + ($rel -replace '\\','/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Fastest) | Out-Null
  $n++
}
# Dossiers vides data/ et downloads/ pour la structure
$zip.CreateEntry("CARPIMKO-Portable/app/data/") | Out-Null
$zip.CreateEntry("CARPIMKO-Portable/app/downloads/") | Out-Null
$zip.Dispose(); $fs.Close()
Write-Host "ZIP cree : $zipPath ($n fichiers, $([math]::Round((Get-Item $zipPath).Length/1MB)) Mo)"
