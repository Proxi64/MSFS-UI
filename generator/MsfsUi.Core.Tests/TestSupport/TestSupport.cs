using MsfsUi.Core.Packaging;
using MsfsUi.Core.Sim;

namespace MsfsUi.Core.Tests.TestSupport;

/// <summary>A temporary folder deleted with the test.</summary>
internal sealed class TempFolder : IDisposable
{
    public TempFolder()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "msfs-ui-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    /// <summary>Full path of a forward-slash relative path inside the folder.</summary>
    public string this[string relativePath] => System.IO.Path.Combine(Path, relativePath.Replace('/', System.IO.Path.DirectorySeparatorChar));

    /// <summary>Writes text files (UTF-8 without BOM), creating folders.</summary>
    public string Write(string relativePath, string content)
    {
        var target = this[relativePath];
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target)!);
        File.WriteAllText(target, content, SimPackageFiles.Utf8);
        return target;
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // A locked or read-only file must not fail the test; the folder lives under %TEMP%.
        }
    }
}

/// <summary>Golden fixtures from MSFS-UI 0.3.0 (see Golden/README.md).</summary>
internal static class Golden
{
    public static string Path(string name) => System.IO.Path.Combine(AppContext.BaseDirectory, "Golden", "0.3.0", name);

    public static string Text(string name) => File.ReadAllText(Path(name), SimPackageFiles.Utf8);

    public static byte[] Bytes(string name) => File.ReadAllBytes(Path(name));
}

/// <summary>A fake <c>fs-base-ui</c>: manifest and MasterPage, like the 0.3.0 tests.</summary>
internal static class FakeFsBaseUi
{
    public const string Version = "9.9.9";

    public static string MasterPageHtml => Golden.Text("masterpage-input.html");

    public static string Create(TempFolder folder, string root = "fs-base-ui", string? masterPage = null)
    {
        folder.Write($"{root}/manifest.json", $"{{\"package_version\":\"{Version}\"}}");
        folder.Write($"{root}/{PackageLayout.MasterPageHtmlPath}", masterPage ?? MasterPageHtml);
        folder.Write($"{root}/{PackageLayout.MasterPageJsonPath}", "{\"children\":[]}");
        return folder[root];
    }

    public static SimInstallation Installation(string fsBaseUi, string community) =>
        new(SimEdition.Manual, fsBaseUi, Version, community);
}

/// <summary>A clock stopped at a given instant.</summary>
internal sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}

/// <summary>A machine made of temporary folders.</summary>
internal sealed class FakeSimEnvironment(TempFolder folder) : ISimEnvironment
{
    public string RoamingAppData => folder["roaming"];

    public string LocalAppData => folder["local"];

    public string? SteamPath { get; set; }

    public List<string> Drives { get; } = [];

    public bool Running { get; set; }

    public string? ReadSteamPath() => SteamPath;

    public IEnumerable<string> FixedDriveRoots() => Drives;

    public bool IsProcessRunning(string processName) => Running && processName == SimLocator.SimProcessName;

    /// <summary>Start time of the fake sim; defaults to a time long before any test install.</summary>
    public DateTime SimStartedUtc { get; set; } = new(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public DateTime? GetProcessStartTimeUtc(string processName) =>
        Running && processName == SimLocator.SimProcessName ? SimStartedUtc : null;
}
