using Microsoft.Extensions.Logging;
using MsfsUi.Core.Sim;

namespace MsfsUi.Core.Packaging;

/// <summary>
/// Removes everything MSFS-UI put on the machine, the sim closed: the package in Community (when it is ours), the
/// vault module's folder (its <c>work</c> files and the module the sim compiled), the app's data and its legacy folder.
/// The keys the mod wrote in the sim's own storage stay: only the running sim can reach them. The app's own folder is
/// left to the user (a running app cannot delete itself).
/// </summary>
public sealed partial class Uninstaller
{
    /// <summary>What the app writes in its data folder: a legacy folder holding any of them is the app's.</summary>
    private static readonly string[] AppDataEntries = ["settings.json", "app.json", "logs", "staging"];

    private readonly ISimEnvironment _environment;
    private readonly AppPaths _paths;
    private readonly PackageInstaller _installer;
    private readonly SimLocator _simLocator;
    private readonly ILogger<Uninstaller> _logger;

    /// <summary>Creates the uninstaller.</summary>
    public Uninstaller(ISimEnvironment environment, AppPaths paths, PackageInstaller installer, SimLocator simLocator, ILogger<Uninstaller> logger)
    {
        _environment = environment;
        _paths = paths;
        _installer = installer;
        _simLocator = simLocator;
        _logger = logger;
    }

    /// <summary>
    /// The folders of MSFS-UI on the machine, those that exist, in the order they are deleted: the package (only when
    /// <paramref name="sim"/> is known and the folder is ours), the vault, the app's data.
    /// </summary>
    public async Task<IReadOnlyList<string>> FindAsync(SimInstallation? sim, CancellationToken cancellationToken = default)
    {
        var folders = new List<string>();
        if (sim is not null && await IsOwnPackageAsync(PackageInstaller.PackageFolder(sim), cancellationToken).ConfigureAwait(false))
        {
            folders.Add(PackageInstaller.PackageFolder(sim));
        }

        folders.AddRange(VaultFolders().Where(Directory.Exists));
        if (Directory.Exists(_paths.Root))
        {
            folders.Add(_paths.Root);
        }

        if (_paths.LegacyRoot is { } legacy && !string.Equals(legacy, _paths.Root, StringComparison.OrdinalIgnoreCase) && IsAppData(legacy))
        {
            folders.Add(legacy);
        }

        return folders;
    }

    /// <summary>
    /// Deletes the folders <see cref="FindAsync"/> gives, each one as far as it goes; returns those left (a file in use).
    /// </summary>
    /// <exception cref="MsfsUiException">The sim is running: it holds the package's and the vault's files.</exception>
    public async Task<IReadOnlyList<string>> UninstallAsync(SimInstallation? sim, CancellationToken cancellationToken = default)
    {
        if (_simLocator.IsSimRunning())
        {
            throw new MsfsUiException("Close the sim first: it holds the files of the package and of the vault.");
        }

        var left = new List<string>();
        foreach (var folder in await FindAsync(sim, cancellationToken).ConfigureAwait(false))
        {
            try
            {
                if (sim is not null && string.Equals(folder, PackageInstaller.PackageFolder(sim), StringComparison.OrdinalIgnoreCase))
                {
                    // The installer's own removal: one operation at a time, the state file last.
                    await _installer.RemoveAsync(sim, cancellationToken).ConfigureAwait(false);
                }
                else
                {
                    Directory.Delete(folder, recursive: true);
                }

                LogDeleted(folder);
            }
            catch (Exception ex) when (ex is MsfsUiException or IOException or UnauthorizedAccessException)
            {
                LogLeft(folder, ex.Message);
                left.Add(folder);
            }
        }

        return left;
    }

    /// <summary>
    /// Where the sim keeps the vault module's folder: Steam (verified), then the Microsoft Store (reported by another
    /// mod's author under <c>MSFS2020</c>, unverified: both names are tried).
    /// </summary>
    private string[] VaultFolders()
    {
        var store = Path.Combine(_environment.LocalAppData, "Packages", SimLocator.StorePackageFamily, "LocalState", "WASM");
        return
        [
            Path.Combine(_environment.RoamingAppData, "Microsoft Flight Simulator 2024", "WASM", "MSFS2024", PackageLayout.PackageName),
            Path.Combine(store, "MSFS2024", PackageLayout.PackageName),
            Path.Combine(store, "MSFS2020", PackageLayout.PackageName),
        ];
    }

    private static async Task<bool> IsOwnPackageAsync(string folder, CancellationToken cancellationToken)
    {
        try
        {
            return Directory.Exists(folder) && await PackageState.ReadAsync(folder, cancellationToken).ConfigureAwait(false) is not null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static bool IsAppData(string folder) =>
        AppDataEntries.Any(entry => File.Exists(Path.Combine(folder, entry)) || Directory.Exists(Path.Combine(folder, entry)));

    [LoggerMessage(Level = LogLevel.Information, Message = "Uninstall: {Folder} deleted")]
    private partial void LogDeleted(string folder);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Uninstall: {Folder} left ({Reason})")]
    private partial void LogLeft(string folder, string reason);
}
