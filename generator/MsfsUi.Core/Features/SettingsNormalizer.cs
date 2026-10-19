using System.Text.Json;

namespace MsfsUi.Core.Features;

/// <summary>Result of <see cref="SettingsNormalizer.Normalize"/>.</summary>
/// <param name="Selection">A complete, valid selection.</param>
/// <param name="Adjustments">What was changed in the user's settings, for the log (dropped ids, clamped values…).</param>
/// <param name="FromNewerVersion">
/// The settings were saved by a newer MSFS-UI-GENERATOR (higher schema version). The selection is still usable, but the
/// caller must not overwrite the stored settings without the user's consent, or the newer choices would be lost.
/// </param>
public sealed record NormalizationResult(FeatureSelection Selection, IReadOnlyList<string> Adjustments, bool FromNewerVersion = false);

/// <summary>
/// Turns the user's stored settings into a complete selection valid for the catalogue (see Contracts in docs/development.md): unknown
/// features and options are dropped, missing ones take their defaults, numbers are snapped to their step and
/// clamped to their range, values of the wrong type are replaced by the default.
/// </summary>
public static class SettingsNormalizer
{
    /// <summary>Normalises <paramref name="settings"/> against <paramref name="catalog"/>.</summary>
    public static NormalizationResult Normalize(FeatureCatalog catalog, FeatureSettings? settings)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        settings ??= FeatureSettings.Empty;
        var adjustments = new List<string>();
        var fromNewerVersion = settings.SchemaVersion > FeatureSettings.CurrentSchemaVersion;
        if (fromNewerVersion)
        {
            adjustments.Add($"Settings were saved by a newer MSFS-UI-GENERATOR (schema {settings.SchemaVersion}); they are read as schema {FeatureSettings.CurrentSchemaVersion}.");
        }

        var stored = settings.Features ?? new Dictionary<string, FeatureSettingsEntry>(StringComparer.Ordinal);

        foreach (var unknown in stored.Keys.Where(id => catalog.Find(id) is null).Order(StringComparer.Ordinal))
        {
            adjustments.Add($"Unknown feature '{unknown}' dropped.");
        }

        var features = new List<FeatureChoice>(catalog.Features.Count);
        foreach (var feature in catalog.Features)
        {
            stored.TryGetValue(feature.Id, out var entry);
            var storedOptions = entry?.Options ?? new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var unknown in storedOptions.Keys.Where(id => feature.Options.All(option => option.Id != id)).Order(StringComparer.Ordinal))
            {
                adjustments.Add($"Unknown option '{feature.Id}.{unknown}' dropped.");
            }

            var options = feature.Options
                .Select(option => new OptionChoice(option.Id, Resolve(feature.Id, option, storedOptions, adjustments)))
                .ToList();
            features.Add(new FeatureChoice(feature.Id, entry?.Enabled ?? feature.EnabledByDefault, options));
        }

        return new NormalizationResult(new FeatureSelection(features), adjustments, fromNewerVersion);
    }

    /// <summary>
    /// Clamps a number to the option's range and snaps it to the option's step grid (counted from the minimum).
    /// When the range is not a whole number of steps, the highest value is the last grid point below the maximum,
    /// so the result is always both in range and on the grid.
    /// </summary>
    public static double Constrain(OptionDefinition option, double value)
    {
        ArgumentNullException.ThrowIfNull(option);
        var min = option.Min ?? double.MinValue;
        var max = option.Max ?? double.MaxValue;
        if (option is not { Step: { } step, Min: { } origin, Max: { } top })
        {
            return Math.Clamp(value, min, max);
        }

        var lastStep = Math.Floor(((top - origin) / step) + 1e-9);
        var index = Math.Clamp(Math.Round((value - origin) / step, MidpointRounding.AwayFromZero), 0, lastStep);
        return Math.Round(origin + (index * step), 10);
    }

    private static OptionValue Resolve(string featureId, OptionDefinition option, IReadOnlyDictionary<string, JsonElement> stored, List<string> adjustments)
    {
        if (!stored.TryGetValue(option.Id, out var raw))
        {
            return option.DefaultValue;
        }

        var name = $"{featureId}.{option.Id}";
        if (option.Type == OptionType.Boolean)
        {
            if (raw.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                return OptionValue.FromBoolean(raw.GetBoolean());
            }

            adjustments.Add($"Option '{name}' is not a boolean: default used.");
            return option.DefaultValue;
        }

        if (raw.ValueKind != JsonValueKind.Number || !raw.TryGetDouble(out var number) || !double.IsFinite(number))
        {
            adjustments.Add($"Option '{name}' is not a number: default used.");
            return option.DefaultValue;
        }

        var constrained = Constrain(option, number);
        if (constrained != number)
        {
            adjustments.Add($"Option '{name}' adjusted from {number} to {constrained} (range or step).");
        }

        return OptionValue.FromNumber(constrained);
    }
}
