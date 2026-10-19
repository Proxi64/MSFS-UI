using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.Extensions.Logging;
using MsfsUi.Core;
using MsfsUi.Core.Features;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Settings;
using MsfsUi.Core.Sim;

namespace MsfsUi.App.Services;

/// <summary>
/// What every page needs to know, kept up to date: the sim found (or why not), whether it runs, the package in
/// Community compared with what the app would generate now, and the inputs to generate it (the embedded mod with the
/// user's settings). Refreshed every few seconds while the app runs, and on demand after an action.
/// </summary>
/// <remarks>Its properties change on the thread that awaits <see cref="RefreshAsync"/>: the UI thread.</remarks>
public sealed partial class SimSession : ObservableObject, IDisposable
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);

    private readonly SimLocator _locator;
    private readonly PackageInstaller _installer;
    private readonly SettingsStore _store;
    private readonly ModResources _mod;
    private readonly ILogger<SimSession> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public SimSession(SimLocator locator, PackageInstaller installer, SettingsStore store, ModResources mod, ILogger<SimSession> logger)
    {
        _locator = locator;
        _installer = installer;
        _store = store;
        _mod = mod;
        _logger = logger;
    }

    /// <summary>The sim found, or null (see <see cref="LocateError"/>).</summary>
    [ObservableProperty]
    public partial SimInstallation? Sim { get; private set; }

    /// <summary>Why the sim was not found, or null.</summary>
    [ObservableProperty]
    public partial string? LocateError { get; private set; }

    /// <summary>Whether the sim is running.</summary>
    [ObservableProperty]
    public partial bool SimRunning { get; private set; }

    /// <summary>The package in Community, or null while the sim is not found or the state cannot be read.</summary>
    [ObservableProperty]
    public partial PackageStatus? Status { get; private set; }

    /// <summary>Why the package state could not be read, or null.</summary>
    [ObservableProperty]
    public partial string? StatusError { get; private set; }

    /// <summary>The app's preferences (folders chosen by hand).</summary>
    [ObservableProperty]
    public partial AppPreferences Preferences { get; private set; } = AppPreferences.Default;

    /// <summary>Why the user's settings could not be read (the defaults apply), or null.</summary>
    [ObservableProperty]
    public partial string? SettingsProblem { get; private set; }

    /// <summary>What a generation would install now: the embedded mod with the user's settings.</summary>
    public PackageInputs? Inputs { get; private set; }

    /// <summary>Refreshes at once, then every few seconds until cancelled.</summary>
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(PollInterval);
        try
        {
            await RefreshAsync(locate: true, cancellationToken);
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                // A sim not found is looked for again: it may have been installed, or a folder plugged in.
                await RefreshAsync(locate: Sim is null, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            // The app is closing.
        }
    }

    /// <summary>
    /// Reads the preferences and settings again, locates the sim when asked (or never found yet), and compares the
    /// package with what the app would generate. It never throws but when cancelled: what cannot be read is reported
    /// in <see cref="LocateError"/>, <see cref="StatusError"/> or <see cref="SettingsProblem"/>.
    /// </summary>
    public async Task RefreshAsync(bool locate, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await ReadUserFilesAsync(cancellationToken);

            if (locate || (Sim is null && LocateError is null))
            {
                await LocateAsync(cancellationToken);
            }

            SimRunning = _locator.IsSimRunning();
            await ReadStatusAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Never thrown to the pages: their actions refresh in a finally block, and the polling must go on.
            LogRefreshFailed(ex);
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose() => _gate.Dispose();

    /// <summary>
    /// The preferences and the settings, and the inputs of a generation. A file being written at that moment keeps
    /// the previous values until the next refresh.
    /// </summary>
    private async Task ReadUserFilesAsync(CancellationToken cancellationToken)
    {
        try
        {
            Preferences = await _store.LoadPreferencesAsync(cancellationToken);
            var load = await _store.LoadFeatureSettingsAsync(cancellationToken);
            SettingsProblem = load.Problem;
            Inputs = PackageInputs.ForMod(_mod.Catalog, _mod.ModScript, SettingsNormalizer.Normalize(_mod.Catalog, load.Settings).Selection);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            SettingsProblem = ex.Message;
            Inputs ??= PackageInputs.ForMod(_mod.Catalog, _mod.ModScript, SettingsNormalizer.Normalize(_mod.Catalog, null).Selection);
        }
    }

    private async Task LocateAsync(CancellationToken cancellationToken)
    {
        try
        {
            Sim = await _locator.LocateAsync(Preferences.ToLocatorOptions(), cancellationToken);
            LocateError = null;
        }
        catch (Exception ex) when (ex is MsfsUiException or IOException or UnauthorizedAccessException)
        {
            if (ex.Message != LocateError)
            {
                LogNotFound(ex.Message);
            }

            Sim = null;
            LocateError = ex.Message;
        }
    }

    private async Task ReadStatusAsync(CancellationToken cancellationToken)
    {
        if (Sim is null || Inputs is null)
        {
            Status = null;
            StatusError = null;
            return;
        }

        try
        {
            Status = await _installer.GetStatusAsync(Sim, Inputs, cancellationToken);
            StatusError = null;
        }
        catch (Exception ex) when (ex is MsfsUiException or IOException or UnauthorizedAccessException)
        {
            if (ex.Message != StatusError)
            {
                LogStatusUnreadable(ex.Message);
            }

            Status = null;
            StatusError = ex.Message;
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "The sim's state could not be refreshed")]
    private partial void LogRefreshFailed(Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Sim not found: {Reason}")]
    private partial void LogNotFound(string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Package state unreadable: {Reason}")]
    private partial void LogStatusUnreadable(string reason);
}
