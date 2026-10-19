using System.Diagnostics;
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

    /// <summary>Whether a process with this name (without <c>.exe</c>) is running.</summary>
    bool IsProcessRunning(string processName);

    /// <summary>Start time (UTC) of the oldest process with this name, or null if none runs or it cannot be read.</summary>
    DateTime? GetProcessStartTimeUtc(string processName);
}

/// <summary>The real machine.</summary>
public sealed class WindowsSimEnvironment : ISimEnvironment
{
    /// <inheritdoc />
    public string RoamingAppData => Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

    /// <inheritdoc />
    public string LocalAppData => Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

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
