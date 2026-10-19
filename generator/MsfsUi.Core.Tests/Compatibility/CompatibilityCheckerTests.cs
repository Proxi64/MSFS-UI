using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using MsfsUi.Core.Coherent;
using MsfsUi.Core.Compatibility;
using MsfsUi.Core.Tests.Coherent;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Compatibility;

[TestClass]
public sealed class CompatibilityCheckerTests
{
    private static readonly string[] ExpectedExports = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];

    public TestContext TestContext { get; set; } = null!;

    /// <summary>The real manifest of the mod (<c>mod/compat.json</c>).</summary>
    internal static CompatManifest RealManifest() =>
        CompatManifest.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "compat.json")));

    private static CompatibilityChecker Checker(string host) =>
        new(CoherentInspectorTests.Inspector(host), NullLogger<CompatibilityChecker>.Instance);

    /// <summary>A fake fs-base-ui providing everything the manifest asks for.</summary>
    private static string CompatibleFsBaseUi(TempFolder folder, CompatManifest manifest)
    {
        var root = FakeFsBaseUi.Create(folder);
        folder.Write("fs-base-ui/html_ui/Global/engine_ui.bundle.js", ExportList(manifest.Exports[0].Names));
        folder.Write("fs-base-ui/html_ui/Global/shared/utils.js", "export*from\"/Global/shared/common.js\";");
        folder.Write("fs-base-ui/html_ui/Global/shared/common.js", ExportList(manifest.Exports[1].Names));
        folder.Write("fs-base-ui/html_ui/Global/shared/store.js", ExportList(manifest.Exports[2].Names));
        folder.Write("fs-base-ui/html_ui/Global/pkg/base.bundle.js", string.Join(';', manifest.Screens.Select(s => $"Manipulator({{name:\"{s.ClassName}\",guid:\"{s.ComponentGuid}\"}})")));
        folder.Write("fs-base-ui/html_ui/Global/pkgCore.se.js", string.Join(',', manifest.Symbols.SelectMany(group => group.Names).Select(name => $"\"{name}\"")));
        folder.Write("fs-base-ui/cookedcomps/{00000000-0000-0000-0000-000000000001}.html",
            "<ui-resource-element name=\"PlaneSelection_Content\">"
            + "<ui-element name=\"LeftBlock\" style=\"width: calc(var(--unscaledScreenHeight) * 470px / 1080);\"></ui-element>"
            + "<ui-element name=\"RightBlock\" style=\"left: calc(var(--h-anchor) + calc(var(--unscaledScreenHeight) * 574px / 1080));\"></ui-element>"
            + string.Concat(manifest.Anchors.Select(anchor => $"<ui-element name=\"{anchor}\"></ui-element>"))
            + "</ui-resource-element>");
        foreach (var file in manifest.Files)
        {
            folder.Write($"fs-base-ui/{file}", "<svg/>");
        }

        foreach (var component in manifest.Components)
        {
            WriteComponent(folder, component.ComponentGuid, component.Name, component.Attributes ?? [], component.States ?? [], component.Values ?? [], component.Children ?? []);
        }

        return root;
    }

    /// <summary>A cooked component: its root element and its metadata (exposed attributes, visual states).</summary>
    private static void WriteComponent(TempFolder folder, string guid, string name, IEnumerable<string> attributes, IEnumerable<string> states, IEnumerable<string>? values = null, IEnumerable<string>? children = null)
    {
        var inner = string.Concat((children ?? ["Child"]).Select(child => $"<ui-element name=\"{child}\"></ui-element>"));
        folder.Write($"fs-base-ui/cookedcomps/{guid}.html", $"<ui-resource-element resource-id=\"{guid}\" name=\"{name}\" class=\"absolute\">{inner}</ui-resource-element>");
        var metadata = new
        {
            exposedAttributes = attributes.Select(attribute => new { name = attribute, data = new { property = "textValue" } }),
            visualStates = states.Select(state => new { name = state, elements = Array.Empty<object>() }),
            exposedValues = (values ?? []).ToDictionary(value => value, _ => "#FFFFFFFF"),
        };
        folder.Write($"fs-base-ui/cookedcomps/{guid}.json", System.Text.Json.JsonSerializer.Serialize(metadata));
    }

    private static string ExportList(IEnumerable<string> names) =>
        "export{" + string.Join(',', names.Select((name, i) => i % 2 == 0 ? $"x{i} as {name}" : name)) + "};";

    /// <summary>
    /// The mod's manifest keeps at least what 0.3.0 checked (its sections grow as features are ported): a section that
    /// empties by mistake fails here.
    /// </summary>
    [TestMethod]
    public void TheRealManifestOfTheModIsComplete()
    {
        var manifest = RealManifest();

        Assert.IsGreaterThanOrEqualTo(3, manifest.Exports.Count);
        Assert.IsGreaterThanOrEqualTo(2, manifest.Screens.Count);
        Assert.IsGreaterThanOrEqualTo(4, manifest.Components.Count);
        Assert.IsGreaterThanOrEqualTo(11, manifest.Anchors.Count);
        Assert.IsGreaterThanOrEqualTo(1, manifest.ComponentPatterns.Count);
        Assert.IsGreaterThanOrEqualTo(52, manifest.Symbols.SelectMany(group => group.Names).Count());
        Assert.IsGreaterThanOrEqualTo(1, manifest.Files.Count);
        Assert.IsGreaterThanOrEqualTo(4, manifest.ColorVariables.Count);
        Assert.IsGreaterThanOrEqualTo(14, manifest.Translations.Count);
        Assert.IsGreaterThanOrEqualTo(19, manifest.LiveChecks.Count);
    }

    [TestMethod]
    public void TheLiveProbeOfTheRealManifestIsValidJavaScript()
    {
        var probe = CompatibilityChecker.LiveProbe(RealManifest());

        Assert.IsTrue(FakeCoherentPage.Parses(probe, out var error), error);
    }

    [TestMethod]
    public async Task EverythingIsFoundInACompatibleFsBaseUi()
    {
        using var folder = new TempFolder();
        var manifest = RealManifest();
        var fsBaseUi = CompatibleFsBaseUi(folder, manifest);

        var results = await Checker("127.0.0.1:1").CheckOfflineAsync(manifest, fsBaseUi, TestContext.CancellationToken);

        var failures = results.Where(result => !result.Ok).Select(result => $"{result.Group}: {result.Label}").ToList();
        Assert.IsEmpty(failures, string.Join("; ", failures));
        // One check per export, screen, component, anchor, component pattern, symbol and file of the manifest.
        var expected = manifest.Exports.Sum(module => module.Names.Count) + manifest.Screens.Count + manifest.Components.Count + manifest.Anchors.Count
            + manifest.ComponentPatterns.Count + manifest.Symbols.Sum(group => group.Names.Count) + manifest.Files.Count;
        Assert.HasCount(expected, results);
    }

    [TestMethod]
    public async Task DetectsAMissingExportAnchorSymbolFileAndColumnFormat()
    {
        using var folder = new TempFolder();
        var manifest = RealManifest();
        var fsBaseUi = CompatibleFsBaseUi(folder, manifest);
        folder.Write("fs-base-ui/html_ui/Global/shared/store.js", "export{Other};");
        folder.Write("fs-base-ui/html_ui/Global/pkgCore.se.js", "\"timeData\"");
        folder.Write("fs-base-ui/cookedcomps/{00000000-0000-0000-0000-000000000001}.html", "<ui-element name=\"LeftBlock\" style=\"width: 470px;\"></ui-element>");
        File.Delete(Path.Combine(fsBaseUi, manifest.Files[0].Replace('/', Path.DirectorySeparatorChar)));

        var failed = (await Checker("127.0.0.1:1").CheckOfflineAsync(manifest, fsBaseUi, TestContext.CancellationToken))
            .Where(result => !result.Ok)
            .ToList();

        Assert.IsTrue(failed.Any(result => result.Label == "ReadableStore (shared/store.js)" && result.Detail == "export not found"));
        Assert.IsTrue(failed.Any(result => result.Label == "name=\"Fleet_Details\""));
        Assert.IsTrue(failed.Any(result => result.Label == "SetLiveOffset"));
        Assert.IsFalse(failed.Any(result => result.Label == "timeData"));
        Assert.IsTrue(failed.Any(result => result.Group == "Aircraft selection columns"));
        Assert.IsTrue(failed.Any(result => result.Group == "Files"));
    }

    [TestMethod]
    public async Task DetectsAMissingRenamedOrChangedSimComponent()
    {
        using var folder = new TempFolder();
        var manifest = RealManifest() with
        {
            Components =
            [
                new ComponentRequirement("Tile", "{00000000-0000-0000-0000-00000000000A}", "TileButton", ["Title"], ["Selected"], Children: ["Content"]),
                new ComponentRequirement("Moved", "{00000000-0000-0000-0000-00000000000E}", "TileButton", Children: ["CornerWhite"]),
                new ComponentRequirement("Odd", "{00000000-0000-0000-0000-00000000000F}", "TextTab", ["Text"]),
                new ComponentRequirement("Tab", "{00000000-0000-0000-0000-00000000000B}", "TextTab", ["Text"], []),
                new ComponentRequirement("Gone", "{00000000-0000-0000-0000-00000000000C}", "Separator"),
                new ComponentRequirement("Changed", "{00000000-0000-0000-0000-00000000000D}", "IconButton_Squared", ["Icon", "IconColor"], ["Selected", "Hover"], ["Color_VFR"]),
            ],
        };
        var fsBaseUi = CompatibleFsBaseUi(folder, manifest);
        WriteComponent(folder, "{00000000-0000-0000-0000-00000000000B}", "TextTab_Renamed", ["Text"], []);
        WriteComponent(folder, "{00000000-0000-0000-0000-00000000000E}", "TileButton", [], [], children: ["Corner"]);
        folder.Write("fs-base-ui/cookedcomps/{00000000-0000-0000-0000-00000000000F}.json", """{ "exposedAttributes": ["Text", { "name": 3 }], "visualStates": "none" }""");
        File.Delete(Path.Combine(fsBaseUi, "cookedcomps", "{00000000-0000-0000-0000-00000000000C}.json"));
        WriteComponent(folder, "{00000000-0000-0000-0000-00000000000D}", "IconButton_Squared", ["Icon"], ["Hover"], ["Color_IFR"]);

        var components = (await Checker("127.0.0.1:1").CheckOfflineAsync(manifest, fsBaseUi, TestContext.CancellationToken))
            .Where(result => result.Group == "Sim components")
            .ToDictionary(result => result.Label[..result.Label.IndexOf(':', StringComparison.Ordinal)]);

        Assert.IsTrue(components["Tile"].Ok);
        Assert.AreEqual("missing: child CornerWhite", components["Moved"].Detail);
        Assert.AreEqual("missing: attribute Text", components["Odd"].Detail, "entries of another shape are skipped, not thrown on");
        Assert.AreEqual("the component has another name", components["Tab"].Detail);
        Assert.AreEqual("component not found", components["Gone"].Detail);
        Assert.AreEqual("missing: attribute IconColor, state Selected, value Color_VFR", components["Changed"].Detail);
    }

    [TestMethod]
    public void ModuleExportsFollowAliasesDeclarationsAndReexports()
    {
        var scripts = new Dictionary<string, string>
        {
            ["Global/a.js"] = "export{x as Alpha,Beta};export class Gamma{}export async function Delta(){}export*from\"./b.js\";",
            ["Global/b.js"] = "export const Epsilon=1;export*from\"/Global/sub/c.js\";",
            ["Global/sub/c.js"] = "export let Zeta;export*from\"../a.js\";",
        };

        var names = CompatibilityChecker.ModuleExports(scripts, "Global/a.js");

        CollectionAssert.AreEquivalent(ExpectedExports, names.ToArray(), "cycles are followed once");
        Assert.IsEmpty(CompatibilityChecker.ModuleExports(scripts, "Global/missing.js"));
    }

    [TestMethod]
    public void TheLiveProbeAnswerIsReadAndAnUnexpectedShapeIsAFailedProbe()
    {
        static EvalResult Answer(string json) => new(true, JsonDocument.Parse(json).RootElement.Clone(), null);

        var read = CompatibilityChecker.ProbeResults(Answer("""[{ "group": "Mod", "label": "loaded", "ok": true, "detail": "1.0.0" }]"""));
        Assert.AreEqual(new CheckResult("Mod", "loaded", true, "1.0.0"), read.Single());

        // A detail that is not text (a check of compat.json returning a number) must not throw.
        var odd = CompatibilityChecker.ProbeResults(Answer("""[{ "group": "Mod", "label": "loaded", "ok": true, "detail": 42 }]"""));
        Assert.IsTrue(odd.Single() is { Group: "Mod", Label: "live probe", Ok: false });
        Assert.IsTrue(CompatibilityChecker.ProbeResults(EvalResult.Failure("boom")).Single() is { Ok: false, Detail: "boom" });
        Assert.IsTrue(CompatibilityChecker.ProbeResults(Answer("{}")).Single() is { Ok: false, Detail: "unexpected answer" });
    }

    [TestMethod]
    public void TheLiveProbeTurnsEveryDetailIntoText()
    {
        // Its add() gives the shape ProbeResults reads, whatever a live check returns.
        StringAssert.Contains(CompatibilityChecker.LiveProbe(RealManifest()), "detail: detail === undefined || detail === null ? '' : String(detail)");
    }

    [TestMethod]
    public async Task LiveChecksAreSkippedWhenTheSimIsClosed()
    {
        var results = await Checker($"127.0.0.1:{FakeInspectorServer.FreePort()}").CheckLiveAsync(RealManifest(), TestContext.CancellationToken);

        Assert.IsNull(results);
    }

    [TestMethod]
    public void TheLiveProbeTimeoutCoversEveryCheck()
    {
        // Each check's own limit (3 s when absent), plus 15 s for the fixed part.
        var manifest = RealManifest();
        var expected = TimeSpan.FromSeconds(15) + TimeSpan.FromMilliseconds(manifest.LiveChecks.Sum(check => check.TimeoutMs ?? 3000));
        Assert.AreEqual(expected, CompatibilityChecker.LiveProbeTimeout(manifest));
    }

    [TestMethod]
    public async Task LiveChecksAreSkippedWhenTheSimStopsAnswering()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page) { Unresponsive = true };
        var checker = new CompatibilityChecker(CoherentInspectorTests.Inspector(server.Host, requestTimeout: TimeSpan.FromMilliseconds(300)), NullLogger<CompatibilityChecker>.Instance);

        Assert.IsNull(await checker.CheckLiveAsync(RealManifest(), TestContext.CancellationToken));
    }

    [TestMethod]
    public async Task AFailedProbeIsReportedWithTheConsoleCheck()
    {
        using var page = new FakeCoherentPage();
        page.Console.Add(("error", "[msfs-ui] boom"));
        await using var server = new FakeInspectorServer(page);

        // The fake page cannot import the sim's modules: the probe fails as a whole and says why.
        var results = await Checker(server.Host).CheckLiveAsync(RealManifest(), TestContext.CancellationToken);

        Assert.IsNotNull(results);
        Assert.IsTrue(results.Any(result => result is { Group: "Mod", Label: "live probe", Ok: false }));
        Assert.IsTrue(results.Any(result => result is { Group: "Console", Ok: false, Detail: "[error] [msfs-ui] boom" }));
    }

    [TestMethod]
    public async Task OnlyErrorsSinceTheModWasLastLoadedCount()
    {
        using var page = new FakeCoherentPage();
        page.Console.Add(("error", "[msfs-ui] settings from the defaults, with problems: old version"));
        page.Console.Add(("log", "[msfs-ui] module loaded (version 1.0.0, build 2026-10-17T12:00:00Z)"));
        page.Console.Add(("error", "[msfs-ui] boom after the reload"));
        page.Console.Add(("log", "[msfs-ui] module loaded (version 1.0.0, build 2026-10-17T12:05:00Z)"));
        page.Console.Add(("log", "[msfs-ui] features started: none"));
        await using var server = new FakeInspectorServer(page);

        var results = await Checker(server.Host).CheckLiveAsync(RealManifest(), TestContext.CancellationToken);

        Assert.IsNotNull(results);
        Assert.IsTrue(results.Any(result => result is { Group: "Console", Ok: true }), "errors of the versions unloaded since do not count");
    }

    [TestMethod]
    public void ManifestRejectsAnotherSchemaVersionAndFillsMissingLists()
    {
        Assert.ThrowsExactly<MsfsUiException>(() => CompatManifest.Parse("""{ "schemaVersion": 2 }"""));
        Assert.ThrowsExactly<MsfsUiException>(() => CompatManifest.Parse("{"));

        var minimal = CompatManifest.Parse("""{ "schemaVersion": 1 }""");
        Assert.IsEmpty(minimal.Anchors);
        Assert.IsEmpty(minimal.LiveChecks);
    }
}
