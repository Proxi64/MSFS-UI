using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MsfsUi.Core.Packaging;

/// <summary>One file listed in <c>layout.json</c>.</summary>
/// <param name="Path">Package-relative path, with forward slashes.</param>
/// <param name="Size">Size in bytes.</param>
/// <param name="FileTime">Last write time as a Windows FILETIME (100 ns intervals since 1601-01-01 UTC).</param>
public sealed record LayoutEntry(string Path, long Size, long FileTime);

/// <summary>
/// Text of the two files every package needs: <c>layout.json</c> and <c>manifest.json</c>. Both are formatted
/// exactly like MSFS-UI 0.3.0 wrote them (two-space indent, LF line endings, final newline).
/// </summary>
public static class SimPackageFiles
{
    /// <summary>Title of the package in the sim's content manager.</summary>
    public const string ManifestTitle = "MSFS-UI (personal)";

    /// <summary>Creator shown in the sim's content manager.</summary>
    public const string ManifestCreator = "Proxi64";

    /// <summary><c>layout.json</c>: every entry, in the given order (the caller sorts them by path).</summary>
    public static string FormatLayout(IEnumerable<LayoutEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        var items = entries.Select(entry =>
            "    {\n"
            + $"      \"path\": {JsonString(entry.Path)},\n"
            + $"      \"size\": {entry.Size.ToString(CultureInfo.InvariantCulture)},\n"
            + $"      \"date\": {entry.FileTime.ToString(CultureInfo.InvariantCulture)}\n"
            + "    }");
        return "{\n  \"content\": [\n" + string.Join(",\n", items) + "\n  ]\n}\n";
    }

    /// <summary><c>manifest.json</c> for the given package version and total size of the listed files.</summary>
    public static string FormatManifest(string version, long totalSize)
    {
        ArgumentNullException.ThrowIfNull(version);
        var manifest = new PackageManifest(
            Dependencies: [],
            ContentType: "MISC",
            Title: ManifestTitle,
            Manufacturer: string.Empty,
            Creator: ManifestCreator,
            PackageVersion: version,
            MinimumGameVersion: "1.2.0",
            ReleaseNotes: new ReleaseNotes(new ReleaseNotesText(string.Empty, string.Empty)),
            TotalPackageSize: totalSize.ToString("D20", CultureInfo.InvariantCulture));
        return JsonSerializer.Serialize(manifest, SimPackageJsonContext.Default.PackageManifest) + "\n";
    }

    /// <summary>UTF-8 without byte order mark, as the sim and the 0.3.0 tool expect.</summary>
    internal static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    /// <summary>
    /// A JSON string literal escaped like JavaScript's <c>JSON.stringify</c>: only quotes, backslashes and control
    /// characters (System.Text.Json's default encoder would also escape characters such as <c>+</c>).
    /// </summary>
    internal static string JsonString(string value)
    {
        var builder = new StringBuilder(value.Length + 2).Append('"');
        foreach (var c in value)
        {
            switch (c)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (c < ' ')
                    {
                        builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        builder.Append(c);
                    }

                    break;
            }
        }

        return builder.Append('"').ToString();
    }
}

internal sealed record PackageManifest(
    [property: JsonPropertyName("dependencies")] IReadOnlyList<string> Dependencies,
    [property: JsonPropertyName("content_type")] string ContentType,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("manufacturer")] string Manufacturer,
    [property: JsonPropertyName("creator")] string Creator,
    [property: JsonPropertyName("package_version")] string PackageVersion,
    [property: JsonPropertyName("minimum_game_version")] string MinimumGameVersion,
    [property: JsonPropertyName("release_notes")] ReleaseNotes ReleaseNotes,
    [property: JsonPropertyName("total_package_size")] string TotalPackageSize);

internal sealed record ReleaseNotes([property: JsonPropertyName("neutral")] ReleaseNotesText Neutral);

internal sealed record ReleaseNotesText(
    [property: JsonPropertyName("LastUpdate")] string LastUpdate,
    [property: JsonPropertyName("OlderHistory")] string OlderHistory);

[JsonSourceGenerationOptions(WriteIndented = true, IndentSize = 2, NewLine = "\n")]
[JsonSerializable(typeof(PackageManifest))]
internal sealed partial class SimPackageJsonContext : JsonSerializerContext;
