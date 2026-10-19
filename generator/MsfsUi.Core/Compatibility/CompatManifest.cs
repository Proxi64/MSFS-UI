using System.Text.Json;
using System.Text.Json.Serialization;

namespace MsfsUi.Core.Compatibility;

/// <summary>
/// What the mod relies on in the sim (<c>mod/compat.json</c>, ADR-0001). The compatibility check runs
/// entirely from this file.
/// </summary>
public sealed record CompatManifest(
    int SchemaVersion,
    IReadOnlyList<ExportRequirement> Exports,
    IReadOnlyList<ScreenRequirement> Screens,
    IReadOnlyList<string> Anchors,
    IReadOnlyList<ComponentRequirement> Components,
    IReadOnlyList<ComponentPatternRequirement> ComponentPatterns,
    IReadOnlyList<SymbolGroup> Symbols,
    IReadOnlyList<string> Files,
    IReadOnlyList<string> ColorVariables,
    IReadOnlyList<string> Translations,
    IReadOnlyList<LiveCheckDefinition> LiveChecks)
{
    /// <summary>Format version understood by this code.</summary>
    public const int CurrentSchemaVersion = 1;

    /// <summary>Parses a manifest; missing lists are empty.</summary>
    /// <exception cref="MsfsUiException">The JSON is unreadable or of another schema version.</exception>
    public static CompatManifest Parse(string json)
    {
        CompatManifest? manifest;
        try
        {
            manifest = JsonSerializer.Deserialize(json, CompatJsonContext.Default.CompatManifest);
        }
        catch (JsonException ex)
        {
            throw new MsfsUiException($"The compatibility manifest is not valid JSON: {ex.Message}", ex);
        }

        if (manifest is null || manifest.SchemaVersion != CurrentSchemaVersion)
        {
            throw new MsfsUiException($"The compatibility manifest must have schema version {CurrentSchemaVersion}.");
        }

        return manifest with
        {
            Exports = manifest.Exports ?? [],
            Screens = manifest.Screens ?? [],
            Anchors = manifest.Anchors ?? [],
            Components = manifest.Components ?? [],
            ComponentPatterns = manifest.ComponentPatterns ?? [],
            Symbols = manifest.Symbols ?? [],
            Files = manifest.Files ?? [],
            ColorVariables = manifest.ColorVariables ?? [],
            Translations = manifest.Translations ?? [],
            LiveChecks = manifest.LiveChecks ?? [],
        };
    }
}

/// <summary>Readable exports a module of <c>html_ui/Global</c> must have.</summary>
/// <param name="Module">Module path under <c>html_ui/Global</c> (for example <c>shared/utils.js</c>).</param>
/// <param name="Names">Exported names.</param>
public sealed record ExportRequirement(string Module, IReadOnlyList<string> Names);

/// <summary>A screen the mod patches.</summary>
/// <param name="Label">Name shown in the results.</param>
/// <param name="ComponentGuid">Component GUID (<c>guid</c> in the JSON).</param>
/// <param name="ClassName">Manipulator class name.</param>
public sealed record ScreenRequirement(string Label, [property: JsonPropertyName("guid")] string ComponentGuid, string ClassName);

/// <summary>A component of the sim that the mod creates itself (<c>cookedcomps/{GUID}.html</c> and <c>.json</c>).</summary>
/// <param name="Label">Name shown in the results.</param>
/// <param name="ComponentGuid">Component GUID (<c>guid</c> in the JSON).</param>
/// <param name="Name">Name of the component's root element.</param>
/// <param name="Attributes">Exposed attributes the mod sets.</param>
/// <param name="States">Visual states the mod relies on.</param>
/// <param name="Values">Exposed values the mod reads (for example colours).</param>
/// <param name="Children">Names of elements inside the component that the mod's CSS adjusts (looked for in its own markup).</param>
public sealed record ComponentRequirement(
    string Label,
    [property: JsonPropertyName("guid")] string ComponentGuid,
    string Name,
    IReadOnlyList<string>? Attributes = null,
    IReadOnlyList<string>? States = null,
    IReadOnlyList<string>? Values = null,
    IReadOnlyList<string>? Children = null);

/// <summary>Regular expressions that one cooked component must all match.</summary>
/// <param name="Group">Result group.</param>
/// <param name="Label">Result label.</param>
/// <param name="Component">Text identifying the component (for example <c>name="PlaneSelection_Content"</c>).</param>
/// <param name="Patterns">Regular expressions (.NET syntax, compatible with the JavaScript ones of 0.3.0).</param>
/// <param name="Failure">Explanation when the check fails.</param>
public sealed record ComponentPatternRequirement(string Group, string Label, string Component, IReadOnlyList<string> Patterns, string Failure);

/// <summary>Names that must appear verbatim in the sim's scripts and styles.</summary>
/// <param name="Group">Result group.</param>
/// <param name="Names">Names, precise enough not to be found elsewhere.</param>
public sealed record SymbolGroup(string Group, IReadOnlyList<string> Names);

/// <summary>
/// A check run in the main menu page. <see cref="Run"/> is an ES2017 function receiving
/// <c>ctx = { store, engineUi, utils, flight, aircraft }</c> and returning <c>{ ok, detail }</c> or a promise of it.
/// </summary>
/// <param name="Group">Result group.</param>
/// <param name="Label">Result label.</param>
/// <param name="Run">JavaScript function source.</param>
/// <param name="TimeoutMs">Time allowed (3000 ms when absent).</param>
public sealed record LiveCheckDefinition(string Group, string Label, string Run, int? TimeoutMs = null);

/// <summary>One check result.</summary>
/// <param name="Group">Group, as displayed.</param>
/// <param name="Label">What was checked.</param>
/// <param name="Ok">Whether it passed.</param>
/// <param name="Detail">Extra information (the reason when it failed).</param>
public sealed record CheckResult(string Group, string Label, bool Ok, string? Detail = null);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, ReadCommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true)]
[JsonSerializable(typeof(CompatManifest))]
[JsonSerializable(typeof(List<CheckResult>))]
[JsonSerializable(typeof(IReadOnlyList<ScreenRequirement>))]
[JsonSerializable(typeof(IReadOnlyList<string>))]
internal sealed partial class CompatJsonContext : JsonSerializerContext;
