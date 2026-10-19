using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace MsfsUi.Core.Sim;

/// <summary>
/// Finds MSFS 2024: the <c>fs-base-ui</c> package (source of the MasterPage) and the Community folder.
/// Steam is tried first, then the Microsoft Store; explicit folders in <see cref="SimLocatorOptions"/> win.
/// </summary>
public sealed partial class SimLocator
{
    /// <summary>Process name of the running sim.</summary>
    public const string SimProcessName = "FlightSimulator2024";

    private const string StorePackageFamily = "Microsoft.Limitless_8wekyb3d8bbwe";
    private const string UserCfgFileName = "UserCfg.opt";

    private readonly ISimEnvironment _environment;
    private readonly ILogger<SimLocator> _logger;

    /// <summary>Creates the locator.</summary>
    public SimLocator(ISimEnvironment environment, ILogger<SimLocator> logger)
    {
        _environment = environment;
        _logger = logger;
    }

    /// <summary>Whether the sim is running.</summary>
    public bool IsSimRunning() => _environment.IsProcessRunning(SimProcessName);

    /// <summary>When the running sim started (UTC), or null if it is not running or the time cannot be read.</summary>
    public DateTime? SimStartTimeUtc() => _environment.GetProcessStartTimeUtc(SimProcessName);

    /// <summary>
    /// Locates the sim.
    /// </summary>
    /// <exception cref="MsfsUiException">The sim, its <c>fs-base-ui</c> package or its Community folder cannot be found.</exception>
    public async Task<SimInstallation> LocateAsync(SimLocatorOptions? options = null, CancellationToken cancellationToken = default)
    {
        options ??= new SimLocatorOptions();

        SimEdition edition;
        string fsBaseUi;
        string community;
        if (!string.IsNullOrWhiteSpace(options.CommunityPath) && !string.IsNullOrWhiteSpace(options.FsBaseUiPath))
        {
            edition = SimEdition.Manual;
            fsBaseUi = options.FsBaseUiPath;
            community = options.CommunityPath;
        }
        else
        {
            var detected = await DetectSteamAsync(cancellationToken).ConfigureAwait(false)
                ?? await DetectStoreAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new MsfsUiException(
                    "MSFS 2024 was not found (neither Steam nor Microsoft Store). Set the Community and fs-base-ui folders manually.");
            edition = detected.Edition;
            fsBaseUi = string.IsNullOrWhiteSpace(options.FsBaseUiPath) ? detected.FsBaseUiPath : options.FsBaseUiPath;
            community = string.IsNullOrWhiteSpace(options.CommunityPath) ? detected.CommunityPath : options.CommunityPath;
        }

        if (!File.Exists(Path.Combine(fsBaseUi, "manifest.json")))
        {
            throw new MsfsUiException($"fs-base-ui not found: {fsBaseUi} (no manifest.json).");
        }

        if (!Directory.Exists(community))
        {
            throw new MsfsUiException($"Community folder not found: {community}");
        }

        var version = await ReadPackageVersionAsync(fsBaseUi, cancellationToken).ConfigureAwait(false);
        LogLocated(edition, fsBaseUi, version, community);
        return new SimInstallation(edition, fsBaseUi, version, community);
    }

    private async Task<SimInstallation?> DetectSteamAsync(CancellationToken cancellationToken)
    {
        var userCfg = Path.Combine(_environment.RoamingAppData, "Microsoft Flight Simulator 2024", UserCfgFileName);
        var community = await CommunityFromUserCfgAsync(userCfg, cancellationToken).ConfigureAwait(false);
        if (community is null)
        {
            return null;
        }

        foreach (var library in await SteamLibrariesAsync(cancellationToken).ConfigureAwait(false))
        {
            var fsBaseUi = FindGamePackage(Path.Combine(library, "steamapps", "common"), "Packages");
            if (fsBaseUi is not null)
            {
                return new SimInstallation(SimEdition.Steam, fsBaseUi, string.Empty, community);
            }
        }

        return null;
    }

