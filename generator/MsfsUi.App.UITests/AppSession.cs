using System.Diagnostics;
using System.IO;
using System.Windows.Automation;

namespace MsfsUi.App.UITests;

/// <summary>
/// The app started on an isolated profile: a temporary folder with a fake <c>fs-base-ui</c>, a fake Community folder
/// and the app's data folder (its <c>app.json</c> names the fake folders), and an inspector address where nothing
/// listens. Closed and cleaned up on dispose.
/// </summary>
internal sealed class AppSession : IDisposable
{
    /// <summary>Version written in the fake <c>fs-base-ui</c> manifest.</summary>
    public const string FsBaseUiVersion = "9.9.9";

    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(20);
    private const string MasterPageGuid = "{7DA60FBA-EF32-48F2-974D-F8BEA35337A4}";

    private readonly Process _process;

    private AppSession(string root, Process process, AutomationElement window)
    {
        Root = root;
        _process = process;
        Window = window;
    }

    public string Root { get; }

    public string DataRoot => Path.Combine(Root, "data");

    public string Community => Path.Combine(Root, "Community");

    public string PackageFolder => Path.Combine(Community, "msfs-ui");

    public AutomationElement Window { get; }

    /// <summary>Whether the real sim runs on this machine: its process makes the app say "Running".</summary>
    public static bool RealSimRunning => Process.GetProcessesByName("FlightSimulator2024").Length > 0;

