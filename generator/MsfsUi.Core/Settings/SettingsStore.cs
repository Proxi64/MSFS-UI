using Microsoft.Extensions.Logging;
using MsfsUi.Core.Features;

namespace MsfsUi.Core.Settings;

/// <summary>The settings read from disk, and what went wrong if they could not be read.</summary>
/// <param name="Settings">The settings, or null when the file is missing or unreadable (the defaults apply).</param>
/// <param name="Problem">Why the file could not be read, or null.</param>
public sealed record SettingsLoad(FeatureSettings? Settings, string? Problem);

/// <summary>
/// Reads and writes the user's files under <see cref="AppPaths"/>: the mod's settings (<c>settings.json</c>) and the
/// app's preferences (<c>app.json</c>). Writes go through a temporary file, so that a crash never leaves half a file.
/// </summary>
public sealed partial class SettingsStore
{
    private readonly AppPaths _paths;
    private readonly ILogger<SettingsStore> _logger;

    /// <summary>Creates the store.</summary>
    public SettingsStore(AppPaths paths, ILogger<SettingsStore> logger)
    {
        _paths = paths;
        _logger = logger;
    }

    /// <summary>Reads the mod's settings. A missing file is not a problem; an unreadable one is reported.</summary>
    public async Task<SettingsLoad> LoadFeatureSettingsAsync(CancellationToken cancellationToken = default)
    {
        var text = await ReadAsync(_paths.SettingsFile, cancellationToken).ConfigureAwait(false);
        if (text is null)
        {
            return new SettingsLoad(null, null);
        }

        var settings = FeatureSettings.TryParse(text);
        if (settings is null)
        {
            LogUnreadable(_paths.SettingsFile);
            return new SettingsLoad(null, $"{_paths.SettingsFile} could not be read: the default settings apply until the next save.");
        }

        return new SettingsLoad(settings, null);
    }

    /// <summary>Writes the mod's settings.</summary>
    public Task SaveFeatureSettingsAsync(FeatureSettings settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return WriteAsync(_paths.SettingsFile, settings.ToJson() + "\n", cancellationToken);
    }

    /// <summary>Reads the app's preferences; the defaults when the file is missing or unreadable (logged).</summary>
    public async Task<AppPreferences> LoadPreferencesAsync(CancellationToken cancellationToken = default)
    {
        var text = await ReadAsync(_paths.PreferencesFile, cancellationToken).ConfigureAwait(false);
        if (text is null)
        {
            return AppPreferences.Default;
        }

        var preferences = AppPreferences.TryParse(text);
        if (preferences is null)
        {
            LogUnreadable(_paths.PreferencesFile);
        }

        return preferences ?? AppPreferences.Default;
    }

    /// <summary>Writes the app's preferences.</summary>
    public Task SavePreferencesAsync(AppPreferences preferences, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        return WriteAsync(_paths.PreferencesFile, preferences.ToJson(), cancellationToken);
    }

    private static async Task<string?> ReadAsync(string file, CancellationToken cancellationToken)
    {
        if (!File.Exists(file))
        {
            return null;
        }

        return await File.ReadAllTextAsync(file, cancellationToken).ConfigureAwait(false);
    }

    private async Task WriteAsync(string file, string content, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temporary = file + ".tmp";
        await File.WriteAllTextAsync(temporary, content, cancellationToken).ConfigureAwait(false);
        File.Move(temporary, file, overwrite: true);
        LogSaved(file);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "{File} could not be read: defaults used")]
    private partial void LogUnreadable(string file);

    [LoggerMessage(Level = LogLevel.Information, Message = "Saved {File}")]
    private partial void LogSaved(string file);
}
