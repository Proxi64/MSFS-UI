using System.Globalization;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using MsfsUi.Core.Sim;

namespace MsfsUi.Core.Packaging;

/// <summary>What goes into a package besides the sim's MasterPage.</summary>
/// <param name="Version">Version written in the manifest and the state (the mod version).</param>
/// <param name="ModScript">The mod module, <c>main.js</c>, as embedded in the app.</param>
/// <param name="ConfigScript">The settings module, <c>config.js</c> (see <see cref="Features.ConfigScript"/>).</param>
/// <param name="VaultModule">The vault WASM module, <c>msfs-ui.wasm</c>; empty for a package without it (the mod then falls back to the sim's storage).</param>
public sealed record PackageInputs(string Version, ReadOnlyMemory<byte> ModScript, string ConfigScript, ReadOnlyMemory<byte> VaultModule)
{
    /// <summary>
    /// The inputs of the menu mod: the catalogue's version, the mod module, the vault module and the settings module
    /// generated from a complete selection (see <see cref="Features.SettingsNormalizer"/>).
    /// </summary>
    public static PackageInputs ForMod(Features.FeatureCatalog catalog, ReadOnlyMemory<byte> modScript, ReadOnlyMemory<byte> vaultModule, Features.FeatureSelection selection)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(selection);
        return new PackageInputs(catalog.ModVersion, modScript, Features.ConfigScript.Generate(selection, ProductInfo.Version), vaultModule);
    }
}

/// <summary>
/// Generates the Community package in a staging folder, from the sim's MasterPage and the app's inputs.
/// </summary>
public sealed partial class PackageBuilder
{
    private readonly TimeProvider _time;
    private readonly ILogger<PackageBuilder> _logger;

    /// <summary>Creates the builder.</summary>
    public PackageBuilder(TimeProvider time, ILogger<PackageBuilder> logger)
    {
        _time = time;
        _logger = logger;
    }

    /// <summary>
    /// Generates the package into <paramref name="outputFolder"/>, which is emptied first. The folder must be
    /// missing, empty, or a previous package (it has a <c>msfs-ui.json</c>): any other folder is refused, so a
    /// wrong path never deletes user files.
    /// </summary>
    /// <returns>The state written in <c>msfs-ui.json</c>.</returns>
    /// <exception cref="MsfsUiException">The MasterPage is missing or unexpected, or the folder is not ours.</exception>
    public async Task<PackageState> BuildAsync(SimInstallation sim, PackageInputs inputs, string outputFolder, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sim);
        ArgumentNullException.ThrowIfNull(inputs);
        ArgumentException.ThrowIfNullOrWhiteSpace(outputFolder);

        // Everything that can fail on the sim side is read and checked first: a sim update that changed the
        // MasterPage must leave the previous package in place.
        var sourceHtml = PackageLayout.Resolve(sim.FsBaseUiPath, PackageLayout.MasterPageHtmlPath);
        var sourceJson = PackageLayout.Resolve(sim.FsBaseUiPath, PackageLayout.MasterPageJsonPath);
        if (!File.Exists(sourceHtml) || !File.Exists(sourceJson))
        {
            throw new MsfsUiException($"The MasterPage component was not found in {Path.Combine(sim.FsBaseUiPath, "cookedcomps")}.");
        }

        var masterPageBytes = await File.ReadAllBytesAsync(sourceHtml, cancellationToken).ConfigureAwait(false);
        var masterPageJson = await File.ReadAllBytesAsync(sourceJson, cancellationToken).ConfigureAwait(false);
        var masterPage = MasterPageLoader.Insert(SimPackageFiles.Utf8.GetString(masterPageBytes));
        var configBytes = SimPackageFiles.Utf8.GetBytes(inputs.ConfigScript);

        await PrepareOutputFolderAsync(outputFolder, cancellationToken).ConfigureAwait(false);
        await WriteAsync(outputFolder, PackageLayout.ModulePath, inputs.ModScript, cancellationToken).ConfigureAwait(false);
        await WriteAsync(outputFolder, PackageLayout.ConfigPath, configBytes, cancellationToken).ConfigureAwait(false);
        if (!inputs.VaultModule.IsEmpty)
        {
            await WriteAsync(outputFolder, PackageLayout.VaultModulePath, inputs.VaultModule, cancellationToken).ConfigureAwait(false);
        }

