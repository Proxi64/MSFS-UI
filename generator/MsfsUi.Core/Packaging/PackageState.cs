using System.Text.Json;
using System.Text.Json.Serialization;

namespace MsfsUi.Core.Packaging;

/// <summary>
/// Content of <c>msfs-ui.json</c>: what a package was generated from. It identifies a package as ours and tells
/// why it needs regenerating (sim update, app update, settings change).
/// </summary>
/// <param name="Name">Always <see cref="PackageLayout.PackageName"/>.</param>
/// <param name="Version">Version of the mod (and of the app that generated the package).</param>
/// <param name="BuiltAt">Generation time, UTC, to the second (ISO 8601, for example <c>2026-10-16T18:41:14Z</c>).</param>
/// <param name="FsBaseUiVersion">Version of the sim's <c>fs-base-ui</c> package the MasterPage was read from.</param>
/// <param name="MasterPageSha256">SHA-256 of the sim's original MasterPage HTML (before the loader was inserted).</param>
/// <param name="ModSha256">SHA-256 of <c>main.js</c>; absent in packages from MSFS-UI 0.3.0.</param>
/// <param name="SettingsSha256">SHA-256 of <c>config.js</c>; absent in packages from MSFS-UI 0.3.0.</param>
public sealed record PackageState(
    string Name,
    string Version,
    string BuiltAt,
    string FsBaseUiVersion,
    string MasterPageSha256,
    string? ModSha256 = null,
    string? SettingsSha256 = null)
{
    /// <summary>Serialises the state as written in <c>msfs-ui.json</c>.</summary>
    public string ToJson() => JsonSerializer.Serialize(this, PackageStateJsonContext.Default.PackageState) + "\n";

    /// <summary>Reads <c>msfs-ui.json</c> of a package folder; null if it is missing or unreadable (a foreign package).</summary>
    public static async Task<PackageState?> ReadAsync(string packageFolder, CancellationToken cancellationToken = default)
    {
        var path = Path.Combine(packageFolder, PackageLayout.StateFile);
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            await using var stream = File.OpenRead(path);
            var state = await JsonSerializer.DeserializeAsync(stream, PackageStateJsonContext.Default.PackageState, cancellationToken).ConfigureAwait(false);
            return state is { Name: PackageLayout.PackageName } ? state : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

[JsonSourceGenerationOptions(
    WriteIndented = true,
    IndentSize = 2,
    NewLine = "\n",
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(PackageState))]
internal sealed partial class PackageStateJsonContext : JsonSerializerContext;
