using CommunityToolkit.Mvvm.ComponentModel;
using MsfsUi.Core.Features;

namespace MsfsUi.App.ViewModels;

/// <summary>A feature of the catalogue on the Features page: on or off, and its options.</summary>
public sealed partial class FeatureItemViewModel : ObservableObject
{
    private readonly Action _changed;

    public FeatureItemViewModel(FeatureDefinition definition, Action changed)
    {
        Definition = definition;
        _changed = changed;
        Options = [.. definition.Options.Select(option => new OptionItemViewModel(definition.Id, option, changed))];
    }

    public FeatureDefinition Definition { get; }

    /// <summary>Stable id of the feature's card for UI Automation (from the catalogue's id).</summary>
    public string AutomationId => $"Feature_{Definition.Id}";

    /// <summary>Stable id of the feature's switch for UI Automation.</summary>
    public string SwitchAutomationId => $"FeatureSwitch_{Definition.Id}";

    public string Title => Definition.Title;

    public string Description => Definition.Description;

    /// <summary>Where the feature acts in the sim.</summary>
    public string Screen => Definition.Screen;

    public IReadOnlyList<OptionItemViewModel> Options { get; }

    public bool HasOptions => Options.Count > 0;

    public bool HasNoOptions => Options.Count == 0;

    [ObservableProperty]
    public partial bool IsEnabled { get; set; }

    /// <summary>Shows a stored choice.</summary>
    public void Load(FeatureChoice choice)
    {
        IsEnabled = choice.Enabled;
        foreach (var option in Options)
        {
            var stored = choice.Options.FirstOrDefault(candidate => candidate.Id == option.Definition.Id);
            option.Load(stored?.Value ?? option.Definition.DefaultValue);
        }
    }

    /// <summary>The choice shown, valid (numbers in range and on their step).</summary>
    public FeatureChoice ToChoice() => new(Definition.Id, IsEnabled, [.. Options.Select(option => option.ToChoice())]);

    partial void OnIsEnabledChanged(bool value) => _changed();
}

/// <summary>An option of a feature: a switch, or a number with its range, step and unit.</summary>
public sealed partial class OptionItemViewModel : ObservableObject
{
    private readonly Action _changed;

    public OptionItemViewModel(string featureId, OptionDefinition definition, Action changed)
    {
        Definition = definition;
        _changed = changed;
        AutomationId = $"Option_{featureId}_{definition.Id}";
    }

    public OptionDefinition Definition { get; }

    /// <summary>Stable id of the option's switch or number box for UI Automation (feature and option ids).</summary>
    public string AutomationId { get; }

    public string Title => Definition.Title;

    public string Description => Definition.Description;

    public bool IsBoolean => Definition.Type == OptionType.Boolean;

    public bool IsNumber => Definition.Type == OptionType.Number;

    public string Unit => Definition.Unit ?? string.Empty;

    public double Minimum => Definition.Min ?? double.MinValue;

    public double Maximum => Definition.Max ?? double.MaxValue;

    /// <summary>Change of one click on the number's arrows: its step, or 1.</summary>
    public double Step => Definition.Step ?? 1;

    [ObservableProperty]
    public partial bool BoolValue { get; set; }

    [ObservableProperty]
    public partial double NumberValue { get; set; }

    public void Load(OptionValue value)
    {
        if (IsBoolean)
        {
            BoolValue = value.Boolean;
        }
        else
        {
            NumberValue = value.Number;
        }
    }

    /// <summary>The value shown; a number is brought into range and onto its step, an empty box takes the default.</summary>
    public OptionChoice ToChoice()
    {
        if (IsBoolean)
        {
            return new OptionChoice(Definition.Id, OptionValue.FromBoolean(BoolValue));
        }

        var number = double.IsNaN(NumberValue) ? Definition.DefaultValue.Number : NumberValue;
        return new OptionChoice(Definition.Id, OptionValue.FromNumber(SettingsNormalizer.Constrain(Definition, number)));
    }

    partial void OnBoolValueChanged(bool value) => _changed();

    partial void OnNumberValueChanged(double value) => _changed();
}
