using System.ComponentModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Xaml.Controls;
using MsfsUi.App.Services;
using MsfsUi.Core;
using MsfsUi.Core.Coherent;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Settings;
using MsfsUi.Core.Sim;

namespace MsfsUi.App.ViewModels;

/// <summary>
/// Home: the sim found, the package in Community and its actions (generate and install, reload in the sim, remove),
/// and the folders chosen by hand when the sim is not found.
/// </summary>
public sealed partial class HomeViewModel : ObservableObject, IDisposable
{
    private readonly SimSession _session;
    private readonly PackageInstaller _installer;
    private readonly CoherentInspector _inspector;
    private readonly SettingsStore _store;
    private readonly IDialogService _dialogs;
    private readonly ILogger<HomeViewModel> _logger;

    public HomeViewModel(SimSession session, PackageInstaller installer, CoherentInspector inspector, SettingsStore store, IDialogService dialogs, ILogger<HomeViewModel> logger)
    {
        _session = session;
        _installer = installer;
        _inspector = inspector;
        _store = store;
        _dialogs = dialogs;
        _logger = logger;
        _session.PropertyChanged += OnSessionChanged;
        Update();
    }

    // ----- The sim -----

    /// <summary>How the sim was found (Steam, Microsoft Store, folders chosen by hand), or that it was not.</summary>
    [ObservableProperty]
    public partial string SimSource { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial string FsBaseUi { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial string Community { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial string SimState { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial bool IsSimFound { get; private set; }

    [ObservableProperty]
    public partial string? LocateError { get; private set; }

    [ObservableProperty]
    public partial bool HasLocateError { get; private set; }

    [ObservableProperty]
    public partial bool HasManualFolders { get; private set; }

    // ----- The package -----

    [ObservableProperty]
    public partial string PackageHeadline { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial string PackageDetail { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial InfoBarSeverity PackageSeverity { get; private set; }

    /// <summary>Why the installed package differs from what the app would generate now.</summary>
    [ObservableProperty]
    public partial IReadOnlyList<string> Reasons { get; private set; } = [];

    /// <summary>Other Community packages that also replace the menu's root page.</summary>
    [ObservableProperty]
    public partial string Conflicts { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial bool HasConflicts { get; private set; }

    /// <summary>A sim update changed the menu's root page since the package was generated.</summary>
    [ObservableProperty]
    public partial bool IsSimUpdated { get; private set; }

    [ObservableProperty]
    public partial string? SettingsProblem { get; private set; }

    [ObservableProperty]
    public partial bool HasSettingsProblem { get; private set; }

    // ----- Actions -----

    /// <summary>
    /// An action of this page runs, or an installation or removal started elsewhere (Features, or this page before
    /// it was left and opened again): the page is a new one at each visit, the operation is the session's.
    /// </summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(InstallCommand), nameof(RemoveCommand), nameof(ReloadCommand), nameof(ChooseFoldersCommand), nameof(UseDetectedFoldersCommand))]
    public partial bool IsBusy { get; private set; }

    /// <summary>The busy text of this page's own action, while it runs.</summary>
    private string? _ownBusyText;

    [ObservableProperty]
    public partial string BusyText { get; private set; } = string.Empty;

    /// <summary>The outcome of the last action.</summary>
    [ObservableProperty]
    public partial bool IsMessageOpen { get; set; }

    [ObservableProperty]
    public partial string MessageTitle { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial string MessageText { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial InfoBarSeverity MessageSeverity { get; private set; }

    private bool IsOursInstalled => _session.Status?.Kind is PackageStatusKind.UpToDate or PackageStatusKind.UpdateNeeded;

    private bool CanInstall() => !IsBusy && _session.Sim is not null && _session.Inputs is not null && _session.Status?.Kind != PackageStatusKind.Foreign;

    private bool CanRemove() => !IsBusy && _session.Sim is not null && IsOursInstalled;

    private bool CanReload() => !IsBusy && _session.SimRunning && IsOursInstalled;

    private bool CanChooseFolders() => !IsBusy;

    private bool CanUseDetectedFolders() => !IsBusy && _session.Preferences.HasManualFolders;

    /// <summary>Generates the package from the sim's MasterPage and the user's settings, and installs it.</summary>
    [RelayCommand(CanExecute = nameof(CanInstall))]
    private async Task InstallAsync()
    {
        var sim = _session.Sim;
        var inputs = _session.Inputs;
        if (sim is null || inputs is null)
        {
            return;
        }

        await RunAsync(Strings.Get("HomeBusyInstall"), Strings.Get("HomeInstallFailed"), packageOperation: true, async () =>
        {
            var result = await _installer.InstallAsync(sim, inputs);
            var (next, severity) = result.NextStep switch
            {
                NextStep.RestartSim => (Strings.Get("HomeNextRestart"), InfoBarSeverity.Warning),
                NextStep.ReloadMod => await ReloadAfterInstallAsync(),
                _ => (Strings.Get("HomeNextNone"), InfoBarSeverity.Success),
            };
            ShowMessage(severity, Strings.Format("HomeInstalled", result.State.Version), next);
        });
    }

    /// <summary>Reloads the mod in the running sim: it reads its files and settings again.</summary>
    [RelayCommand(CanExecute = nameof(CanReload))]
    private Task ReloadAsync() => RunAsync(Strings.Get("HomeBusyReload"), Strings.Get("HomeReloadFailed"), packageOperation: false, async () =>
    {
        var result = await _inspector.ReloadModAsync();
        if (result.Ok)
        {
            ShowMessage(InfoBarSeverity.Success, Strings.Get("HomeReloaded"), string.Empty);
        }
        else
        {
            ShowMessage(InfoBarSeverity.Error, Strings.Get("HomeReloadFailed"), result.Error ?? string.Empty);
        }
    });

    /// <summary>Removes the package from Community, after confirmation.</summary>
    [RelayCommand(CanExecute = nameof(CanRemove))]
    private async Task RemoveAsync()
    {
        var confirmed = await _dialogs.ConfirmAsync(Strings.Get("HomeRemoveTitle"), Strings.Get("HomeRemoveMessage"), Strings.Get("HomeRemoveConfirm"));
        if (!confirmed)
        {
            return;
        }

        var sim = _session.Sim;
        if (sim is null)
        {
            return;
        }

        await RunAsync(Strings.Get("HomeBusyRemove"), Strings.Get("HomeRemoveFailed"), packageOperation: true, async () =>
        {
            var removed = await _installer.RemoveAsync(sim);
            ShowMessage(InfoBarSeverity.Success, Strings.Get(removed ? "HomeRemoved" : "HomeNothingToRemove"), _session.SimRunning ? Strings.Get("HomeRemovedRestart") : string.Empty);
        });
    }

    /// <summary>Asks for the Community folder, then the <c>fs-base-ui</c> folder, and uses them instead of the detection.</summary>
    [RelayCommand(CanExecute = nameof(CanChooseFolders))]
    private async Task ChooseFoldersAsync()
    {
        var community = await _dialogs.PickFolderAsync(Strings.Get("HomePickCommunity"));
        if (community is null)
        {
            return;
        }

        var fsBaseUi = await _dialogs.PickFolderAsync(Strings.Get("HomePickFsBaseUi"));
        if (fsBaseUi is null)
        {
            return;
        }

        await RunAsync(Strings.Get("HomeBusyLocate"), Strings.Get("HomeFoldersFailed"), packageOperation: false, async () =>
        {
            // The other preferences (the theme) are kept.
            var current = await _store.LoadPreferencesAsync();
            await _store.SavePreferencesAsync(current with { CommunityPath = community, FsBaseUiPath = fsBaseUi });
            LogFoldersChosen(community, fsBaseUi);
        });
    }

    /// <summary>Forgets the folders chosen by hand: the sim is detected again.</summary>
    [RelayCommand(CanExecute = nameof(CanUseDetectedFolders))]
    private Task UseDetectedFoldersAsync() => RunAsync(Strings.Get("HomeBusyLocate"), Strings.Get("HomeFoldersFailed"), packageOperation: false, async () =>
    {
        var current = await _store.LoadPreferencesAsync();
        await _store.SavePreferencesAsync(current with { CommunityPath = null, FsBaseUiPath = null });
        LogDetectedFolders();
    });

    public void Dispose() => _session.PropertyChanged -= OnSessionChanged;

    /// <summary>
    /// Runs an action with the busy state, reports a failure, and refreshes the state afterwards. An installation or
    /// a removal (<paramref name="packageOperation"/>) is also the session's, so that no other page starts one.
    /// </summary>
    private async Task RunAsync(string busyText, string failureTitle, bool packageOperation, Func<Task> action)
    {
        _ownBusyText = busyText;
        UpdateBusy();
        IsMessageOpen = false;
        var operation = packageOperation ? _session.BeginPackageOperation(busyText) : null;
        try
        {
            await action();
        }
        catch (Exception ex) when (ex is MsfsUiException or IOException or UnauthorizedAccessException)
        {
            LogActionFailed(failureTitle, ex);
            ShowMessage(InfoBarSeverity.Error, failureTitle, ex.Message);
        }
        finally
        {
            operation?.Dispose();
            await _session.RefreshAsync(locate: true);
            _ownBusyText = null;
            UpdateBusy();
        }
    }

    /// <summary>Busy while this page's action runs, or while an installation or removal started elsewhere does.</summary>
    private void UpdateBusy()
    {
        IsBusy = _ownBusyText is not null || _session.PackageOperation is not null;
        BusyText = _ownBusyText ?? _session.PackageOperation ?? string.Empty;
    }

    /// <summary>
    /// The sim runs and only re-reads the files: the mod is reloaded at once. The package is installed whatever
    /// happens here: a reload that fails, or an inspector that does not answer, is a warning, not a failed install.
    /// </summary>
    private async Task<(string Text, InfoBarSeverity Severity)> ReloadAfterInstallAsync()
    {
        try
        {
            var reload = await _inspector.ReloadModAsync();
            return reload.Ok
                ? (Strings.Get("HomeNextReloaded"), InfoBarSeverity.Success)
                : (Strings.Format("HomeNextReloadFailed", reload.Error), InfoBarSeverity.Warning);
        }
        catch (InspectorUnavailableException ex)
        {
            LogReloadFailed(ex);
            return (Strings.Format("HomeNextReloadFailed", ex.Message), InfoBarSeverity.Warning);
        }
    }

    private void ShowMessage(InfoBarSeverity severity, string title, string text)
    {
        MessageSeverity = severity;
        MessageTitle = title;
        MessageText = text;
        IsMessageOpen = true;
    }

    private void OnSessionChanged(object? sender, PropertyChangedEventArgs e) => Update();

    private void Update()
    {
        var sim = _session.Sim;
        IsSimFound = sim is not null;
        LocateError = _session.LocateError;
        HasLocateError = LocateError is not null;
        HasManualFolders = _session.Preferences.HasManualFolders;
        SettingsProblem = _session.SettingsProblem;
        HasSettingsProblem = SettingsProblem is not null;
        SimSource = sim is null
            ? Strings.Get("HomeSimNotFound")
            : Strings.Get(sim.Edition switch
            {
                SimEdition.Steam => "HomeSimSteam",
                SimEdition.Store => "HomeSimStore",
                _ => "HomeSimManual",
            });
        FsBaseUi = sim is null ? string.Empty : Strings.Format("HomeFsBaseUiValue", sim.FsBaseUiVersion, sim.FsBaseUiPath);
        Community = sim?.CommunityPath ?? string.Empty;
        SimState = Strings.Get(_session.SimRunning ? "HomeSimRunning" : "HomeSimNotRunning");

        UpdateBusy();
        UpdatePackage(_session.Status);
        InstallCommand.NotifyCanExecuteChanged();
        RemoveCommand.NotifyCanExecuteChanged();
        ReloadCommand.NotifyCanExecuteChanged();
        UseDetectedFoldersCommand.NotifyCanExecuteChanged();
    }

    private void UpdatePackage(PackageStatus? status)
    {
        if (status is null)
        {
            PackageHeadline = Strings.Get(_session.StatusError is null ? "HomePackageUnknown" : "HomePackageUnreadable");
            PackageDetail = _session.StatusError ?? Strings.Get("HomePackageNeedsSim");
            PackageSeverity = _session.StatusError is null ? InfoBarSeverity.Informational : InfoBarSeverity.Error;
            SetReasons([]);
            Conflicts = string.Empty;
            HasConflicts = false;
            IsSimUpdated = false;
            return;
        }

        (PackageHeadline, PackageSeverity) = status.Kind switch
        {
            PackageStatusKind.NotInstalled => (Strings.Get("HomePackageNotInstalled"), InfoBarSeverity.Informational),
            PackageStatusKind.Foreign => (Strings.Get("HomePackageForeign"), InfoBarSeverity.Error),
            PackageStatusKind.UpToDate => (Strings.Get("HomePackageUpToDate"), InfoBarSeverity.Success),
            _ => (Strings.Get("HomePackageUpdateNeeded"), InfoBarSeverity.Warning),
        };
        PackageDetail = status.Installed is { } installed
            ? Strings.Format("HomePackageInstalledDetail", installed.Version, BuiltAt(installed.BuiltAt), installed.FsBaseUiVersion, status.PackageFolder)
            : status.Kind == PackageStatusKind.Foreign ? Strings.Format("HomePackageForeignDetail", status.PackageFolder) : Strings.Get("HomePackageNotInstalledDetail");
        SetReasons([.. status.Reasons.Select(reason => Strings.Get($"HomeReason{reason}"))]);
        Conflicts = string.Join(Environment.NewLine, status.Conflicts);
        HasConflicts = status.Conflicts.Count > 0;
        IsSimUpdated = status.Reasons.Contains(UpdateReason.SimUpdated);
    }

    /// <summary>A new list only when the reasons change: the list on the page is not rebuilt at every refresh.</summary>
    private void SetReasons(IReadOnlyList<string> reasons)
    {
        if (!reasons.SequenceEqual(Reasons, StringComparer.Ordinal))
        {
            Reasons = reasons;
        }
    }

    /// <summary>The generation time, in the user's local time.</summary>
    private static string BuiltAt(string utc) =>
        DateTimeOffset.TryParse(utc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var time)
            ? time.ToLocalTime().ToString("g", CultureInfo.CurrentCulture)
            : utc;

    [LoggerMessage(Level = LogLevel.Error, Message = "{Action}")]
    private partial void LogActionFailed(string action, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Package installed, but the mod could not be reloaded in the sim")]
    private partial void LogReloadFailed(Exception exception);

    [LoggerMessage(Level = LogLevel.Information, Message = "Folders chosen by hand: Community {Community}, fs-base-ui {FsBaseUi}")]
    private partial void LogFoldersChosen(string community, string fsBaseUi);

    [LoggerMessage(Level = LogLevel.Information, Message = "Folders chosen by hand forgotten: the sim is detected again")]
    private partial void LogDetectedFolders();
}