        await WriteAsync(outputFolder, PackageLayout.PixelPath, PackageLayout.Pixel, cancellationToken).ConfigureAwait(false);
        await WriteAsync(outputFolder, PackageLayout.MasterPageHtmlPath, SimPackageFiles.Utf8.GetBytes(masterPage), cancellationToken).ConfigureAwait(false);
        await WriteAsync(outputFolder, PackageLayout.MasterPageJsonPath, masterPageJson, cancellationToken).ConfigureAwait(false);

        var state = new PackageState(
            PackageLayout.PackageName,
            inputs.Version,
            _time.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
            sim.FsBaseUiVersion,
            Sha256(masterPageBytes),
            ModHash(inputs),
            SettingsHash(inputs),
            VaultHash(inputs));
        await WriteAsync(outputFolder, PackageLayout.StateFile, SimPackageFiles.Utf8.GetBytes(state.ToJson()), cancellationToken).ConfigureAwait(false);

        // layout.json lists every other file; manifest.json gives their total size.
        var entries = ListLayoutEntries(outputFolder);
        await WriteAsync(outputFolder, PackageLayout.LayoutFile, SimPackageFiles.Utf8.GetBytes(SimPackageFiles.FormatLayout(entries)), cancellationToken).ConfigureAwait(false);
        var manifest = SimPackageFiles.FormatManifest(inputs.Version, entries.Sum(entry => entry.Size));
        await WriteAsync(outputFolder, PackageLayout.ManifestFile, SimPackageFiles.Utf8.GetBytes(manifest), cancellationToken).ConfigureAwait(false);

        LogBuilt(inputs.Version, outputFolder, state.FsBaseUiVersion);
        return state;
    }

    /// <summary>Lowercase hexadecimal SHA-256.</summary>
    public static string Sha256(ReadOnlySpan<byte> data) => Convert.ToHexStringLower(SHA256.HashData(data));

    /// <summary>Hash recorded as <see cref="PackageState.ModSha256"/> for these inputs.</summary>
    public static string ModHash(PackageInputs inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        return Sha256(inputs.ModScript.Span);
    }

    /// <summary>Hash recorded as <see cref="PackageState.VaultSha256"/> for these inputs; null without a vault module.</summary>
    public static string? VaultHash(PackageInputs inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        return inputs.VaultModule.IsEmpty ? null : Sha256(inputs.VaultModule.Span);
    }

    /// <summary>Hash recorded as <see cref="PackageState.SettingsSha256"/> for these inputs (of <c>config.js</c> as written).</summary>
    public static string SettingsHash(PackageInputs inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        return Sha256(SimPackageFiles.Utf8.GetBytes(inputs.ConfigScript));
    }

    /// <summary>The <c>layout.json</c> entries of a package folder: every file except the manifest and the layout, sorted by path.</summary>
    internal static List<LayoutEntry> ListLayoutEntries(string packageFolder)
    {
        return [.. new DirectoryInfo(packageFolder)
            .EnumerateFiles("*", SearchOption.AllDirectories)
            .Select(file => new LayoutEntry(
                Path.GetRelativePath(packageFolder, file.FullName).Replace(Path.DirectorySeparatorChar, '/'),
                file.Length,
                file.LastWriteTimeUtc.ToFileTimeUtc()))
            .Where(entry => entry.Path is not (PackageLayout.ManifestFile or PackageLayout.LayoutFile))
            .OrderBy(entry => entry.Path, StringComparer.Ordinal)];
    }

    private static async Task PrepareOutputFolderAsync(string outputFolder, CancellationToken cancellationToken)
    {
        if (Directory.Exists(outputFolder))
        {
            var isEmpty = !Directory.EnumerateFileSystemEntries(outputFolder).Any();
            if (!isEmpty && await PackageState.ReadAsync(outputFolder, cancellationToken).ConfigureAwait(false) is null)
            {
                throw new MsfsUiException($"The output folder {outputFolder} is not empty and does not contain an msfs-ui package: it was left untouched.");
            }

            try
            {
                Directory.Delete(outputFolder, recursive: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                throw new MsfsUiException(
                    $"The previous package in {outputFolder} could not be removed: a file may be in use (sim, antivirus or Explorer). Close it and try again.",
                    ex);
            }
        }

        Directory.CreateDirectory(outputFolder);
    }

    private static async Task WriteAsync(string packageFolder, string relativePath, ReadOnlyMemory<byte> data, CancellationToken cancellationToken)
    {
        var target = PackageLayout.Resolve(packageFolder, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        await File.WriteAllBytesAsync(target, data, cancellationToken).ConfigureAwait(false);
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Package {Version} generated in {Folder} (fs-base-ui {FsBaseUiVersion})")]
    private partial void LogBuilt(string version, string folder, string fsBaseUiVersion);
}
