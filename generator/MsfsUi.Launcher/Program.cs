// The launcher at the top of the release folder (the owner's choice, 2.0.3): the folder shows the user this exe, the
// licence and the app folder instead of several hundred files. It starts app\MSFS-UI-GENERATOR.exe with its own
// arguments, in that folder, and ends; the app does not depend on where it lives.

using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace MsfsUi.Launcher;

internal static partial class Program
{
    private const string AppFolder = "app";
    private const string AppExe = "MSFS-UI-GENERATOR.exe";
    private const uint MessageBoxIconError = 0x10;

    private static int Main(string[] args)
    {
        var app = Path.Combine(AppContext.BaseDirectory, AppFolder, AppExe);
        try
        {
            var start = new ProcessStartInfo(app) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(app)! };
            foreach (var arg in args)
            {
                start.ArgumentList.Add(arg);
            }

            Process.Start(start)?.Dispose();
            return 0;
        }
        catch (Exception error) when (error is Win32Exception or InvalidOperationException)
        {
            _ = MessageBox(
                IntPtr.Zero,
                $"MSFS-UI-GENERATOR could not start:\n{app}\n\n{error.Message}\n\nUnzip the whole MSFS-UI-GENERATOR folder again, the app folder with it.",
                "MSFS-UI-GENERATOR",
                MessageBoxIconError);
            return 1;
        }
    }

    [LibraryImport("user32.dll", EntryPoint = "MessageBoxW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int MessageBox(IntPtr owner, string text, string caption, uint type);
}
