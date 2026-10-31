using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace MsfsUi.Core.Sim;

/// <summary>
/// What sim detection needs from the machine, behind an interface so detection can be tested without the sim.
/// </summary>
public interface ISimEnvironment
{
    /// <summary>Roaming application data folder (<c>%APPDATA%</c>).</summary>
    string RoamingAppData { get; }

    /// <summary>Local application data folder (<c>%LOCALAPPDATA%</c>).</summary>
    string LocalAppData { get; }

    /// <summary>Steam install folder (<c>HKCU\Software\Valve\Steam</c>, value <c>SteamPath</c>), or null.</summary>
    string? ReadSteamPath();

    /// <summary>Root folders of fixed drives (<c>C:\</c>, <c>D:\</c>…), where the Store installs games.</summary>
    IEnumerable<string> FixedDriveRoots();

    /// <summary>
    /// Install folders of the Microsoft Store packages of a family installed for the user, as Windows gives them
    /// (<c>C:\Program Files\WindowsApps\…</c>, or a folder chosen in the Xbox app); none when it is not installed.
    /// </summary>
    IReadOnlyList<string> StorePackageFolders(string packageFamilyName);

    /// <summary>Whether a process with this name (without <c>.exe</c>) is running.</summary>
    bool IsProcessRunning(string processName);

    /// <summary>Start time (UTC) of the oldest process with this name, or null if none runs or it cannot be read.</summary>
    DateTime? GetProcessStartTimeUtc(string processName);
}

/// <summary>The real machine.</summary>
public sealed unsafe partial class WindowsSimEnvironment : ISimEnvironment
{
    private readonly string? _roamingAppData;
    private readonly string? _localAppData;

    /// <summary>The user's folders.</summary>
    public WindowsSimEnvironment()
    {
    }

    /// <summary>
    /// Other folders instead of <c>%APPDATA%</c> and <c>%LOCALAPPDATA%</c> (the app's UI tests: the sim's data, its
    /// vault folder included, is then never the user's).
    /// </summary>
    public WindowsSimEnvironment(string roamingAppData, string localAppData)
    {
        _roamingAppData = roamingAppData;
        _localAppData = localAppData;
    }

    /// <inheritdoc />
    public string RoamingAppData => _roamingAppData ?? Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

    /// <inheritdoc />
    public string LocalAppData => _localAppData ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

    /// <inheritdoc />
    public string? ReadSteamPath()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
        return key?.GetValue("SteamPath") as string;
    }

    /// <inheritdoc />
    public IEnumerable<string> FixedDriveRoots()
    {
        return DriveInfo.GetDrives()
            .Where(drive => drive.DriveType == DriveType.Fixed && drive.IsReady)
            .Select(drive => drive.RootDirectory.FullName);
    }

    /// <inheritdoc />
    public IReadOnlyList<string> StorePackageFolders(string packageFamilyName)
    {
        // Two calls each (appmodel.h): the first gives the sizes, the second fills the buffers.
        uint count = 0;
        uint length = 0;
        var result = GetPackagesByPackageFamily(packageFamilyName, ref count, null, ref length, null);
        if (result != ErrorInsufficientBuffer || count == 0)
        {
            return [];
        }

        // The names point into the buffer: read while it is pinned.
        var fullNames = new List<string>();
        var pointers = new IntPtr[count];
        var buffer = new char[length];
        fixed (IntPtr* names = pointers)
        fixed (char* text = buffer)
        {
            if (GetPackagesByPackageFamily(packageFamilyName, ref count, names, ref length, text) != ErrorSuccess)
            {
                return [];
            }

            for (var at = 0; at < count; at++)
            {
                fullNames.Add(new string((char*)names[at]));
            }
        }

        var folders = new List<string>();
        foreach (var fullName in fullNames)
        {
            uint pathLength = 0;
            if (GetPackagePathByFullName(fullName, ref pathLength, null) != ErrorInsufficientBuffer)
            {
                continue;
            }

            var path = new char[pathLength];
            fixed (char* pathText = path)
            {
                if (GetPackagePathByFullName(fullName, ref pathLength, pathText) == ErrorSuccess)
                {
                    folders.Add(new string(pathText));
                }
            }
        }

        return folders;
    }

    private const int ErrorSuccess = 0;
    private const int ErrorInsufficientBuffer = 122;

    [LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int GetPackagesByPackageFamily(string packageFamilyName, ref uint count, IntPtr* packageFullNames, ref uint bufferLength, char* buffer);

    [LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int GetPackagePathByFullName(string packageFullName, ref uint pathLength, char* path);

    /// <inheritdoc />
    public bool IsProcessRunning(string processName)
    {
        var processes = Process.GetProcessesByName(processName);
        foreach (var process in processes)
        {
            process.Dispose();
        }

        return processes.Length > 0;
    }

    /// <inheritdoc />
    public DateTime? GetProcessStartTimeUtc(string processName)
    {
        DateTime? oldest = null;
        foreach (var process in Process.GetProcessesByName(processName))
        {
            using (process)
            {
                try
                {
                    var start = process.StartTime.ToUniversalTime();
                    oldest = oldest is null || start < oldest ? start : oldest;
                }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                    // The process exited or is not accessible: its start time is unknown.
                }
            }
        }

        return oldest;
    }
}
