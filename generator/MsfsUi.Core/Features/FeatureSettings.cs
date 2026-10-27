using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MsfsUi.Core.Features;

/// <summary>A typed option value: a boolean, a number or the id of a choice.</summary>
public readonly record struct OptionValue
{
    private OptionValue(OptionType type, bool boolean, double number, string text)
    {
        Type = type;
        Boolean = boolean;
        Number = number;
        Text = text;
    }

    /// <summary>Type of the value.</summary>
    public OptionType Type { get; }

    /// <summary>The value of a boolean option.</summary>
    public bool Boolean { get; }

    /// <summary>The value of a number option.</summary>
    public double Number { get; }

    /// <summary>The id of the choice of a choice option; empty for the other types.</summary>
    public string Text { get; }

    /// <summary>A boolean value.</summary>
    public static OptionValue FromBoolean(bool value) => new(OptionType.Boolean, value, 0, string.Empty);

    /// <summary>A number value.</summary>
    public static OptionValue FromNumber(double value) => new(OptionType.Number, false, value, string.Empty);

    /// <summary>The value of a choice option: the id of the choice.</summary>
    public static OptionValue FromChoice(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        return new(OptionType.Choice, false, 0, id);
    }

    /// <inheritdoc />
    public override string ToString() => Type switch
    {
        OptionType.Boolean => Boolean ? "true" : "false",
        OptionType.Choice => Text,
        _ => Number.ToString(CultureInfo.InvariantCulture),
    };
}

/// <summary>
/// The user's choices as stored by the app (<c>%LOCALAPPDATA%\MSFS-UI-GENERATOR\settings.json</c>). They may be partial or
/// out of date: <see cref="SettingsNormalizer"/> turns them into a complete <see cref="FeatureSelection"/>.
/// </summary>
/// <param name="SchemaVersion">Settings format version.</param>
/// <param name="Features">Choices per feature id.</param>
public sealed record FeatureSettings(int SchemaVersion, IReadOnlyDictionary<string, FeatureSettingsEntry> Features)
{
    /// <summary>Settings format version written by this code.</summary>
    public const int CurrentSchemaVersion = 1;

    /// <summary>No choice made yet: every feature takes its defaults.</summary>
    public static FeatureSettings Empty { get; } = new(CurrentSchemaVersion, new Dictionary<string, FeatureSettingsEntry>(StringComparer.Ordinal));

    /// <summary>Serialises the settings.</summary>
    public string ToJson() => JsonSerializer.Serialize(this, FeatureJsonContext.Default.FeatureSettings);

    /// <summary>Reads settings; null if the JSON is unreadable.</summary>
    public static FeatureSettings? TryParse(string json)
    {
        try
        {
            return JsonSerializer.Deserialize(json, FeatureJsonContext.Default.FeatureSettings);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>The user's choices for one feature.</summary>
/// <param name="Enabled">Whether the feature is on; null keeps the catalogue default.</param>
/// <param name="Options">Option values by option id; missing options keep their default.</param>
public sealed record FeatureSettingsEntry(bool? Enabled, IReadOnlyDictionary<string, JsonElement>? Options);

/// <summary>A complete, valid choice for every feature of the catalogue, in catalogue order.</summary>
/// <param name="Features">One choice per catalogue feature.</param>
public sealed record FeatureSelection(IReadOnlyList<FeatureChoice> Features)
{
    /// <summary>The choice for this feature id, or null.</summary>
    public FeatureChoice? Find(string featureId) =>
        Features.FirstOrDefault(feature => string.Equals(feature.Id, featureId, StringComparison.Ordinal));

    /// <summary>The selection as settings to store.</summary>
    public FeatureSettings ToSettings()
    {
        var features = Features.ToDictionary(
            feature => feature.Id,
            feature => new FeatureSettingsEntry(
                feature.Enabled,
                feature.Options.ToDictionary(option => option.Id, option => ToJsonElement(option.Value), StringComparer.Ordinal)),
            StringComparer.Ordinal);
        return new FeatureSettings(FeatureSettings.CurrentSchemaVersion, features);
    }

    private static JsonElement ToJsonElement(OptionValue value) => value.Type switch
    {
        OptionType.Boolean => JsonSerializer.SerializeToElement(value.Boolean, FeatureJsonContext.Default.Boolean),
        OptionType.Choice => JsonSerializer.SerializeToElement(value.Text, FeatureJsonContext.Default.String),
        _ => JsonSerializer.SerializeToElement(value.Number, FeatureJsonContext.Default.Double),
    };
}

/// <summary>The choice for one feature.</summary>
/// <param name="Id">Feature id.</param>
/// <param name="Enabled">Whether the feature is on.</param>
/// <param name="Options">Every option of the feature with its value, in catalogue order.</param>
public sealed record FeatureChoice(string Id, bool Enabled, IReadOnlyList<OptionChoice> Options);

/// <summary>The value chosen for one option.</summary>
/// <param name="Id">Option id.</param>
/// <param name="Value">Valid value (type, range and step checked).</param>
public sealed record OptionChoice(string Id, OptionValue Value);

[JsonSourceGenerationOptions(
    WriteIndented = true,
    IndentSize = 2,
    NewLine = "\n",
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    ReadCommentHandling = JsonCommentHandling.Skip,
    AllowTrailingCommas = true)]
[JsonSerializable(typeof(FeatureCatalog))]
[JsonSerializable(typeof(FeatureSettings))]
[JsonSerializable(typeof(bool))]
[JsonSerializable(typeof(double))]
[JsonSerializable(typeof(string))]
internal sealed partial class FeatureJsonContext : JsonSerializerContext;
