using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Xaml.Controls;
using MsfsUi.App.Services;
using MsfsUi.Core;
using MsfsUi.Core.Compatibility;

namespace MsfsUi.App.ViewModels;

/// <summary>
/// Compatibility: what the mod needs from the sim (the embedded <c>compat.json</c>), checked in the files of
/// <c>fs-base-ui</c> and, while the sim runs, in its main menu. Runs when the page opens.
/// </summary>
public sealed partial class CompatibilityViewModel : ObservableObject
{
    private readonly CompatibilityChecker _checker;
    private readonly ModResources _mod;
    private readonly SimSession _session;
    private readonly ILogger<CompatibilityViewModel> _logger;

    public CompatibilityViewModel(CompatibilityChecker checker, ModResources mod, SimSession session, ILogger<CompatibilityViewModel> logger)
    {
        _checker = checker;
        _mod = mod;
        _session = session;
        _logger = logger;
    }

    /// <summary>The checks by origin: the sim's files, then the running sim.</summary>
    [ObservableProperty]
    public partial IReadOnlyList<CheckSection> Sections { get; private set; } = [];

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(RunCommand))]
    public partial bool IsBusy { get; private set; }

    [ObservableProperty]
    public partial bool HasResult { get; private set; }

    [ObservableProperty]
    public partial string SummaryTitle { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial string SummaryText { get; private set; } = string.Empty;

    [ObservableProperty]
    public partial InfoBarSeverity SummarySeverity { get; private set; }

    private bool CanRun() => !IsBusy;

    /// <summary>Runs the offline checks, then the live ones when the sim answers.</summary>
    [RelayCommand(CanExecute = nameof(CanRun))]
    private async Task RunAsync()
    {
        IsBusy = true;
        try
        {
            var sim = _session.Sim;
            if (sim is null)
            {
                Show(InfoBarSeverity.Error, Strings.Get("CompatibilityNoSim"), _session.LocateError ?? string.Empty, []);
                return;
            }

            var sections = new List<CheckSection>
            {
                CheckSection.From(Strings.Format("CompatibilityOfflineTitle", sim.FsBaseUiVersion), await _checker.CheckOfflineAsync(_mod.Compat, sim.FsBaseUiPath)),
            };
            var live = await _checker.CheckLiveAsync(_mod.Compat);
            if (live is not null)
            {
                sections.Add(CheckSection.From(Strings.Get("CompatibilityLiveTitle"), live));
            }

            var failed = sections.Sum(section => section.Failed);
            var total = sections.Sum(section => section.Total);
            var skipped = live is null ? Strings.Get("CompatibilityLiveSkipped") : string.Empty;
            LogChecked(total - failed, total);
            if (failed == 0)
            {
                Show(InfoBarSeverity.Success, Strings.Format("CompatibilityAllPassed", total), skipped, sections);
            }
            else
            {
                Show(InfoBarSeverity.Error, Strings.Format("CompatibilityFailed", failed, total), Strings.Get("CompatibilityFailedHint") + (skipped.Length > 0 ? " " + skipped : string.Empty), sections);
            }
        }
        catch (Exception ex) when (ex is MsfsUiException or IOException or UnauthorizedAccessException)
        {
            LogCheckFailed(ex);
            Show(InfoBarSeverity.Error, Strings.Get("CompatibilityError"), ex.Message, []);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void Show(InfoBarSeverity severity, string title, string text, IReadOnlyList<CheckSection> sections)
    {
        SummarySeverity = severity;
        SummaryTitle = title;
        SummaryText = text;
        Sections = sections;
        HasResult = true;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Compatibility: {Passed}/{Total} checks passed")]
    private partial void LogChecked(int passed, int total);

    [LoggerMessage(Level = LogLevel.Error, Message = "The compatibility check could not run")]
    private partial void LogCheckFailed(Exception exception);
}

/// <summary>Checks of one origin (the sim's files, or the running sim), by group.</summary>
public sealed record CheckSection(string Title, string Summary, IReadOnlyList<CheckGroup> Groups, int Failed, int Total)
{
    public static CheckSection From(string title, IReadOnlyList<CheckResult> results)
    {
        var groups = results
            .GroupBy(result => result.Group, StringComparer.Ordinal)
            .Select(group => CheckGroup.From(group.Key, [.. group]))
            .ToList();
        var failed = results.Count(result => !result.Ok);
        return new CheckSection(title, Strings.Format("CompatibilityCount", results.Count - failed, results.Count), groups, failed, results.Count);
    }
}

/// <summary>A group of checks (exports, screens, components…); opened when one of them failed.</summary>
public sealed record CheckGroup(string Name, string Summary, bool HasFailures, IReadOnlyList<CheckItem> Items)
{
    public static CheckGroup From(string name, IReadOnlyList<CheckResult> results)
    {
        var passed = results.Count(result => result.Ok);
        return new CheckGroup(
            name,
            Strings.Format("CompatibilityCount", passed, results.Count),
            passed < results.Count,
            [.. results.OrderBy(result => result.Ok).Select(result => new CheckItem(result.Label, result.Ok, result.Detail ?? string.Empty))]);
    }
}

/// <summary>One check: failures first, with what went wrong.</summary>
public sealed record CheckItem(string Label, bool Ok, string Detail)
{
    // Segoe Fluent Icons, built from their code points (no invisible character in the source).
    private static readonly string CheckMark = char.ConvertFromUtf32(0xE73E);
    private static readonly string ErrorBadge = char.ConvertFromUtf32(0xEA39);

    /// <summary>Segoe Fluent Icons: check mark, or error badge.</summary>
    public string Glyph => Ok ? CheckMark : ErrorBadge;

    public bool Failed => !Ok;

    /// <summary>What a screen reader says: the check and its result.</summary>
    public string AccessibleName => Strings.Format(Ok ? "CompatibilityItemPassed" : "CompatibilityItemFailed", Label);

    public bool HasDetail => Detail.Length > 0;
}
