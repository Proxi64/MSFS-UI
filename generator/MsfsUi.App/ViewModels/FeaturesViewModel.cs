using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Xaml.Controls;
using MsfsUi.App.Services;
using MsfsUi.Core;
using MsfsUi.Core.Coherent;
using MsfsUi.Core.Features;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Settings;

namespace MsfsUi.App.ViewModels;

/// <summary>
/// Features: every feature of the embedded catalogue, on or off, with its options. Apply saves the choices and, when
/// the package is installed, generates it again (only <c>config.js</c> changes) and reloads the mod in the running
/// sim. Kept for the app's lifetime, so that unapplied changes survive a visit to another page.
/// </summary>
public sealed partial class FeaturesViewModel : ObservableObject
{
    private readonly ModResources _mod;
    private readonly SettingsStore _store;
    private readonly PackageInstaller _installer;
    private readonly CoherentInspector _inspector;
    private readonly SimSession _session;
    private readonly IDialogService _dialogs;
    private readonly ILogger<FeaturesViewModel> _logger;

    /// <summary>The choices as saved, to tell what changed.</summary>
    private string _savedJson = string.Empty;
    private bool _loading;

    /// <summary>
    /// The saved settings come from a newer MSFS-UI-GENERATOR: applying here would drop what only that version knows,
    /// so Apply asks first.
    /// </summary>
    private bool _savedByNewerVersion;

