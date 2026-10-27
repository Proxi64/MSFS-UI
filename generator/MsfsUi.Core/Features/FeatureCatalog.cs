using System.Text.Json;
using System.Text.Json.Serialization;

namespace MsfsUi.Core.Features;

/// <summary>Type of a feature option.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<OptionType>))]
public enum OptionType
{
    /// <summary>On or off.</summary>
    [JsonStringEnumMemberName("boolean")]
    Boolean,

    /// <summary>A number within <c>min</c> and <c>max</c>, on a <c>step</c> grid when given.</summary>
    [JsonStringEnumMemberName("number")]
    Number,

    /// <summary>One of the option's <c>choices</c>, stored as its id.</summary>
    [JsonStringEnumMemberName("choice")]
    Choice,
}

/// <summary>
/// The feature catalogue (<c>mod/features.json</c>): every feature of the mod with its options and defaults.
/// Shared by the mod build and the app (see Contracts in docs/development.md).
/// </summary>
/// <param name="SchemaVersion">Catalogue format version; this code reads <see cref="CurrentSchemaVersion"/>.</param>
/// <param name="ModVersion">Version of the mod the catalogue belongs to.</param>
/// <param name="Features">Features, in display order.</param>
public sealed record FeatureCatalog(int SchemaVersion, string ModVersion, IReadOnlyList<FeatureDefinition> Features)
{
    /// <summary>Catalogue format version understood by this code.</summary>
    public const int CurrentSchemaVersion = 1;

    /// <summary>Parses and validates a catalogue.</summary>
    /// <exception cref="InvalidFeatureCatalogException">The JSON is unreadable or the catalogue is inconsistent.</exception>
    public static FeatureCatalog Parse(string json)
    {
        FeatureCatalog? catalog;
        try
        {
            catalog = JsonSerializer.Deserialize(json, FeatureJsonContext.Default.FeatureCatalog);
        }
        catch (JsonException ex)
        {
            throw new InvalidFeatureCatalogException($"The feature catalogue is not valid JSON: {ex.Message}", ex);
        }

        if (catalog is null)
        {
            throw new InvalidFeatureCatalogException("The feature catalogue is empty.");
        }

        if (catalog.Features is null || catalog.Features.Any(feature => feature is null))
        {
            throw new InvalidFeatureCatalogException("The feature catalogue has a missing or null feature list entry.");
        }

        // A feature without an "options" key has no options.
        catalog = catalog with
        {
            Features = [.. catalog.Features.Select(feature => feature.Options is null ? feature with { Options = [] } : feature)],
        };
        catalog.Validate();
        return catalog;
    }

    /// <summary>The feature with this id, or null.</summary>
    public FeatureDefinition? Find(string featureId) =>
        Features.FirstOrDefault(feature => string.Equals(feature.Id, featureId, StringComparison.Ordinal));

    private void Validate()
    {
        if (SchemaVersion != CurrentSchemaVersion)
        {
            throw new InvalidFeatureCatalogException(
                $"The feature catalogue has schema version {SchemaVersion}; this version of MSFS-UI-GENERATOR reads version {CurrentSchemaVersion}.");
        }

        if (Features.Count == 0)
        {
            throw new InvalidFeatureCatalogException("The feature catalogue lists no feature.");
        }

        RequireUnique(Features.Select(feature => feature.Id), "feature");
        foreach (var feature in Features)
        {
            if (string.IsNullOrWhiteSpace(feature.Id) || string.IsNullOrWhiteSpace(feature.Title))
            {
                throw new InvalidFeatureCatalogException("Every feature needs an id and a title.");
            }

            if (feature.Options.Any(option => option is null))
            {
                throw new InvalidFeatureCatalogException($"Feature '{feature.Id}' has a null option entry.");
            }

            RequireUnique(feature.Options.Select(option => option.Id), $"option of feature '{feature.Id}'");
            foreach (var option in feature.Options)
            {
                option.Validate(feature.Id);
            }
        }
    }

    private static void RequireUnique(IEnumerable<string> ids, string kind)
    {
        var duplicate = ids.GroupBy(id => id, StringComparer.Ordinal).FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
        {
            throw new InvalidFeatureCatalogException($"Duplicate {kind} id '{duplicate.Key}' in the feature catalogue.");
        }
    }
}

/// <summary>A feature of the mod.</summary>
/// <param name="Id">Identifier used in <c>config.js</c> and in the mod (for example <c>weatherBar</c>).</param>
/// <param name="Title">Short title shown in the app.</param>
/// <param name="Description">One or two sentences shown under the title.</param>
/// <param name="Screen">Where the feature acts in the sim (for example <c>Free Flight</c>).</param>
/// <param name="EnabledByDefault">Whether the feature is on until the user changes it.</param>
/// <param name="Options">Options of the feature, in display order (may be empty).</param>
public sealed record FeatureDefinition(
    string Id,
    string Title,
    string Description,
    string Screen,
    bool EnabledByDefault,
    IReadOnlyList<OptionDefinition> Options);

