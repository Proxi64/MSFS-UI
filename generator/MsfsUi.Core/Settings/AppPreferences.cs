using System.Text.Json;
using System.Text.Json.Serialization;
using MsfsUi.Core.Sim;

namespace MsfsUi.Core.Settings;

/// <summary>The app's colour theme, when chosen in the app.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<AppTheme>))]
public enum AppTheme
{
    /// <summary>Light theme.</summary>
    [JsonStringEnumMemberName("light")]
    Light,

    /// <summary>Dark theme.</summary>
    [JsonStringEnumMemberName("dark")]
    Dark,
}

/// <summary>
/// The app's own preferences (<c>app.json</c>), apart from the mod's settings: the folders chosen by hand when the
/// sim is not found, or not where the detection looks, and the colour theme.
/// </summary>
/// <param name="CommunityPath">Community folder to use instead of the detected one, or null.</param>
/// <param name="FsBaseUiPath"><c>fs-base-ui</c> folder to use instead of the detected one, or null.</param>
/// <param name="Theme">Theme chosen in the app, or null to follow Windows.</param>
public sealed record AppPreferences(string? CommunityPath = null, string? FsBaseUiPath = null, AppTheme? Theme = null)
{
    /// <summary>No preference: the sim is detected, the theme follows Windows.</summary>
    public static AppPreferences Default { get; } = new();

    /// <summary>Whether a folder was chosen by hand.</summary>
    [JsonIgnore]
    public bool HasManualFolders => !string.IsNullOrWhiteSpace(CommunityPath) || !string.IsNullOrWhiteSpace(FsBaseUiPath);

    /// <summary>The folders as options of <see cref="SimLocator"/>.</summary>
    public SimLocatorOptions ToLocatorOptions() => new() { CommunityPath = CommunityPath, FsBaseUiPath = FsBaseUiPath };

    /// <summary>Serialises the preferences.</summary>
    public string ToJson() => JsonSerializer.Serialize(this, SettingsJsonContext.Default.AppPreferences) + "\n";

    /// <summary>Reads preferences; null if the JSON is unreadable.</summary>
    public static AppPreferences? TryParse(string json)
    {
        try
        {
            return JsonSerializer.Deserialize(json, SettingsJsonContext.Default.AppPreferences);
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
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    ReadCommentHandling = JsonCommentHandling.Skip,
    AllowTrailingCommas = true)]
[JsonSerializable(typeof(AppPreferences))]
internal sealed partial class SettingsJsonContext : JsonSerializerContext;
