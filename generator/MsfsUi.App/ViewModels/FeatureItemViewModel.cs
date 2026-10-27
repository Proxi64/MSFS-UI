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

/// <summary>An option of a feature: a switch, a number with its range, step and unit, or radio buttons.</summary>
public sealed partial class OptionItemViewModel : ObservableObject
{
    private readonly Action _changed;

    public OptionItemViewModel(string featureId, OptionDefinition definition, Action changed)
    {
        Definition = definition;
        _changed = changed;
        AutomationId = $"Option_{featureId}_{definition.Id}";
        Choices = [.. (definition.Choices ?? []).Select(choice => new ChoiceItemViewModel(choice.Id, choice.Title, $"Choice_{featureId}_{definition.Id}_{choice.Id}"))];
    }

    public OptionDefinition Definition { get; }

    /// <summary>Stable id of the option's switch or number box for UI Automation (feature and option ids).</summary>
    public string AutomationId { get; }

    public string Title => Definition.Title;

    public string Description => Definition.Description;

    public bool IsBoolean => Definition.Type == OptionType.Boolean;

    public bool IsNumber => Definition.Type == OptionType.Number;

    public bool IsChoice => Definition.Type == OptionType.Choice;

    /// <summary>The choices of a choice option, in catalogue order (empty for the other types).</summary>
    public IReadOnlyList<ChoiceItemViewModel> Choices { get; }

    /// <summary>The explanation of the selected choice, if it has one.</summary>
    public string ChoiceDescription =>
        IsChoice && SelectedChoiceIndex >= 0 && SelectedChoiceIndex < Choices.Count
            ? Definition.Choices![SelectedChoiceIndex].Description ?? string.Empty
            : string.Empty;

    public string Unit => Definition.Unit ?? string.Empty;

    public double Minimum => Definition.Min ?? double.MinValue;

    public double Maximum => Definition.Max ?? double.MaxValue;

    /// <summary>Change of one click on the number's arrows: its step, or 1.</summary>
    public double Step => Definition.Step ?? 1;

    [ObservableProperty]
    public partial bool BoolValue { get; set; }

    [ObservableProperty]
    public partial double NumberValue { get; set; }

    /// <summary>Index of the selected choice in <see cref="Choices"/>.</summary>
    [ObservableProperty]
    public partial int SelectedChoiceIndex { get; set; }

    public void Load(OptionValue value)
    {
        if (IsBoolean)
        {
            BoolValue = value.Boolean;
        }
        else if (IsChoice)
        {
            SelectedChoiceIndex = IndexOfChoice(value.Text) is var index and >= 0 ? index : IndexOfChoice(Definition.DefaultValue.Text);
        }
        else
        {
            NumberValue = value.Number;
        }
    }

    /// <summary>
    /// The value shown; a number is brought into range and onto its step, an empty box takes the default, and so does
    /// a choice when none is selected.
    /// </summary>
    public OptionChoice ToChoice()
    {
        if (IsBoolean)
        {
            return new OptionChoice(Definition.Id, OptionValue.FromBoolean(BoolValue));
        }

        if (IsChoice)
        {
            var selected = SelectedChoiceIndex >= 0 && SelectedChoiceIndex < Choices.Count ? OptionValue.FromChoice(Choices[SelectedChoiceIndex].Id) : Definition.DefaultValue;
            return new OptionChoice(Definition.Id, selected);
        }

        var number = double.IsNaN(NumberValue) ? Definition.DefaultValue.Number : NumberValue;
        return new OptionChoice(Definition.Id, OptionValue.FromNumber(SettingsNormalizer.Constrain(Definition, number)));
    }

    partial void OnBoolValueChanged(bool value) => _changed();

    partial void OnNumberValueChanged(double value) => _changed();

    partial void OnSelectedChoiceIndexChanged(int value)
    {
        OnPropertyChanged(nameof(ChoiceDescription));
        _changed();
    }

    private int IndexOfChoice(string id)
    {
        for (var index = 0; index < Choices.Count; index++)
        {
            if (string.Equals(Choices[index].Id, id, StringComparison.Ordinal))
            {
                return index;
            }
        }

        return -1;
    }
}

/// <summary>A choice of a choice option, as a radio button.</summary>
/// <param name="Id">The choice's id in the catalogue.</param>
/// <param name="Title">Its title.</param>
/// <param name="AutomationId">Stable id of its radio button for UI Automation (feature, option and choice ids).</param>
public sealed record ChoiceItemViewModel(string Id, string Title, string AutomationId);
