using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Dispatching;
using MsfsUi.App.Services;
using MsfsUi.Core;
using MsfsUi.Core.Coherent;
using Windows.ApplicationModel.DataTransfer;

namespace MsfsUi.App.ViewModels;

/// <summary>
/// Log: the app's operations (as written to <c>%LOCALAPPDATA%\MSFS-UI-GENERATOR\logs</c>, live), and the mod's
/// <c>[msfs-ui]</c> lines read from the console of the sim's main menu on demand.
/// </summary>
public sealed partial class LogViewModel : ObservableObject, IDisposable
{
    private const string ModTag = "[msfs-ui]";

    /// <summary>Lines shown at most, as the log keeps in memory.</summary>
    private const int MaxAppLines = 500;

    private readonly FileLoggerProvider _log;
    private readonly CoherentInspector _inspector;
    private readonly SimSession _session;
    private readonly AppPaths _paths;
    private readonly DispatcherQueue _dispatcher;
    private readonly ILogger<LogViewModel> _logger;

    public LogViewModel(FileLoggerProvider log, CoherentInspector inspector, SimSession session, AppPaths paths, ILogger<LogViewModel> logger)
    {
        _logger = logger;
        _log = log;
        _inspector = inspector;
        _session = session;
        _paths = paths;
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        AppLines = new ObservableCollection<LogLine>(log.Recent.Select(LogLine.From));
        _log.EntryWritten += OnEntryWritten;
    }

    /// <summary>The app's latest log lines, oldest first.</summary>
    public ObservableCollection<LogLine> AppLines { get; }

    /// <summary>The mod's lines from the sim's console, as last read.</summary>
    [ObservableProperty]
    public partial IReadOnlyList<LogLine> ModLines { get; private set; } = [];

    /// <summary>Which log is shown: the app's (false) or the mod's (true).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowsApp))]
    public partial bool ShowsMod { get; set; }

    public bool ShowsApp => !ShowsMod;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ReadModCommand))]
    public partial bool IsBusy { get; private set; }

    /// <summary>What the mod's view says instead of lines (never read, sim not running, nothing logged).</summary>
    [ObservableProperty]
    public partial string ModStatus { get; private set; } = Strings.Get("LogModNotRead");

    private bool CanReadMod() => !IsBusy;

    /// <summary>Reads the <c>[msfs-ui]</c> lines of the sim's main menu console.</summary>
    [RelayCommand(CanExecute = nameof(CanReadMod))]
    private async Task ReadModAsync()
    {
        if (!_session.SimRunning)
        {
            ModLines = [];
            ModStatus = Strings.Get("LogModSimNotRunning");
            return;
        }

        IsBusy = true;
        ModStatus = Strings.Get("LogModReading");
        try
        {
            var lines = await _inspector.ReadConsoleAsync();
            ModLines = [.. lines.Where(line => line.Contains(ModTag, StringComparison.Ordinal)).Select(LogLine.FromConsole)];
            ModStatus = ModLines.Count == 0 ? Strings.Get("LogModEmpty") : Strings.Format("LogModRead", ModLines.Count, DateTime.Now.ToString("T", CultureInfo.CurrentCulture));
        }
        catch (MsfsUiException ex)
        {
            ModLines = [];
            ModStatus = Strings.Format("LogModFailed", ex.Message);
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>Copies the log shown, as text.</summary>
    [RelayCommand]
    private void Copy()
    {
        var lines = ShowsMod ? ModLines : AppLines;
        var package = new DataPackage();
        package.SetText(string.Join(Environment.NewLine, lines.Select(line => line.Text)));
        Clipboard.SetContent(package);
    }

    /// <summary>Opens the folder of the log files in File Explorer.</summary>
    [RelayCommand]
    private void OpenFolder()
    {
        try
        {
            Directory.CreateDirectory(_paths.Logs);
            using var explorer = Process.Start(new ProcessStartInfo("explorer.exe", $"\"{_paths.Logs}\"") { UseShellExecute = true });
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or IOException or UnauthorizedAccessException)
        {
            LogOpenFolderFailed(ex);
        }
    }

    public void Dispose() => _log.EntryWritten -= OnEntryWritten;

    private void OnEntryWritten(object? sender, LogEntry entry) =>
        _dispatcher.TryEnqueue(() =>
        {
            AppLines.Add(LogLine.From(entry));
            if (AppLines.Count > MaxAppLines)
            {
                AppLines.RemoveAt(0);
            }
        });

    [LoggerMessage(Level = LogLevel.Error, Message = "The log folder could not be opened")]
    private partial void LogOpenFolderFailed(Exception exception);
}

/// <summary>A log line as shown: its text, and whether it reports a problem.</summary>
public sealed record LogLine(string Text, bool IsProblem)
{
    public bool IsNormal => !IsProblem;

    public static LogLine From(LogEntry entry) => new(
        string.Create(CultureInfo.CurrentCulture, $"{entry.Time.ToLocalTime():T}  {entry.Level,-11}  {entry.Category}: {entry.Message}"),
        entry.Level >= LogLevel.Warning);

    /// <summary>A console line, <c>[level] text</c>.</summary>
    public static LogLine FromConsole(string line) => new(line, line.StartsWith("[error]", StringComparison.Ordinal) || line.StartsWith("[warn", StringComparison.Ordinal));
}
