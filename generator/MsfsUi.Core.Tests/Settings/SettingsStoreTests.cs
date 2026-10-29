using Microsoft.Extensions.Logging.Abstractions;
using MsfsUi.Core.Features;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Settings;
using MsfsUi.Core.Tests.Features;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Settings;

[TestClass]
public sealed class SettingsStoreTests
{
    public TestContext TestContext { get; set; } = null!;

    private static SettingsStore Store(TempFolder folder) => new(new AppPaths(folder.Path), NullLogger<SettingsStore>.Instance);

    [TestMethod]
    public async Task AMissingSettingsFileIsNotAProblem()
    {
        using var folder = new TempFolder();

        var load = await Store(folder).LoadFeatureSettingsAsync(TestContext.CancellationToken);

        Assert.IsNull(load.Settings);
        Assert.IsNull(load.Problem);
    }

    [TestMethod]
    public async Task SettingsAreSavedAndReadBack()
    {
        using var folder = new TempFolder();
        var store = Store(folder);
        var catalog = FeatureCatalog.Parse(FeatureTestData.Catalog);
        var settings = SettingsNormalizer.Normalize(catalog, null).Selection.ToSettings();

        await store.SaveFeatureSettingsAsync(settings, TestContext.CancellationToken);
        var load = await store.LoadFeatureSettingsAsync(TestContext.CancellationToken);

        Assert.IsNull(load.Problem);
        Assert.AreEqual(settings.ToJson(), load.Settings!.ToJson());
        Assert.IsFalse(File.Exists(folder["settings.json.tmp"]), "the temporary file is renamed");
    }

    [TestMethod]
    public async Task AnUnreadableSettingsFileIsReported()
    {
        using var folder = new TempFolder();
        folder.Write("settings.json", "{ not json");

        var load = await Store(folder).LoadFeatureSettingsAsync(TestContext.CancellationToken);

        Assert.IsNull(load.Settings);
        Assert.Contains("could not be read", load.Problem!);
    }

    [TestMethod]
    public async Task PreferencesDefaultWhenMissingOrUnreadable()
    {
        using var folder = new TempFolder();
        var store = Store(folder);

        Assert.AreEqual(AppPreferences.Default, await store.LoadPreferencesAsync(TestContext.CancellationToken));
        folder.Write("app.json", "[1, 2");
        Assert.AreEqual(AppPreferences.Default, await store.LoadPreferencesAsync(TestContext.CancellationToken));
    }

    [TestMethod]
    public async Task PreferencesAreSavedAndReadBack()
    {
        using var folder = new TempFolder();
        var store = Store(folder);
        var preferences = new AppPreferences(@"D:\MSFS\Community", @"D:\MSFS\Official\fs-base-ui");

        await store.SavePreferencesAsync(preferences, TestContext.CancellationToken);

        Assert.AreEqual(preferences, await store.LoadPreferencesAsync(TestContext.CancellationToken));
    }
}

[TestClass]
public sealed class AppPreferencesTests
{
    [TestMethod]
    public void TheDefaultsLeaveTheDetectionAlone()
    {
        var options = AppPreferences.Default.ToLocatorOptions();

        Assert.IsFalse(AppPreferences.Default.HasManualFolders);
        Assert.IsNull(options.CommunityPath);
        Assert.IsNull(options.FsBaseUiPath);
        Assert.AreEqual("{}\n", AppPreferences.Default.ToJson());
    }

    [TestMethod]
    public void TheThemeIsStoredByName()
    {
        var preferences = new AppPreferences(Theme: AppTheme.Dark);

        StringAssert.Contains(preferences.ToJson(), "\"theme\": \"dark\"");
        Assert.AreEqual(preferences, AppPreferences.TryParse(preferences.ToJson()));
        Assert.AreEqual(AppTheme.Light, AppPreferences.TryParse("{ \"theme\": \"light\" }")!.Theme);
        Assert.IsFalse(preferences.HasManualFolders, "a theme is not a folder");
    }

    [TestMethod]
    public void ManualFoldersBecomeLocatorOptions()
    {
        var preferences = new AppPreferences(CommunityPath: @"D:\Community");
        var options = preferences.ToLocatorOptions();

        Assert.IsTrue(preferences.HasManualFolders);
        Assert.AreEqual(@"D:\Community", options.CommunityPath);
        Assert.IsNull(options.FsBaseUiPath);
        Assert.DoesNotContain("hasManualFolders", preferences.ToJson());
    }
}

[TestClass]
public sealed class PackageInputsTests
{
    [TestMethod]
    public void TheModInputsCarryTheCatalogueVersionAndTheSettingsModule()
    {
        var catalog = FeatureCatalog.Parse(FeatureTestData.Catalog);
        var selection = SettingsNormalizer.Normalize(catalog, null).Selection;
        byte[] mod = [1, 2, 3];
        byte[] vault = [4, 5];

        var inputs = PackageInputs.ForMod(catalog, mod, vault, selection);

        Assert.AreEqual("1.0.0", inputs.Version);
        CollectionAssert.AreEqual(mod, inputs.ModScript.ToArray());
        CollectionAssert.AreEqual(vault, inputs.VaultModule.ToArray());
        Assert.AreEqual(ConfigScript.Generate(selection, ProductInfo.Version), inputs.ConfigScript);
    }
}
