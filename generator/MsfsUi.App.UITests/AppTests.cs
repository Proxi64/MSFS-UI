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
    public void AnotherModReplacingTheMenuPageBlocksTheInstallationUntilRemoved()
    {
        using var app = AppSession.Start();
        app.WaitForText("HomePackageStatus", "Not installed");
        var other = Path.Combine(app.Community, "other-ui");
        Directory.CreateDirectory(Path.Combine(other, "cookedcomps"));
        File.WriteAllText(Path.Combine(other, "cookedcomps", AppSession.MasterPageGuid + ".html"), "<ui-resource-element></ui-resource-element>");

        // The app reads the Community folder again every 5 seconds.
        app.WaitForText("HomeConflicts", "remove other-ui from the Community folder");
        var install = app.Find("HomeInstall");
        AppSession.WaitUntil(() => !install.Current.IsEnabled, "Generate & install disabled");

        Directory.Delete(other, recursive: true);
        AppSession.WaitUntil(() => install.Current.IsEnabled, "Generate & install enabled again");
        Assert.IsNull(app.TryFind("HomeConflicts"), "the banner closed");
    }

    [TestMethod]
    public void UninstallEverythingDeletesTheModTheVaultAndTheAppDataThenCloses()
    {
        if (AppSession.RealSimRunning)
        {
            Assert.Inconclusive("The real sim is running: the uninstall waits for it to close.");
        }

        using var app = AppSession.Start();
        app.WaitForText("HomePackageStatus", "Not installed");
        app.Invoke("HomeInstall");
        app.WaitForText("HomePackageStatus", "Installed and up to date");
        var vault = Path.Combine(app.RoamingAppData, "Microsoft Flight Simulator 2024", "WASM", "MSFS2024", "msfs-ui");
        Directory.CreateDirectory(Path.Combine(vault, "work"));
        File.WriteAllText(Path.Combine(vault, "work", "vault-a.head"), "1");

        // Cancel, the default button, deletes nothing.
        app.Invoke("HomeUninstall");
        var cancel = AppSession.DialogButton(app.Dialog("Uninstall MSFS-UI completely?"), "Cancel");
        AppSession.WaitUntil(() => cancel.Current.HasKeyboardFocus, "Cancel has the focus");
        AppSession.Invoke(cancel);
        Assert.IsTrue(Directory.Exists(app.PackageFolder) && Directory.Exists(vault) && Directory.Exists(app.DataRoot), "everything kept");

        app.Invoke("HomeUninstall");
        var dialog = app.Dialog("Uninstall MSFS-UI completely?");
        AppSession.WaitUntil(() => AppSession.Texts(dialog).Contains(vault, StringComparison.Ordinal), "the vault listed in the dialog");
        AppSession.Invoke(AppSession.DialogButton(dialog, "Uninstall"));
        AppSession.Invoke(AppSession.DialogButton(app.Dialog("MSFS-UI is uninstalled"), "Close"));
        AppSession.WaitUntil(() => app.HasExited, "the app closed");

        Assert.IsFalse(Directory.Exists(app.PackageFolder), "the package deleted");
        Assert.IsFalse(Directory.Exists(vault), "the vault deleted");
        Assert.IsFalse(Directory.Exists(app.DataRoot), "the app's data deleted, its log included");
        Assert.IsTrue(Directory.Exists(Path.Combine(app.Root, "fs-base-ui")), "the sim's files untouched");
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
        var cancel = AppSession.DialogButton(app.Dialog("Remove the package?"), "Cancel");
        AppSession.WaitUntil(() => cancel.Current.HasKeyboardFocus, "Cancel has the focus");
        AppSession.Invoke(cancel);
        Assert.IsTrue(Directory.Exists(app.PackageFolder), "package kept");

        app.Invoke("HomeRemove");
        AppSession.Invoke(AppSession.DialogButton(app.Dialog("Remove the package?"), "Remove"));
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
        AppSession.Invoke(AppSession.DialogButton(app.Dialog("Replace the newer settings?"), "Cancel"));
        Assert.AreEqual(NewerSettings, File.ReadAllText(settingsFile), "nothing written");

        app.Invoke("FeaturesApply");
        AppSession.Invoke(AppSession.DialogButton(app.Dialog("Replace the newer settings?"), "Apply anyway"));
        // The text of a save without package (the warning above also starts with "Settings saved").
        app.WaitForText("FeaturesMessage", "The package is not installed");
        StringAssert.Contains(File.ReadAllText(settingsFile), "\"tailNumber\": {\n      \"enabled\": false");
    }

    [TestMethod]
    public void ANumberBeingTypedEnablesApplyBeforeTheBoxLosesTheFocus()
    {
        using var app = AppSession.Start();
        app.WaitForText("HomePackageStatus", "Not installed");
        app.Navigate("NavFeatures");
        AppSession.Expand(app.FindByName("Fast menus", "Expander"));
        var input = app.Find("Option_fastMenus_speed").FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
        Assert.IsNotNull(input, "the number box's text");
        var apply = app.Find("FeaturesApply");
        Assert.IsFalse(apply.Current.IsEnabled, "nothing to apply yet");

        input.SetFocus();
        ((ValuePattern)input.GetCurrentPattern(ValuePattern.Pattern)).SetValue("3");
        AppSession.WaitUntil(() => apply.Current.IsEnabled, "Apply enabled while the box has the focus");
        Assert.IsTrue(input.Current.HasKeyboardFocus, "still in the box");

        // Typing the value back: no change any more.
        ((ValuePattern)input.GetCurrentPattern(ValuePattern.Pattern)).SetValue("2");
        AppSession.WaitUntil(() => !apply.Current.IsEnabled, "Apply disabled again");

        // A click takes the focus (on the press), which gives the box its value before the command runs (on the release).
        ((ValuePattern)input.GetCurrentPattern(ValuePattern.Pattern)).SetValue("3");
        AppSession.WaitUntil(() => apply.Current.IsEnabled, "Apply enabled again");
        apply.SetFocus();
        var box = (RangeValuePattern)app.Find("Option_fastMenus_speed").GetCurrentPattern(RangeValuePattern.Pattern);
        AppSession.WaitUntil(() => box.Current.Value.Equals(3d), "the box's value once it lost the focus");
        AppSession.Invoke(apply);
        app.WaitForText("FeaturesMessage", "Settings saved");
        var saved = File.ReadAllText(Path.Combine(app.DataRoot, "settings.json"));
        Assert.IsTrue(saved.Contains("\"speed\": 3", StringComparison.Ordinal), saved);
    }

    [TestMethod]
    public void AnUnreadableSettingsFileCanBeWrittenAgain()
    {
        using var app = AppSession.Start("not json");
        var settingsFile = Path.Combine(app.DataRoot, "settings.json");

        app.Find("HomeSettingsProblem");
        app.Navigate("NavFeatures");
        app.WaitForText("FeaturesMessage", "Settings not read");
        app.Invoke("FeaturesApply");

        AppSession.WaitUntil(() => File.ReadAllText(settingsFile).Contains("schemaVersion", StringComparison.Ordinal), "the file written again");
    }

    [TestMethod]
    public void HomeKeepsTheOutcomeOfItsActionAcrossAVisitToAnotherPage()
    {
        using var app = AppSession.Start();
        app.WaitForText("HomePackageStatus", "Not installed");
        app.Invoke("HomeInstall");
        app.WaitForText("HomeMessage", "installed");

        app.Navigate("NavLog");
        app.Find("LogCopy");
        app.Navigate("NavHome");

        app.WaitForText("HomeMessage", "installed");
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
        app.WaitForText("ReadmeVersion", $"MSFS-UI-GENERATOR {app.Version}");
    }

    [TestMethod]
    public void LogShowsTheAppOperations()
    {
        using var app = AppSession.Start();

        app.Navigate("NavLog");
        AppSession.WaitUntil(
            () => AppSession.Texts(app.Find("LogAppLines")).Contains("MSFS-UI", StringComparison.Ordinal),
            "the start-up line in the app log");
        Assert.IsFalse(AppSession.Texts(app.Find("LogAppLines")).Contains("IsProblem", StringComparison.Ordinal), "each line named by its text, not by its record");
    }
}
