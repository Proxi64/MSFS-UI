using System.IO;
using System.Windows.Automation;

namespace MsfsUi.App.UITests;

/// <summary>
/// The app driven like a user would, page by page, on an isolated profile (see <see cref="AppSession"/>). Each test
/// starts its own app.
/// </summary>
[TestClass]
[TestCategory("UI")]
public sealed class AppTests
{
    private const string ImagesOption = "Images without fade";

    [TestMethod]
    public void EveryPageOpens()
    {
        using var app = AppSession.Start();

        foreach (var (navigation, title) in new[] { ("NavHome", "Home"), ("NavFeatures", "Features"), ("NavCompatibility", "Compatibility"), ("NavLog", "Log"), ("NavReadme", "Readme") })
        {
            app.Navigate(navigation);
            Assert.IsNotNull(app.FindByName(title, "TextBlock"), $"{title} page");
        }
    }

    [TestMethod]
    public void TheThemeButtonSwitchesAndRemembersTheTheme()
    {
        using var app = AppSession.Start();
        var button = app.Find("ThemeToggle");
        var toDark = button.Current.Name.Contains("dark", StringComparison.Ordinal);

        app.Invoke("ThemeToggle");

        var expected = toDark ? "Switch to the light theme" : "Switch to the dark theme";
        AppSession.WaitUntil(() => app.Find("ThemeToggle").Current.Name == expected, "the button showing the other theme");
        var appJson = Path.Combine(app.DataRoot, "app.json");
        AppSession.WaitUntil(() => File.ReadAllText(appJson).Contains(toDark ? "\"theme\": \"dark\"" : "\"theme\": \"light\"", StringComparison.Ordinal), "the theme in app.json");
        StringAssert.Contains(File.ReadAllText(appJson), "communityPath", "the folders kept");
    }

    [TestMethod]
    public void HomeShowsTheSimFromTheChosenFolders()
    {
        using var app = AppSession.Start();

        app.WaitForText("HomeSimSource", "Folders chosen by hand");
        app.WaitForText("HomeFsBaseUi", AppSession.FsBaseUiVersion);
        Assert.AreEqual(app.Community, app.Find("HomeCommunity").Current.Name);
        app.WaitForText("HomePackageStatus", "Not installed");
        Assert.IsTrue(app.Find("HomeInstall").Current.IsEnabled, "Generate & install");
        Assert.IsFalse(app.Find("HomeRemove").Current.IsEnabled, "Remove without a package");
        Assert.IsTrue(app.Find("HomeUseDetectedFolders").Current.IsEnabled, "back to the detection");
        if (!AppSession.RealSimRunning)
        {
            Assert.AreEqual("Not running", app.Find("HomeSimState").Current.Name);
            Assert.IsFalse(app.Find("HomeReload").Current.IsEnabled, "Reload in sim without the sim");
        }
    }