/// <summary>An option of a feature.</summary>
/// <param name="Id">Identifier used in <c>config.js</c> and in the mod.</param>
/// <param name="Type">Boolean or number.</param>
/// <param name="Title">Short title shown in the app.</param>
/// <param name="Description">Explanation shown in the app.</param>
/// <param name="Default">Default value, of the option's type (a choice's id for a choice).</param>
/// <param name="Min">Lowest value (numbers only).</param>
/// <param name="Max">Highest value (numbers only).</param>
/// <param name="Step">Granularity, counted from <see cref="Min"/> (numbers only, optional).</param>
/// <param name="Unit">Unit shown next to the value (numbers only, optional).</param>
/// <param name="Choices">The choices, in display order (choices only, at least two).</param>
public sealed record OptionDefinition(
    string Id,
    OptionType Type,
    string Title,
    string Description,
    JsonElement Default,
    double? Min = null,
    double? Max = null,
    double? Step = null,
    string? Unit = null,
    IReadOnlyList<ChoiceDefinition>? Choices = null)
{
    /// <summary>The default value, typed.</summary>
    public OptionValue DefaultValue => Type switch
    {
        OptionType.Boolean => OptionValue.FromBoolean(Default.GetBoolean()),
        OptionType.Choice => OptionValue.FromChoice(Default.GetString() ?? string.Empty),
        _ => OptionValue.FromNumber(Default.GetDouble()),
    };

    internal void Validate(string featureId)
    {
        var where = $"option '{featureId}.{Id}'";
        if (string.IsNullOrWhiteSpace(Id) || string.IsNullOrWhiteSpace(Title))
        {
            throw new InvalidFeatureCatalogException($"Every option needs an id and a title (feature '{featureId}').");
        }

        if (Type == OptionType.Choice)
        {
            ValidateChoices(where);
            return;
        }

        if (Type == OptionType.Boolean)
        {
            if (Default.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                throw new InvalidFeatureCatalogException($"The default of {where} must be true or false.");
            }

            return;
        }

        if (Default.ValueKind != JsonValueKind.Number || Min is null || Max is null)
        {
            throw new InvalidFeatureCatalogException($"The number {where} needs a numeric default, a min and a max.");
        }

        if (Min > Max || Step is <= 0)
        {
            throw new InvalidFeatureCatalogException($"The number {where} has an invalid range or step.");
        }

        var value = Default.GetDouble();
        if (value < Min || value > Max)
        {
            throw new InvalidFeatureCatalogException($"The default of {where} is outside its range.");
        }

        if (Math.Abs(SettingsNormalizer.Constrain(this, value) - value) > 1e-9)
        {
            throw new InvalidFeatureCatalogException($"The default of {where} is not on its step grid.");
        }
    }

    private void ValidateChoices(string where)
    {
        if (Choices is not { Count: >= 2 })
        {
            throw new InvalidFeatureCatalogException($"The choice {where} needs at least two choices.");
        }

        if (Choices.Any(choice => choice is null || string.IsNullOrWhiteSpace(choice.Id) || string.IsNullOrWhiteSpace(choice.Title)))
        {
            throw new InvalidFeatureCatalogException($"Every choice of {where} needs an id and a title.");
        }

        var twice = Choices.GroupBy(choice => choice.Id, StringComparer.Ordinal).FirstOrDefault(group => group.Count() > 1);
        if (twice is not null)
        {
            throw new InvalidFeatureCatalogException($"The choice {where} lists choice '{twice.Key}' twice.");
        }

        if (Default.ValueKind != JsonValueKind.String || !HasChoice(Default.GetString()))
        {
            throw new InvalidFeatureCatalogException($"The default of {where} is not one of its choices.");
        }
    }

    /// <summary>Whether <paramref name="id"/> is the id of one of the choices.</summary>
    internal bool HasChoice(string? id) =>
        Choices is not null && Choices.Any(choice => string.Equals(choice.Id, id, StringComparison.Ordinal));
}

/// <summary>A choice of a choice option.</summary>
/// <param name="Id">Identifier stored in the settings and sent to the mod.</param>
/// <param name="Title">Short title shown in the app.</param>
/// <param name="Description">Explanation shown in the app when the choice is selected (optional).</param>
public sealed record ChoiceDefinition(string Id, string Title, string? Description = null);

/// <summary>The feature catalogue is unreadable or inconsistent (a defect of the build, not of the user).</summary>
public sealed class InvalidFeatureCatalogException : MsfsUiException
{
    /// <summary>Creates the exception.</summary>
    public InvalidFeatureCatalogException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with its cause.</summary>
    public InvalidFeatureCatalogException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>Creates the exception without a message.</summary>
    public InvalidFeatureCatalogException()
    {
    }
}
