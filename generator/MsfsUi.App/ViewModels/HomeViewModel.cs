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
    private readonly ModReloader _reloader;
    private readonly SettingsStore _store;
    private readonly IDialogService _dialogs;
    private readonly Uninstaller _uninstaller;
    private readonly FileLoggerProvider _log;
    private readonly ILogger<HomeViewModel> _logger;

    public HomeViewModel(
        SimSession session,
        PackageInstaller installer,
        CoherentInspector inspector,
        ModReloader reloader,
        SettingsStore store,
        IDialogService dialogs,
        Uninstaller uninstaller,
        FileLoggerProvider log,
        ILogger<HomeViewModel> logger)
    {
        _session = session;
        _installer = installer;
        _inspector = inspector;
        _reloader = reloader;
        _store = store;
        _dialogs = dialogs;
        _uninstaller = uninstaller;
        _log = log;
        _logger = logger;
        _session.PropertyChanged += OnSessionChanged;
        Update();
        ShowOutcome();
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

    /// <summary>The sim runs: the uninstall waits for it to close.</summary>
    [ObservableProperty]
    public partial bool IsSimRunning { get; private set; }

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

    /// <summary>Other Community packages that also replace the menu's root page: what to do (the installation waits).</summary>
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
    [NotifyCanExecuteChangedFor(nameof(InstallCommand), nameof(RemoveCommand), nameof(ReloadCommand), nameof(ChooseFoldersCommand), nameof(UseDetectedFoldersCommand), nameof(UninstallCommand))]
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

    /// <summary>Not over a foreign folder, nor while another package replaces the same menu page (the installer refuses).</summary>
    private bool CanInstall() => !IsBusy && _session.Sim is not null && _session.Inputs is not null
        && _session.Status is not ({ Kind: PackageStatusKind.Foreign } or { Conflicts.Count: > 0 });

    private bool CanRemove() => !IsBusy && _session.Sim is not null && IsOursInstalled;

    private bool CanReload() => !IsBusy && _session.SimRunning && IsOursInstalled;

    private bool CanChooseFolders() => !IsBusy;

    private bool CanUseDetectedFolders() => !IsBusy && _session.Preferences.HasManualFolders;

    private bool CanUninstall() => !IsBusy && !_session.SimRunning;

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

        await RunPackageOperationAsync(Strings.Get("HomeBusyInstall"), Strings.Get("HomeInstallFailed"), async () =>
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
    private Task ReloadAsync() => RunAsync(Strings.Get("HomeBusyReload"), Strings.Get("HomeReloadFailed"), async () =>
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

        await RunPackageOperationAsync(Strings.Get("HomeBusyRemove"), Strings.Get("HomeRemoveFailed"), async () =>
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

        await RunAsync(Strings.Get("HomeBusyLocate"), Strings.Get("HomeFoldersFailed"), async () =>
        {
            // The other preferences (the theme) are kept.
            var current = await _store.LoadPreferencesAsync();
            await _store.SavePreferencesAsync(current with { CommunityPath = community, FsBaseUiPath = fsBaseUi });
            LogFoldersChosen(community, fsBaseUi);
        });
    }

    /// <summary>Forgets the folders chosen by hand: the sim is detected again.</summary>
    [RelayCommand(CanExecute = nameof(CanUseDetectedFolders))]
    private Task UseDetectedFoldersAsync() => RunAsync(Strings.Get("HomeBusyLocate"), Strings.Get("HomeFoldersFailed"), async () =>
    {
        var current = await _store.LoadPreferencesAsync();
        await _store.SavePreferencesAsync(current with { CommunityPath = null, FsBaseUiPath = null });
        LogDetectedFolders();
    });

    /// <summary>
    /// Deletes everything MSFS-UI put on the machine, after a confirmation that lists it, the sim closed; then says
    /// that the app's own folder is left to delete and closes the app (it would write its data again). What could not
    /// be deleted is listed instead, the app left open to try again.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanUninstall))]
    private async Task UninstallAsync()
    {
        var sim = _session.Sim;
        var folders = await _uninstaller.FindAsync(sim);
        var list = string.Join(Environment.NewLine, folders.Select(folder => "• " + folder));
        if (!await _dialogs.ConfirmAsync(Strings.Get("HomeUninstallTitle"), Strings.Format("HomeUninstallMessage", list), Strings.Get("HomeUninstallConfirm")))
        {
            return;
        }

        var done = false;
        await RunPackageOperationAsync(Strings.Get("HomeBusyUninstall"), Strings.Get("HomeUninstallFailed"), async () =>
        {
            LogUninstalling();
            // The log's next line would make the app's data folder again: from now on, lines stay in memory.
            _log.WritesFiles = false;
            try
            {
                var left = await _uninstaller.UninstallAsync(sim);
                done = left.Count == 0;
                if (!done)
                {
                    ShowMessage(InfoBarSeverity.Error, Strings.Get("HomeUninstallLeft"), Strings.Format("HomeUninstallLeftDetail", string.Join(", ", left)));
                }
            }
            finally
            {
                _log.WritesFiles = !done;
            }
        });
        if (done)
        {
            await _dialogs.InformAsync(Strings.Get("HomeUninstalledTitle"), Strings.Get("HomeUninstalledMessage"));
            Microsoft.UI.Xaml.Application.Current.Exit();
        }
    }

    public void Dispose() => _session.PropertyChanged -= OnSessionChanged;

    /// <summary>Runs an action with the busy state, reports a failure, and refreshes the state afterwards.</summary>
    private Task RunAsync(string busyText, string failureTitle, Func<Task> action) => RunAsync(busyText, failureTitle, () => null, action);

    /// <summary>An installation or a removal, run as <see cref="RunAsync(string, string, Func{Task})"/>: also the session's, so that no other page starts one.</summary>
    private Task RunPackageOperationAsync(string busyText, string failureTitle, Func<Task> action) =>
        RunAsync(busyText, failureTitle, () => _session.BeginPackageOperation(busyText), action);

    /// <summary>Runs <paramref name="action"/>, holding the operation <paramref name="begin"/> starts (null: none) until it ends.</summary>
    private async Task RunAsync(string busyText, string failureTitle, Func<IDisposable?> begin, Func<Task> action)
    {
        _ownBusyText = busyText;
        UpdateBusy();
        IsMessageOpen = false;
        var operation = begin();
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

    /// <summary>The sim runs and only re-reads the files: the mod is reloaded at once (a failure is a warning).</summary>
    private async Task<(string Text, InfoBarSeverity Severity)> ReloadAfterInstallAsync()
    {
        var error = await _reloader.ReloadAfterInstallAsync();
        return error is null
            ? (Strings.Get("HomeNextReloaded"), InfoBarSeverity.Success)
            : (Strings.Format("HomeNextReloadFailed", error), InfoBarSeverity.Warning);
    }

    private void ShowMessage(InfoBarSeverity severity, string title, string text) => _session.LastOutcome = new ActionOutcome(severity, title, text);

    /// <summary>The bar shows the session's last outcome, whichever instance of the page's view model the action began on.</summary>
    private void ShowOutcome()
    {
        if (_session.LastOutcome is { } outcome)
        {
            MessageSeverity = outcome.Severity;
            MessageTitle = outcome.Title;
            MessageText = outcome.Text;
        }

        IsMessageOpen = _session.LastOutcome is not null;
    }

    /// <summary>The bar closed, by its button or for a new action: the outcome is over.</summary>
    partial void OnIsMessageOpenChanged(bool value)
    {
        if (!value)
        {
            _session.LastOutcome = null;
        }
    }

    private void OnSessionChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(SimSession.LastOutcome))
        {
            ShowOutcome();
            return;
        }

        Update();
    }

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
        IsSimRunning = _session.SimRunning;

        UpdateBusy();
        UpdatePackage(_session.Status);
        InstallCommand.NotifyCanExecuteChanged();
        RemoveCommand.NotifyCanExecuteChanged();
        ReloadCommand.NotifyCanExecuteChanged();
        UseDetectedFoldersCommand.NotifyCanExecuteChanged();
        UninstallCommand.NotifyCanExecuteChanged();
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
        Conflicts = Strings.Format("HomeConflictsMessage", string.Join(", ", status.Conflicts), _session.Sim?.CommunityPath ?? string.Empty);
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

    [LoggerMessage(Level = LogLevel.Information, Message = "Folders chosen by hand: Community {Community}, fs-base-ui {FsBaseUi}")]
    private partial void LogFoldersChosen(string community, string fsBaseUi);

    [LoggerMessage(Level = LogLevel.Information, Message = "Folders chosen by hand forgotten: the sim is detected again")]
    private partial void LogDetectedFolders();

    [LoggerMessage(Level = LogLevel.Information, Message = "Uninstalling everything MSFS-UI put on this computer")]
    private partial void LogUninstalling();
}
