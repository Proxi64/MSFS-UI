using Microsoft.Extensions.Logging;
using MsfsUi.Core.Sim;

namespace MsfsUi.Core.Packaging;

/// <summary>
/// Installs, inspects and removes the package in the sim's Community folder. A <c>msfs-ui</c> folder without our
/// state file is never modified.
/// </summary>
public sealed partial class PackageInstaller
{
    /// <summary>Files copied last, in this order: the package only claims to be the new build once it is complete.</summary>
    private static readonly string[] FilesCopiedLast = [PackageLayout.LayoutFile, PackageLayout.ManifestFile, PackageLayout.StateFile];

    private readonly PackageBuilder _builder;
    private readonly SimLocator _simLocator;
    private readonly AppPaths _paths;
    private readonly ILogger<PackageInstaller> _logger;

    /// <summary>Creates the installer.</summary>
    public PackageInstaller(PackageBuilder builder, SimLocator simLocator, AppPaths paths, ILogger<PackageInstaller> logger)
    {
        _builder = builder;
        _simLocator = simLocator;
        _paths = paths;
        _logger = logger;
    }

    /// <summary>Folder of the package in the sim's Community folder.</summary>
    public static string PackageFolder(SimInstallation sim)
    {
        ArgumentNullException.ThrowIfNull(sim);
        return Path.Combine(sim.CommunityPath, PackageLayout.PackageName);
    }

    /// <summary>Compares the installed package with what <paramref name="expected"/> would generate.</summary>
    /// <exception cref="MsfsUiException">The package or the sim's MasterPage cannot be read.</exception>
    public async Task<PackageStatus> GetStatusAsync(SimInstallation sim, PackageInputs expected, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sim);
        ArgumentNullException.ThrowIfNull(expected);

        var folder = PackageFolder(sim);
        var conflicts = FindConflicts(sim);
        var simRunning = _simLocator.IsSimRunning();
        if (!Directory.Exists(folder))
        {
            return new PackageStatus(PackageStatusKind.NotInstalled, folder, null, [], conflicts, simRunning);
        }