    [TestMethod]
    public void GenerateInstallThenRemoveAfterConfirmation()
    {
        using var app = AppSession.Start();
        app.WaitForText("HomePackageStatus", "Not installed");

        app.Invoke("HomeInstall");
        app.WaitForText("HomeMessage", "installed");
        app.WaitForText("HomePackageStatus", "Installed and up to date");
        Assert.IsTrue(File.Exists(Path.Combine(app.PackageFolder, "msfs-ui.json")), "package state");
        Assert.IsTrue(File.Exists(Path.Combine(app.PackageFolder, "html_ui", "msfs-ui", "config.js")), "settings module");

        // Cancel keeps the package; it is the default button.
        app.Invoke("HomeRemove");
        var dialog = app.Dialog("Remove the package?");
        var cancel = dialog.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, "Cancel"));
        Assert.IsTrue(cancel.Current.HasKeyboardFocus, "Cancel has the focus");
        AppSession.Invoke(cancel);
        Assert.IsTrue(Directory.Exists(app.PackageFolder), "package kept");

        app.Invoke("HomeRemove");
        dialog = app.Dialog("Remove the package?");
        AppSession.Invoke(dialog.FindFirst(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.NameProperty, "Remove"),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button))));
        app.WaitForText("HomePackageStatus", "Not installed");
        Assert.IsFalse(Directory.Exists(app.PackageFolder), "package removed");
    }

    [TestMethod]
    public void FeaturesApplySavesTheSettingsAndUpdatesThePackage()
    {
        using var app = AppSession.Start();
        app.WaitForText("HomePackageStatus", "Not installed");
        app.Invoke("HomeInstall");
        app.WaitForText("HomePackageStatus", "Installed and up to date");
        var config = Path.Combine(app.PackageFolder, "html_ui", "msfs-ui", "config.js");

        app.Navigate("NavFeatures");
        AppSession.Expand(app.FindByName("Fast menus", "Expander"));
        var images = app.FindByName(ImagesOption, "ToggleSwitch");
        Assert.AreEqual(ToggleState.On, AppSession.ToggleStateOf(images));
        Assert.IsFalse(app.Find("FeaturesApply").Current.IsEnabled, "nothing to apply yet");

        // A change shows as unsaved, and Discard brings the saved value back.
        AppSession.Toggle(images);
        app.Find("FeaturesUnsaved");
        Assert.IsTrue(app.Find("FeaturesApply").Current.IsEnabled, "Apply after a change");
        app.Invoke("FeaturesDiscard");
        AppSession.WaitUntil(() => AppSession.ToggleStateOf(images) == ToggleState.On, "the option back on");
        Assert.IsFalse(app.Find("FeaturesApply").Current.IsEnabled, "nothing to apply after Discard");

        // Apply: saved, and the installed package follows.
        AppSession.Toggle(images);
        app.Invoke("FeaturesApply");
        app.WaitForText("FeaturesMessage", "Settings applied");
        StringAssert.Contains(File.ReadAllText(Path.Combine(app.DataRoot, "settings.json")), "\"instantImages\": false");
        StringAssert.Contains(File.ReadAllText(config), "\"instantImages\": false");

        // Back to the defaults.
        app.Invoke("FeaturesReset");
        AppSession.WaitUntil(() => AppSession.ToggleStateOf(images) == ToggleState.On, "the default value shown");
        app.Invoke("FeaturesApply");
        AppSession.WaitUntil(() => File.ReadAllText(config).Contains("\"instantImages\": true", StringComparison.Ordinal), "the default in config.js");
    }

    [TestMethod]
    public void FeaturesSaveTheChosenLayout()
    {
        using var app = AppSession.Start();
        app.Navigate("NavFeatures");
        AppSession.Expand(app.FindByName("Aircraft gallery and list", "Expander"));
        Assert.IsTrue(AppSession.IsSelected(app.Find("Choice_aircraftGallery_layout_classic")), "Classic by default");

        app.Navigate("Choice_aircraftGallery_layout_sideBySide");
        app.Invoke("FeaturesApply");
        app.WaitForText("FeaturesMessage", "Settings saved");

        StringAssert.Contains(File.ReadAllText(Path.Combine(app.DataRoot, "settings.json")), "\"layout\": \"sideBySide\"");
        Assert.IsTrue(AppSession.IsSelected(app.Find("Choice_aircraftGallery_layout_sideBySide")));
    }

    [TestMethod]
    public void FeaturesApplyWithoutPackageOnlySaves()
    {
        using var app = AppSession.Start();
        app.WaitForText("HomePackageStatus", "Not installed");

        app.Navigate("NavFeatures");
        AppSession.Toggle(app.FindByName("Tail number per livery", "ToggleSwitch"));
        app.Invoke("FeaturesApply");
        app.WaitForText("FeaturesMessage", "Settings saved");

        StringAssert.Contains(File.ReadAllText(Path.Combine(app.DataRoot, "settings.json")), "\"tailNumber\": {\n      \"enabled\": false");
        Assert.IsFalse(Directory.Exists(app.PackageFolder), "no package generated");
    }

    [TestMethod]
    public void FeaturesAskBeforeReplacingTheSettingsOfANewerVersion()
    {
        const string NewerSettings = """{ "schemaVersion": 2, "features": { "aFutureFeature": { "enabled": true } } }""";
        using var app = AppSession.Start(NewerSettings);
        var settingsFile = Path.Combine(app.DataRoot, "settings.json");

        app.Navigate("NavFeatures");
        app.WaitForText("FeaturesMessage", "Settings saved by a newer version");
        AppSession.Toggle(app.Find("FeatureSwitch_tailNumber"));

        // Cancel keeps the newer settings as they are.
        app.Invoke("FeaturesApply");
        var dialog = app.Dialog("Replace the newer settings?");
        AppSession.Invoke(dialog.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, "Cancel")));
        Assert.AreEqual(NewerSettings, File.ReadAllText(settingsFile), "nothing written");

        app.Invoke("FeaturesApply");
        dialog = app.Dialog("Replace the newer settings?");
        AppSession.Invoke(dialog.FindFirst(TreeScope.Descendants, new AndCondition(
            new PropertyCondition(AutomationElement.NameProperty, "Apply anyway"),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button))));
        // The text of a save without package (the warning above also starts with "Settings saved").
        app.WaitForText("FeaturesMessage", "The package is not installed");
        StringAssert.Contains(File.ReadAllText(settingsFile), "\"tailNumber\": {\n      \"enabled\": false");
    }

    [TestMethod]
    public void CompatibilityChecksTheSimFilesAndSkipsTheLiveChecks()
    {
        using var app = AppSession.Start();

        app.Navigate("NavCompatibility");
        var summary = app.WaitForText("CompatibilitySummary", "skipped");
        StringAssert.Contains(summary, "checks", "summary of the checks");
        Assert.IsNotNull(app.FindByName($"Sim files (fs-base-ui {AppSession.FsBaseUiVersion})", "TextBlock"));
    }

    [TestMethod]
    public void TheReadmeSaysNoSimFileIsModified()
    {
        using var app = AppSession.Start();

        app.Navigate("NavReadme");

        app.WaitForText("ReadmeNoSimFile", "No file of the simulator is modified");
        app.WaitForText("ReadmeVersion", "MSFS-UI-GENERATOR 1.2.0");
    }

    [TestMethod]
    public void LogShowsTheAppOperations()
    {
        using var app = AppSession.Start();

        app.Navigate("NavLog");
        AppSession.WaitUntil(
            () => AppSession.Texts(app.Find("LogAppLines")).Contains("MSFS-UI", StringComparison.Ordinal),
            "the start-up line in the app log");
    }
}