    /// <summary>Prepares the profile and starts the app; inconclusive when the app is not built.</summary>
    /// <param name="settingsJson">The user's settings (<c>settings.json</c>) the profile starts with, if any.</param>
    public static AppSession Start(string? settingsJson = null)
    {
        var exe = FindApp() ?? throw new AssertInconclusiveException("MSFS-UI-GENERATOR.exe is not built: build generator/MsfsUi.slnx first.");
        var root = Path.Combine(Path.GetTempPath(), "msfs-ui-uitests", Guid.NewGuid().ToString("N"));
        var fsBaseUi = Path.Combine(root, "fs-base-ui");
        Directory.CreateDirectory(Path.Combine(fsBaseUi, "cookedcomps"));
        Directory.CreateDirectory(Path.Combine(root, "Community"));
        Directory.CreateDirectory(Path.Combine(root, "data"));
        File.WriteAllText(Path.Combine(fsBaseUi, "manifest.json"), $"{{\"package_version\":\"{FsBaseUiVersion}\"}}");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "Fixtures", "masterpage.html"), Path.Combine(fsBaseUi, "cookedcomps", MasterPageGuid + ".html"));
        File.WriteAllText(Path.Combine(fsBaseUi, "cookedcomps", MasterPageGuid + ".json"), "{\"children\":[]}");
        File.WriteAllText(
            Path.Combine(root, "data", "app.json"),
            $"{{\"communityPath\":{Json(Path.Combine(root, "Community"))},\"fsBaseUiPath\":{Json(fsBaseUi)}}}");
        if (settingsJson is not null)
        {
            File.WriteAllText(Path.Combine(root, "data", "settings.json"), settingsJson);
        }

        var start = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe)! };
        start.Environment["MSFS_UI_DATA_ROOT"] = Path.Combine(root, "data");
        // Port 9 (discard): nothing answers, so a reload or a live check never reaches a running sim.
        start.Environment["MSFS_UI_INSPECTOR_HOST"] = "127.0.0.1:9";
        var process = Process.Start(start) ?? throw new InvalidOperationException("MSFS-UI-GENERATOR.exe did not start.");
        try
        {
            var window = WaitFor(
                () => AutomationElement.RootElement.FindFirst(TreeScope.Children, new PropertyCondition(AutomationElement.ProcessIdProperty, process.Id)),
                "the main window",
                DefaultTimeout);
            return new AppSession(root, process, window);
        }
        catch
        {
            process.Kill();
            process.Dispose();
            throw;
        }
    }

    /// <summary>The element with this automation id, once it exists.</summary>
    public AutomationElement Find(string automationId) =>
        WaitFor(() => Window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, automationId)), automationId, DefaultTimeout);

    /// <summary>The element with this automation id, or null.</summary>
    public AutomationElement? TryFind(string automationId) =>
        Window.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, automationId));

    /// <summary>The first element with this name (and class, when given), once it exists.</summary>
    public AutomationElement FindByName(string name, string? className = null) =>
        WaitFor(() => ByName(Window, name, className), name, DefaultTimeout);

    /// <summary>Opens a page of the navigation view.</summary>
    public void Navigate(string navigationId) =>
        ((SelectionItemPattern)Find(navigationId).GetCurrentPattern(SelectionItemPattern.Pattern)).Select();

    /// <summary>
    /// Clicks a button by automation id, once it is enabled (a command stays disabled until its previous run ends,
    /// a cancelled dialog included).
    /// </summary>
    public void Invoke(string automationId)
    {
        var button = Find(automationId);
        WaitUntil(() => button.Current.IsEnabled, $"{automationId} enabled");
        Invoke(button);
    }

    /// <summary>Clicks a button.</summary>

    public static void Invoke(AutomationElement element) =>
        ((InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern)).Invoke();

    public static void Toggle(AutomationElement element) =>
        ((TogglePattern)element.GetCurrentPattern(TogglePattern.Pattern)).Toggle();

    public static ToggleState ToggleStateOf(AutomationElement element) =>
        ((TogglePattern)element.GetCurrentPattern(TogglePattern.Pattern)).Current.ToggleState;

    public static void Expand(AutomationElement element) =>
        ((ExpandCollapsePattern)element.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand();

    /// <summary>Every text inside an element, joined (an info bar: its title and message).</summary>
    public static string Texts(AutomationElement element) =>
        string.Join(" | ", element.FindAll(TreeScope.Descendants, Condition.TrueCondition)
            .Cast<AutomationElement>()
            .Select(child => child.Current.Name)
            .Where(name => !string.IsNullOrEmpty(name))
            .Distinct());

    /// <summary>The text of an element (by automation id) once it contains <paramref name="expected"/>.</summary>
    public string WaitForText(string automationId, string expected)
    {
        string? last = null;
        try
        {
            return WaitFor(
                () =>
                {
                    var element = TryFind(automationId);
                    var text = element is null ? null : element.Current.Name + " | " + Texts(element);
                    last = text ?? last;
                    return text is not null && text.Contains(expected, StringComparison.Ordinal) ? text : null;
                },
                $"'{expected}' in {automationId}",
                DefaultTimeout);
        }
        catch (AssertFailedException ex)
        {
            // What the element said instead, to tell a slow page from a wrong text.
            throw new AssertFailedException($"{ex.Message} Last text: {last ?? "(element not found)"}", ex);
        }
    }

    /// <summary>The dialog with this title, once shown (a ContentDialog shows as a Popup window).</summary>
    public AutomationElement Dialog(string title) =>
        WaitFor(() => ByName(Window, title, "Popup"), $"the dialog '{title}'", DefaultTimeout);

    /// <summary>Waits until <paramref name="condition"/> is true.</summary>
    public static void WaitUntil(Func<bool> condition, string what) =>
        WaitFor(() => condition() ? (object?)true : null, what, DefaultTimeout);

    public void Dispose()
    {
        try
        {
            if (!_process.HasExited)
            {
                ((WindowPattern)Window.GetCurrentPattern(WindowPattern.Pattern)).Close();
                if (!_process.WaitForExit(5000))
                {
                    _process.Kill();
                }
            }
        }
        catch (Exception ex) when (ex is ElementNotAvailableException or InvalidOperationException)
        {
            _process.Kill();
        }
        finally
        {
            _process.Dispose();
        }

        try
        {
            Directory.Delete(Root, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Left under %TEMP%: a file may still be held for a moment by the closing app.
        }
    }

    private static AutomationElement? ByName(AutomationElement root, string name, string? className) =>
        root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, name))
            .Cast<AutomationElement>()
            .FirstOrDefault(element => className is null || element.Current.ClassName.EndsWith(className, StringComparison.Ordinal));

    private static T WaitFor<T>(Func<T?> find, string what, TimeSpan timeout)
        where T : class
    {
        var watch = Stopwatch.StartNew();
        while (true)
        {
            try
            {
                var found = find();
                if (found is not null)
                {
                    return found;
                }
            }
            catch (ElementNotAvailableException)
            {
                // The element changed while it was read: try again.
            }

            if (watch.Elapsed > timeout)
            {
                throw new AssertFailedException($"Timed out after {timeout.TotalSeconds:0} s waiting for {what}.");
            }

            Thread.Sleep(200);
        }
    }

    /// <summary>MSFS-UI-GENERATOR.exe built in the same configuration as these tests (Debug or Release).</summary>
    private static string? FindApp()
    {
        var testFolder = new DirectoryInfo(AppContext.BaseDirectory);
        var configuration = testFolder.Parent?.Name ?? "Debug";
        for (var folder = testFolder; folder is not null; folder = folder.Parent)
        {
            var appBin = Path.Combine(folder.FullName, "MsfsUi.App", "bin", configuration);
            if (Directory.Exists(appBin))
            {
                return Directory.EnumerateFiles(appBin, "MSFS-UI-GENERATOR.exe", SearchOption.AllDirectories).FirstOrDefault();
            }
        }

        return null;
    }

    private static string Json(string text) => System.Text.Json.JsonSerializer.Serialize(text);
}