        try
        {
            var installed = await PackageState.ReadAsync(folder, cancellationToken).ConfigureAwait(false);
            if (installed is null)
            {
                return new PackageStatus(PackageStatusKind.Foreign, folder, null, [], conflicts, simRunning);
            }

            var reasons = await UpdateReasonsAsync(sim, installed, expected, cancellationToken).ConfigureAwait(false);
            var kind = reasons.Count == 0 ? PackageStatusKind.UpToDate : PackageStatusKind.UpdateNeeded;
            return new PackageStatus(kind, folder, installed, reasons, conflicts, simRunning);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new MsfsUiException($"The package status could not be read: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// Generates the package in the staging folder and copies it into Community, over the previous one. The
    /// previous package is not deleted first (the running sim may hold its files open); files that are no longer
    /// part of the package are removed afterwards. The state file is copied last: if the copy fails half-way, the
    /// package still describes the previous build, so its status asks for an update.
    /// </summary>
    /// <exception cref="MsfsUiException">The Community folder is missing or holds a foreign <c>msfs-ui</c> folder, the
    /// MasterPage cannot be used, or a file is locked.</exception>
    public async Task<InstallResult> InstallAsync(SimInstallation sim, PackageInputs inputs, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sim);
        ArgumentNullException.ThrowIfNull(inputs);

        if (!Directory.Exists(sim.CommunityPath))
        {
            throw new MsfsUiException($"Community folder not found: {sim.CommunityPath}. Check the sim folders.");
        }

        var target = PackageFolder(sim);
        PackageState? previous = null;
        byte[]? previousMasterPage = null;
        var existingFiles = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (Directory.Exists(target))
            {
                foreach (var file in Directory.EnumerateFiles(target, "*", SearchOption.AllDirectories))
                {
                    existingFiles[Path.GetRelativePath(target, file)] = File.GetCreationTimeUtc(file);
                }

                previous = await RequireOwnPackageAsync(target, cancellationToken).ConfigureAwait(false);
                previousMasterPage = await ReadIfExistsAsync(PackageLayout.Resolve(target, PackageLayout.MasterPageHtmlPath), cancellationToken).ConfigureAwait(false);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new MsfsUiException($"The installed package could not be read: {ex.Message}", ex);
        }

        var state = await _builder.BuildAsync(sim, inputs, _paths.StagingPackage, cancellationToken).ConfigureAwait(false);
        var newMasterPage = await File.ReadAllBytesAsync(PackageLayout.Resolve(_paths.StagingPackage, PackageLayout.MasterPageHtmlPath), cancellationToken).ConfigureAwait(false);
        var newestFileCreatedUtc = NewestCreationTime(_paths.StagingPackage, existingFiles);
        try
        {
            SynchronizeFolder(_paths.StagingPackage, target);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new MsfsUiException($"The package could not be fully copied to {target}: a file may be in use. Close the sim and install again.", ex);
        }

        var masterPageChanged = previousMasterPage is null || !previousMasterPage.AsSpan().SequenceEqual(newMasterPage);
        var conflicts = FindConflicts(sim);
        var nextStep = NextStepAfterInstall(previous, newestFileCreatedUtc, masterPageChanged);

        LogInstalled(state.Version, target, nextStep);
        if (conflicts.Count > 0)
        {
            LogConflicts(string.Join(", ", conflicts));
        }

        return new InstallResult(state, target, previous is null, masterPageChanged, conflicts, nextStep);
    }

    /// <summary>Removes the package from Community. Returns false if it was not installed.</summary>
    /// <exception cref="MsfsUiException">The <c>msfs-ui</c> folder is not ours, or a file is locked.</exception>
    public async Task<bool> RemoveAsync(SimInstallation sim, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sim);

        var target = PackageFolder(sim);
        if (!Directory.Exists(target))
        {
            return false;
        }

        try
        {
            await RequireOwnPackageAsync(target, cancellationToken).ConfigureAwait(false);
            Directory.Delete(target, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new MsfsUiException($"The package could not be removed from {target}: a file may be in use. Close the sim and try again.", ex);
        }

        LogRemoved(target);
        return true;
    }

    /// <summary>Other Community packages that also replace the MasterPage (only one package can win).</summary>
    public static IReadOnlyList<string> FindConflicts(SimInstallation sim)
    {
        ArgumentNullException.ThrowIfNull(sim);
        try
        {
            return [.. Directory.EnumerateDirectories(sim.CommunityPath)
                .Select(Path.GetFileName)
                .OfType<string>()
                .Where(name => !string.Equals(name, PackageLayout.PackageName, StringComparison.OrdinalIgnoreCase))
                .Where(name => File.Exists(PackageLayout.Resolve(Path.Combine(sim.CommunityPath, name), PackageLayout.MasterPageHtmlPath)))
                .Order(StringComparer.OrdinalIgnoreCase)];
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>
    /// What the user must do in the sim. The sim mounts a package and reads the MasterPage only at start-up, then
    /// re-reads on the fly the files of a mounted package that its <c>layout.json</c> listed at start-up; a file added
    /// since is not served (seen on sim 1.9.18). A hot reload is therefore enough only if the MasterPage did not
    /// change and every file of the new package already existed when the running sim started. Installs copy over
    /// existing files, which keeps their creation time, however many installs happened since. (A file deleted by
    /// hand and installed again counts as new: a restart is asked that may not be needed, never the reverse.)
    /// </summary>
    private NextStep NextStepAfterInstall(PackageState? previous, DateTime? newestFileCreatedUtc, bool masterPageChanged)
    {
        if (!_simLocator.IsSimRunning())
        {
            return NextStep.None;
        }

        if (previous is null || masterPageChanged)
        {
            return NextStep.RestartSim;
        }

        var simStarted = _simLocator.SimStartTimeUtc();
        var mounted = simStarted is not null && newestFileCreatedUtc is not null && newestFileCreatedUtc < simStarted;
        return mounted ? NextStep.ReloadMod : NextStep.RestartSim;
    }

    /// <summary>
    /// The latest creation time, in the installed package, of the files of the package about to be installed; null if
    /// one of them is not installed yet.
    /// </summary>
    private static DateTime? NewestCreationTime(string newPackage, Dictionary<string, DateTime> installedFiles)
    {
        DateTime? newest = null;
        foreach (var file in Directory.EnumerateFiles(newPackage, "*", SearchOption.AllDirectories))
        {
            if (!installedFiles.TryGetValue(Path.GetRelativePath(newPackage, file), out var created))
            {
                return null;
            }

            if (newest is null || created > newest)
            {
                newest = created;
            }
        }

        return newest;
    }

    private static async Task<List<UpdateReason>> UpdateReasonsAsync(SimInstallation sim, PackageState installed, PackageInputs expected, CancellationToken cancellationToken)
    {
        var reasons = new List<UpdateReason>();
        var simMasterPage = PackageLayout.Resolve(sim.FsBaseUiPath, PackageLayout.MasterPageHtmlPath);
        var simMasterPageBytes = await ReadIfExistsAsync(simMasterPage, cancellationToken).ConfigureAwait(false);
        if (simMasterPageBytes is null || PackageBuilder.Sha256(simMasterPageBytes) != installed.MasterPageSha256)
        {
            // A missing MasterPage is a sim change too: generating again will report it.
            reasons.Add(UpdateReason.SimUpdated);
        }

        if (installed.ModSha256 is null || installed.SettingsSha256 is null)
        {
            reasons.Add(UpdateReason.LegacyPackage);
            return reasons;
        }

        if (installed.Version != expected.Version)
        {
            reasons.Add(UpdateReason.AppVersionChanged);
        }
        else if (installed.ModSha256 != PackageBuilder.ModHash(expected))
        {
            reasons.Add(UpdateReason.ModChanged);
        }

        if (installed.SettingsSha256 != PackageBuilder.SettingsHash(expected))
        {
            reasons.Add(UpdateReason.SettingsChanged);
        }

        return reasons;
    }

    private static async Task<PackageState> RequireOwnPackageAsync(string folder, CancellationToken cancellationToken)
    {
        return await PackageState.ReadAsync(folder, cancellationToken).ConfigureAwait(false)
            ?? throw new MsfsUiException($"{folder} does not contain {PackageLayout.StateFile}: this folder was not created by MSFS-UI-GENERATOR and is left untouched.");
    }

    /// <summary>
    /// Copies <paramref name="source"/> over <paramref name="target"/> (file times preserved, so <c>layout.json</c>
    /// stays exact): content first, then <c>layout.json</c>, <c>manifest.json</c> and the state file last; then
    /// deletes what is in <paramref name="target"/> but not in <paramref name="source"/>.
    /// </summary>
    internal static void SynchronizeFolder(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(target, Path.GetRelativePath(source, directory)));
        }

        var files = Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories)
            .Select(file => Path.GetRelativePath(source, file))
            .OrderBy(relative => Array.IndexOf(FilesCopiedLast, relative))
            .ThenBy(relative => relative, StringComparer.Ordinal);
        foreach (var relative in files)
        {
            var destination = Path.Combine(target, relative);
            File.Copy(Path.Combine(source, relative), destination, overwrite: true);
            File.SetLastWriteTimeUtc(destination, File.GetLastWriteTimeUtc(Path.Combine(source, relative)));
        }

        Prune(source, target, target);
    }

    private static void Prune(string source, string target, string folder)
    {
        foreach (var entry in Directory.EnumerateFileSystemEntries(folder).ToList())
        {
            var counterpart = Path.Combine(source, Path.GetRelativePath(target, entry));
            if (Directory.Exists(entry))
            {
                if (Directory.Exists(counterpart))
                {
                    Prune(source, target, entry);
                }
                else
                {
                    Directory.Delete(entry, recursive: true);
                }
            }
            else if (!File.Exists(counterpart))
            {
                File.Delete(entry);
            }
        }
    }

    private static async Task<byte[]?> ReadIfExistsAsync(string path, CancellationToken cancellationToken) =>
        File.Exists(path) ? await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false) : null;

    [LoggerMessage(Level = LogLevel.Information, Message = "Package {Version} installed in {Folder}; next step in the sim: {NextStep}")]
    private partial void LogInstalled(string version, string folder, NextStep nextStep);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Other Community packages also replace the MasterPage: {Conflicts}. Only one can win: remove the others.")]
    private partial void LogConflicts(string conflicts);

    [LoggerMessage(Level = LogLevel.Information, Message = "Package removed from {Folder}")]
    private partial void LogRemoved(string folder);
}
