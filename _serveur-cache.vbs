' Lance CARPIMKO SANS aucune fenetre visible :
'   1) arrete une instance precedente, 2) ouvre le navigateur,
'   3) demarre le serveur Node masque (avec mise a jour auto + redemarrage).
' Appele par Demarrer.bat. Pour arreter : double-clic sur Quitter.bat.
Option Explicit
Dim sh, fso, appDir, baseDir, staging, flag, http
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
baseDir = fso.GetParentFolderName(appDir)
sh.CurrentDirectory = appDir

' 1) Arrete proprement une instance precedente (libere le port 3002), pour que
' relancer "Demarrer" recharge bien la derniere version.
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.open "POST", "http://localhost:3002/api/quit", False
http.send
On Error GoTo 0
WScript.Sleep 1500

' 2) Ouvre le navigateur apres un court delai, en parallele (seule fenetre visible).
sh.Run "cmd /c timeout /t 3 >nul & start """" http://localhost:3002", 0, False

' 3) Boucle de demarrage avec application des mises a jour (comme le lanceur portable).
'    Wait=True : on attend l'arret du serveur ; s'il s'est arrete pour installer une
'    mise a jour, on l'applique et on relance.
Do
  staging = baseDir & "\app_update"
  If fso.FolderExists(staging) Then
    sh.Run "cmd /c xcopy /E /Y /I """ & staging & "\*"" """ & appDir & """ >nul & rmdir /S /Q """ & staging & """", 0, True
  End If
  flag = baseDir & "\restart.flag"
  If fso.FileExists(flag) Then fso.DeleteFile flag, True
  sh.Run "node --disable-warning=ExperimentalWarning server.js", 0, True
Loop While fso.FileExists(baseDir & "\restart.flag") Or fso.FolderExists(baseDir & "\app_update")