    /// <summary>The Steam folder itself, then the libraries listed in <c>libraryfolders.vdf</c>.</summary>
    private async Task<IReadOnlyList<string>> SteamLibrariesAsync(CancellationToken cancellationToken)
    {
        var steam = _environment.ReadSteamPath();
        if (string.IsNullOrWhiteSpace(steam))
        {
            return [];
        }

        var libraries = new List<string> { steam };
        var vdf = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
        var text = await TryReadAllTextAsync(vdf, cancellationToken).ConfigureAwait(false);
        if (text is not null)
        {
            libraries.AddRange(VdfPathRegex().Matches(text).Select(match => match.Groups[1].Value.Replace(@"\\", @"\", StringComparison.Ordinal)));
        }

        return [.. libraries.Select(NormalizeFolder).Distinct(StringComparer.OrdinalIgnoreCase)];
    }

    private async Task<SimInstallation?> DetectStoreAsync(CancellationToken cancellationToken)
    {
        var userCfg = Path.Combine(_environment.LocalAppData, "Packages", StorePackageFamily, "LocalCache", UserCfgFileName);
        var community = await CommunityFromUserCfgAsync(userCfg, cancellationToken).ConfigureAwait(false);
        if (community is null)
        {
            return null;
        }

        foreach (var drive in _environment.FixedDriveRoots())
        {
            var fsBaseUi = FindGamePackage(Path.Combine(drive, "XboxGames"), "Content", "Packages");
            if (fsBaseUi is not null)
            {
                return new SimInstallation(SimEdition.Store, fsBaseUi, string.Empty, community);
            }
        }

        return null;
    }

    /// <summary><c>&lt;InstalledPackagesPath&gt;\Community</c>, from the <c>InstalledPackagesPath "…"</c> line of <c>UserCfg.opt</c>.</summary>
    private async Task<string?> CommunityFromUserCfgAsync(string userCfg, CancellationToken cancellationToken)
    {
        var text = await TryReadAllTextAsync(userCfg, cancellationToken).ConfigureAwait(false);
        if (text is null)
        {
            return null;
        }

        var match = InstalledPackagesPathRegex().Match(text);
        return match.Success ? Path.Combine(match.Groups[1].Value.Trim(), "Community") : null;
    }

    /// <summary>Text of a file, or null if it is missing or cannot be read (locked, access denied).</summary>
    private async Task<string?> TryReadAllTextAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            return await File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            LogUnreadable(path, ex.Message);
            return null;
        }
    }

    /// <summary>
    /// <c>&lt;root&gt;\&lt;game&gt;\&lt;subfolders&gt;\fs-base-ui</c> of the first game folder that has one, preferring
    /// folders whose name contains "2024".
    /// </summary>
    private static string? FindGamePackage(string root, params string[] subfolders)
    {
        if (!Directory.Exists(root))
        {
            return null;
        }

        List<string> games;
        try
        {
            games = [.. Directory.EnumerateDirectories(root)
                .OrderByDescending(game => Path.GetFileName(game).Contains("2024", StringComparison.Ordinal))
                .ThenBy(game => game, StringComparer.OrdinalIgnoreCase)];
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Store game folders can deny listing; such a folder is simply not searched.
            return null;
        }

        foreach (var game in games)
        {
            var candidate = Path.Combine([game, .. subfolders, "fs-base-ui"]);
            if (File.Exists(Path.Combine(candidate, "manifest.json")))
            {
                return candidate;
            }
        }

        return null;
    }

    private static async Task<string> ReadPackageVersionAsync(string packageFolder, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = File.OpenRead(Path.Combine(packageFolder, "manifest.json"));
            using var manifest = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
            return manifest.RootElement.TryGetProperty("package_version", out var version) && version.ValueKind == JsonValueKind.String
                ? version.GetString() ?? "?"
                : "?";
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return "?";
        }
    }

    private static string NormalizeFolder(string folder) => Path.GetFullPath(folder.Replace('/', '\\'));

    [GeneratedRegex("\"path\"\\s+\"([^\"]+)\"")]
    private static partial Regex VdfPathRegex();

    [GeneratedRegex("^\\s*InstalledPackagesPath\\s+\"?([^\"\\r\\n]+?)\"?\\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex InstalledPackagesPathRegex();

    [LoggerMessage(Level = LogLevel.Information, Message = "Sim located: {Edition}, fs-base-ui {Version} at {FsBaseUi}, Community at {Community}")]
    private partial void LogLocated(SimEdition edition, string fsBaseUi, string version, string community);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Cannot read {Path}: {Reason}")]
    private partial void LogUnreadable(string path, string reason);
}
