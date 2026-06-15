// Lanceur portable CARPIMKO. Compile en Carpimko.exe.
// - Demarre le serveur Node embarque (avec Chromium portable) et ouvre le navigateur.
// - Gere les mises a jour : si un dossier "app_update" est present (depose par le
//   serveur lors d'une maj), il est applique sur "app" avant le demarrage. Si le
//   serveur quitte en laissant "restart.flag", le lanceur relance (donc applique la maj).
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

class Launcher
{
    static int Port = 3002;

    static int Main()
    {
        Console.Title = "CARPIMKO - Appels de cotisations";
        string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string appDir = Path.Combine(baseDir, "app");
        string nodeExe = Path.Combine(baseDir, "node", "node.exe");
        string browsers = Path.Combine(baseDir, "ms-playwright");
        string staging = Path.Combine(baseDir, "app_update");
        string restartFlag = Path.Combine(baseDir, "restart.flag");
        string server = Path.Combine(appDir, "server.js");

        if (!File.Exists(nodeExe))
        {
            Console.WriteLine("ERREUR : node introuvable. Garde le .exe a cote des dossiers 'node' et 'app'.");
            Console.ReadKey();
            return 1;
        }

        EnsureEnv(appDir);

        bool premier = true;
        while (true)
        {
            // Applique une mise a jour en attente (aucun fichier n'est verrouille : node est arrete).
            if (Directory.Exists(staging))
            {
                try
                {
                    Console.WriteLine("Application de la mise a jour...");
                    CopierRecursif(staging, appDir);
                    Directory.Delete(staging, true);
                    Console.WriteLine("Mise a jour appliquee.");
                }
                catch (Exception ex) { Console.WriteLine("Echec application maj : " + ex.Message); }
            }
            if (File.Exists(restartFlag)) { try { File.Delete(restartFlag); } catch { } }

            if (!File.Exists(server))
            {
                Console.WriteLine("ERREUR : application introuvable (app\\server.js).");
                Console.ReadKey();
                return 1;
            }

            if (premier)
            {
                Console.WriteLine();
                Console.WriteLine("  ====================================================");
                Console.WriteLine("    CARPIMKO - Recuperation des appels de cotisations");
                Console.WriteLine("  ====================================================");
                Console.WriteLine();
                Console.WriteLine("  Adresse : http://localhost:" + Port);
                Console.WriteLine("  Pour arreter : ferme cette fenetre.");
                Console.WriteLine();
            }

            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "--disable-warning=ExperimentalWarning server.js",
                WorkingDirectory = appDir,
                UseShellExecute = false,
            };
            psi.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"] = browsers;
            psi.EnvironmentVariables["PATH"] = Path.Combine(baseDir, "node") + ";" + Environment.GetEnvironmentVariable("PATH");

            Process node;
            try { node = Process.Start(psi); }
            catch (Exception ex)
            {
                Console.WriteLine("ERREUR au demarrage de Node : " + ex.Message);
                Console.ReadKey();
                return 1;
            }

            if (premier)
            {
                if (AttendrePort("127.0.0.1", Port, 20))
                {
                    try { Process.Start("http://localhost:" + Port); } catch { }
                }
                premier = false;
            }

            node.WaitForExit();

            // Si le serveur a demande un redemarrage (mise a jour), on reboucle ; sinon on quitte.
            if (File.Exists(restartFlag) || Directory.Exists(staging))
            {
                Console.WriteLine("Redemarrage...");
                Thread.Sleep(500);
                continue;
            }
            break;
        }
        return 0;
    }

    static void EnsureEnv(string appDir)
    {
        string envPath = Path.Combine(appDir, ".env");
        if (File.Exists(envPath))
        {
            foreach (string line in File.ReadAllLines(envPath))
                if (line.StartsWith("PORT=")) int.TryParse(line.Substring(5).Trim(), out Port);
            return;
        }
        string key = NouvelleCle();
        string contenu =
            "PORT=" + Port + "\r\n" +
            "MASTER_KEY=" + key + "\r\n" +
            "HEADLESS=false\r\n" +
            "CARPIMKO_LOGIN_URL=https://www2.carpimko.com/Comptes/Connexion?ReturnUrl=%2F\r\n" +
            "NAV_TIMEOUT=45000\r\n" +
            "TOUS_DOCUMENTS=false\r\n";
        File.WriteAllText(envPath, contenu, new UTF8Encoding(false));
        Console.WriteLine("Premiere utilisation : configuration creee (cle de chiffrement generee).");
    }

    // Copie recursivement src dans dst (ecrase les fichiers existants, n'efface rien d'autre).
    static void CopierRecursif(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (string f in Directory.GetFiles(src))
            File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
        foreach (string d in Directory.GetDirectories(src))
            CopierRecursif(d, Path.Combine(dst, Path.GetFileName(d)));
    }

    static string NouvelleCle()
    {
        byte[] b = new byte[32];
        using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(b);
        var sb = new StringBuilder();
        foreach (byte x in b) sb.Append(x.ToString("x2"));
        return sb.ToString();
    }

    static bool AttendrePort(string host, int port, int secondes)
    {
        for (int i = 0; i < secondes * 2; i++)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(host, port, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(400) && c.Connected) return true;
                }
            }
            catch { }
            Thread.Sleep(100);
        }
        return false;
    }
}
