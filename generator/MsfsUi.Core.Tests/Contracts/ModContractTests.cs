using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using MsfsUi.Core.Compatibility;
using MsfsUi.Core.Features;

namespace MsfsUi.Core.Tests.Contracts;

/// <summary>
/// The contract between the app and the menu mod (see Contracts in docs/development.md), on the real files of <c>mod/</c>. The settings
/// modules generated here are kept as fixtures in <c>mod/test/fixtures/</c>, where the mod's own tests
/// (<c>config-contract.test.ts</c>) read them with the mod's code: both sides agree on the same bytes.
/// Set <c>MSFS_UI_UPDATE_FIXTURES=1</c> to rewrite the fixtures after a change of <c>features.json</c>.
/// </summary>
[TestClass]
public sealed class ModContractTests
{
    private const string FixtureGenerator = "0.0.0-fixture";

    [TestMethod]
    public void TheRealFeatureCatalogueIsValid()
    {
        var catalog = RealCatalog();

        Assert.IsGreaterThanOrEqualTo(7, catalog.Features.Count);
        foreach (var id in (string[])["fastMenus", "weatherBar", "timeWheel", "tailNumber", "aircraftSetup", "aircraftGallery", "freeflightFavorites"])
        {
            Assert.IsNotNull(catalog.Find(id), $"feature {id} of 0.3.0 is missing");
        }

        var packageJson = JsonDocument.Parse(File.ReadAllText(Path.Combine(ModFolder(), "package.json")));
        Assert.AreEqual(packageJson.RootElement.GetProperty("version").GetString(), catalog.ModVersion);
    }

    /// <summary>
    /// The app's version files follow the mod's (<c>modVersion</c>): the build's, and the package manifest's, which only
    /// <c>winapp run</c> reads (the app's development identity; the release is unpackaged): it was left at 2.0.0.0 for
    /// four versions.
    /// </summary>
    [TestMethod]
    public void TheAppVersionFilesHaveTheModVersion()
    {
        var version = RealCatalog().ModVersion;
        var generator = Path.Combine(ModFolder(), "..", "generator");

        var props = XDocument.Load(Path.Combine(generator, "Directory.Build.props"));
        Assert.AreEqual(version, props.Descendants("Version").Single().Value, "Directory.Build.props");

        var manifest = XDocument.Load(Path.Combine(generator, "MsfsUi.App", "Package.appxmanifest"));
        XNamespace appx = "http://schemas.microsoft.com/appx/manifest/foundation/windows10";
        Assert.AreEqual($"{version}.0", manifest.Root!.Element(appx + "Identity")!.Attribute("Version")!.Value, "Package.appxmanifest");
    }

    [TestMethod]
    public void TheRealCompatibilityManifestIsValid()
    {
        var manifest = CompatManifest.Parse(File.ReadAllText(Path.Combine(ModFolder(), "compat.json")));

        Assert.IsNotEmpty(manifest.Screens);
        Assert.IsNotEmpty(manifest.LiveChecks);
    }

    [TestMethod]
    public void DefaultSettingsModuleMatchesTheFixture() =>
        AssertFixture("config.defaults.js", SettingsNormalizer.Normalize(RealCatalog(), null));

    [TestMethod]
    public void CustomSettingsModuleMatchesTheFixture()
    {
        var settings = FeatureSettings.TryParse("""
            { "schemaVersion": 1, "features": {
              "fastMenus": { "enabled": true, "options": { "speed": 3, "instantImages": false } },
              "weatherBar": { "enabled": false },
              "timeWheel": { "options": { "step": 120, "fastStep": 1800 } },
              "aircraftSetup": { "options": { "widenColumn": 0 } },
              "aircraftGallery": { "options": { "layout": "sideBySide" } }
            } }
            """)!;
        var result = SettingsNormalizer.Normalize(RealCatalog(), settings);

        Assert.IsEmpty(result.Adjustments);
        AssertFixture("config.custom.js", result);
    }

    private static void AssertFixture(string name, NormalizationResult result)
    {
        var expected = ConfigScript.Generate(result.Selection, FixtureGenerator);
        var path = Path.Combine(ModFolder(), "test", "fixtures", name);
        if (Environment.GetEnvironmentVariable("MSFS_UI_UPDATE_FIXTURES") == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, expected, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        }

        Assert.IsTrue(File.Exists(path), $"{path} is missing: run the tests with MSFS_UI_UPDATE_FIXTURES=1");
        Assert.AreEqual(expected, File.ReadAllText(path), $"{name} is out of date: run the tests with MSFS_UI_UPDATE_FIXTURES=1, then the mod's tests");
    }

    [TestMethod]
    public void TheStorageProbeLooksForTheModsOwnKeys()
    {
        var storage = File.ReadAllText(Path.Combine(ModFolder(), "src", "core", "storage.ts"));
        var favorites = File.ReadAllText(Path.Combine(ModFolder(), "src", "sim", "favorites.ts"));
        var keys = Regex.Match(storage, @"const DATASTORAGE_KEYS = \[([^\]]*)\]");
        var old = Regex.Match(favorites, @"const OLD_FAVORITE_AIRCRAFT_KEY = '([A-Z_]+)'");
        Assert.IsTrue(keys.Success, "DATASTORAGE_KEYS not found in storage.ts");
        Assert.IsTrue(old.Success, "OLD_FAVORITE_AIRCRAFT_KEY not found in favorites.ts");

        var modKeys = Regex.Matches(keys.Groups[1].Value, "'([A-Z_]+)'").Select(match => match.Groups[1].Value).Append(old.Groups[1].Value).Order();

        CollectionAssert.AreEqual(modKeys.ToList(), CompatibilityChecker.ModDataKeys.Order().ToList());
    }

    /// <summary>The mod's real catalogue (<c>mod/features.json</c>).</summary>
    internal static FeatureCatalog RealCatalog() => FeatureCatalog.Parse(File.ReadAllText(Path.Combine(ModFolder(), "features.json")));

    /// <summary>The repository's <c>mod</c> folder, found from this source file.</summary>
    private static string ModFolder([CallerFilePath] string source = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(source)!, "..", "..", "..", "mod"));
}