    public FeaturesViewModel(ModResources mod, SettingsStore store, PackageInstaller installer, CoherentInspector inspector, SimSession session, IDialogService dialogs, ILogger<FeaturesViewModel> logger)
    {
        _mod = mod;
        _store = store;
        _installer = installer;
        _inspector = inspector;
        _session = session;
        _dialogs = dialogs;
        _logger = logger;
        Features = [.. mod.Catalog.Features.Select(feature => new FeatureItemViewModel(feature, OnChoiceChanged))];
        // Apply updates the package: not while Home installs or removes it. (Both live as long as the app.)
        _session.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SimSession.PackageOperation))
            {
                ApplyCommand.NotifyCanExecuteChanged();
            }
        };
    }

    public IReadOnlyList<FeatureItemViewModel> Features { get; }

    /// <summary>The choices shown differ from the saved ones.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ApplyCommand), nameof(DiscardCommand))]
    public partial bool HasChanges { get; private set; }

    /// <summary>The choices shown differ from the catalogue's defaults.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ResetCommand))]
    public partial bool DiffersFromDefaults { get; private set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ApplyCommand), nameof(DiscardCommand), nameof(ResetCommand))]
    public partial bool IsBusy { get; private set; }

    [ObservableProperty]
    public partial bool IsMessageOpen { get; set; }

    [ObservableProperty]
    public partial string MessageTitle { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial string MessageText { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial InfoBarSeverity MessageSeverity { get; private set; }

    /// <summary>
    /// Shows the saved choices, unless changes are pending (they are kept until applied or discarded). Called when
    /// the page opens.
    /// </summary>
    public async Task LoadAsync()
    {
        if (HasChanges || IsBusy)
        {
            return;
        }

        SettingsLoad load;
        try
        {
            load = await _store.LoadFeatureSettingsAsync();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Shown with the defaults; Apply writes the file again.
            load = new SettingsLoad(null, ex.Message);
        }

        var normalized = SettingsNormalizer.Normalize(_mod.Catalog, load.Settings);
        Show(normalized.Selection);
        _savedJson = Json(normalized.Selection);
        _savedByNewerVersion = normalized.FromNewerVersion;
        Refresh();
        if (load.Problem is not null)
        {
            ShowMessage(InfoBarSeverity.Warning, Strings.Get("FeaturesSettingsUnreadable"), load.Problem);
        }
        else if (normalized.FromNewerVersion)
        {
            ShowMessage(InfoBarSeverity.Warning, Strings.Get("FeaturesSettingsNewer"), Strings.Get("FeaturesSettingsNewerDetail"));
        }
        else if (normalized.Adjustments.Count > 0)
        {
            ShowMessage(InfoBarSeverity.Informational, Strings.Get("FeaturesSettingsAdjusted"), string.Join(Environment.NewLine, normalized.Adjustments));
        }
    }

    private bool CanApply() => HasChanges && !IsBusy && _session.PackageOperation is null;

    private bool CanDiscard() => HasChanges && !IsBusy;

    private bool CanReset() => DiffersFromDefaults && !IsBusy;

    /// <summary>Saves the choices, then updates the installed package and the mod in the running sim.</summary>
    [RelayCommand(CanExecute = nameof(CanApply))]
    private async Task ApplyAsync()
    {
        // The stored settings of a newer version are only replaced with the user's consent.
        if (_savedByNewerVersion
            && !await _dialogs.ConfirmAsync(Strings.Get("FeaturesNewerConfirmTitle"), Strings.Get("FeaturesNewerConfirmMessage"), Strings.Get("FeaturesNewerConfirm")))
        {
            return;
        }

        IsBusy = true;
        IsMessageOpen = false;
        try
        {
            var selection = Selection();
            await _store.SaveFeatureSettingsAsync(selection.ToSettings());
            _savedJson = Json(selection);
            _savedByNewerVersion = false;
            // The values are shown as saved (numbers brought into range and onto their step).
            Show(selection);
            Refresh();
            LogApplied();
            await UpdatePackageAsync(selection);
        }
        catch (Exception ex) when (ex is MsfsUiException or IOException or UnauthorizedAccessException)
        {
            LogApplyFailed(ex);
            ShowMessage(InfoBarSeverity.Error, Strings.Get("FeaturesApplyFailed"), ex.Message);
        }
        finally
        {
            await _session.RefreshAsync(locate: false);
            IsBusy = false;
        }
    }

    /// <summary>Goes back to the saved choices.</summary>
    [RelayCommand(CanExecute = nameof(CanDiscard))]
    private async Task DiscardAsync()
    {
        HasChanges = false;
        IsMessageOpen = false;
        await LoadAsync();
    }

    /// <summary>Shows the catalogue's defaults; they are saved by Apply.</summary>
    [RelayCommand(CanExecute = nameof(CanReset))]
    private void Reset()
    {
        Show(SettingsNormalizer.Normalize(_mod.Catalog, null).Selection);
        Refresh();
    }

    /// <summary>The package follows the saved choices: generated again when installed, the mod reloaded when the sim runs.</summary>
    private async Task UpdatePackageAsync(FeatureSelection selection)
    {
        var sim = _session.Sim;
        if (sim is null || _session.Status?.Kind is not (PackageStatusKind.UpToDate or PackageStatusKind.UpdateNeeded))
        {
            ShowMessage(InfoBarSeverity.Success, Strings.Get("FeaturesSaved"), Strings.Get("FeaturesSavedNotInstalled"));
            return;
        }

        // An installation of the session: Home offers none meanwhile (the installer also runs them one at a time).
        using var operation = _session.BeginPackageOperation(Strings.Get("FeaturesBusyApply"));
        var result = await _installer.InstallAsync(sim, PackageInputs.ForMod(_mod.Catalog, _mod.ModScript, selection));
        switch (result.NextStep)
        {
            case NextStep.ReloadMod:
                // The package is updated whatever happens here: a failed reload is a warning, not a failed Apply.
                string? reloadError;
                try
                {
                    var reload = await _inspector.ReloadModAsync();
                    reloadError = reload.Ok ? null : reload.Error ?? string.Empty;
                }
                catch (InspectorUnavailableException ex)
                {
                    LogReloadFailed(ex);
                    reloadError = ex.Message;
                }

                if (reloadError is null)
                {
                    ShowMessage(InfoBarSeverity.Success, Strings.Get("FeaturesApplied"), Strings.Get("FeaturesAppliedReloaded"));
                }
                else
                {
                    ShowMessage(InfoBarSeverity.Warning, Strings.Get("FeaturesApplied"), Strings.Format("FeaturesAppliedReloadFailed", reloadError));
                }

                break;
            case NextStep.RestartSim:
                ShowMessage(InfoBarSeverity.Warning, Strings.Get("FeaturesApplied"), Strings.Get("FeaturesAppliedRestart"));
                break;
            default:
                ShowMessage(InfoBarSeverity.Success, Strings.Get("FeaturesApplied"), Strings.Get("FeaturesAppliedNextStart"));
                break;
        }
    }

    private FeatureSelection Selection() => new([.. Features.Select(feature => feature.ToChoice())]);

    private void Show(FeatureSelection selection)
    {
        _loading = true;
        try
        {
            foreach (var feature in Features)
            {
                var choice = selection.Find(feature.Definition.Id);
                if (choice is not null)
                {
                    feature.Load(choice);
                }
            }
        }
        finally
        {
            _loading = false;
        }
    }

    private void OnChoiceChanged()
    {
        if (!_loading)
        {
            Refresh();
        }
    }

    private void Refresh()
    {
        var shown = Json(Selection());
        HasChanges = shown != _savedJson;
        DiffersFromDefaults = shown != Json(SettingsNormalizer.Normalize(_mod.Catalog, null).Selection);
    }

    private static string Json(FeatureSelection selection) => selection.ToSettings().ToJson();

    private void ShowMessage(InfoBarSeverity severity, string title, string text)
    {
        MessageSeverity = severity;
        MessageTitle = title;
        MessageText = text;
        IsMessageOpen = true;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Feature settings saved")]
    private partial void LogApplied();

    [LoggerMessage(Level = LogLevel.Error, Message = "The feature settings could not be applied")]
    private partial void LogApplyFailed(Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Settings applied, but the mod could not be reloaded in the sim")]
    private partial void LogReloadFailed(Exception exception);
}
