using Microsoft.Extensions.Logging.Abstractions;
using MsfsUi.Core.Compatibility;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Sim;
using MsfsUi.Core.Tests.Coherent;
using MsfsUi.Core.Tests.Compatibility;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Integration;

/// <summary>
/// Read-only checks against the real sim installation. They run only when <c>MSFS_UI_REAL_SIM=1</c> is set,
/// never touch the sim or Community, and write only to a temporary folder. The reference package is the one in
/// <c>MSFS_UI_REFERENCE_PACKAGE</c> (for example <c>dist\package</c> built by the 0.3.0 tool with
/// <c>npm run build</c>), or else the package installed in Community.
/// </summary>
[TestClass]
[TestCategory("RealSim")]
public sealed class RealSimTests
{
    public TestContext TestContext { get; set; } = null!;

    private static void RequireOptIn()
    {
        if (Environment.GetEnvironmentVariable("MSFS_UI_REAL_SIM") != "1")
        {
            Assert.Inconclusive("Set MSFS_UI_REAL_SIM=1 to run the checks against the real sim installation.");
        }
    }

    [TestMethod]
    public async Task GeneratedMasterPageIsByteIdenticalToTheReferencePackageOfMsfsUi030()
    {
        RequireOptIn();
        var sim = await new SimLocator(new WindowsSimEnvironment(), NullLogger<SimLocator>.Instance).LocateAsync(cancellationToken: TestContext.CancellationToken);
        var installed = Environment.GetEnvironmentVariable("MSFS_UI_REFERENCE_PACKAGE") is { Length: > 0 } reference
            ? reference
            : Path.Combine(sim.CommunityPath, PackageLayout.PackageName);
        var installedState = await PackageState.ReadAsync(installed, TestContext.CancellationToken);
        if (installedState is null)
        {
            Assert.Inconclusive($"No MSFS-UI package in {installed} to compare with.");
        }

        using var folder = new TempFolder();
        var state = await new PackageBuilder(TimeProvider.System, NullLogger<PackageBuilder>.Instance).BuildAsync(
            sim,
            new PackageInputs("1.0.0-test", "export {};\n"u8.ToArray(), "export default {};\n", ReadOnlyMemory<byte>.Empty),
            folder["out"],
            TestContext.CancellationToken);

        Assert.AreEqual(installedState.MasterPageSha256, state.MasterPageSha256, "same sim MasterPage as when 0.3.0 was installed");
        CollectionAssert.AreEqual(
            File.ReadAllBytes(PackageLayout.Resolve(installed, PackageLayout.MasterPageHtmlPath)),
            File.ReadAllBytes(PackageLayout.Resolve(folder["out"], PackageLayout.MasterPageHtmlPath)),
            "MasterPage with the loader, byte for byte");
        CollectionAssert.AreEqual(
            File.ReadAllBytes(PackageLayout.Resolve(installed, PackageLayout.MasterPageJsonPath)),
            File.ReadAllBytes(PackageLayout.Resolve(folder["out"], PackageLayout.MasterPageJsonPath)));
        TestContext.WriteLine($"Sim: {sim.Edition}, fs-base-ui {sim.FsBaseUiVersion}, Community {sim.CommunityPath}");
    }

    [TestMethod]
    public async Task TheInstalledSimProvidesEverythingTheModNeedsOffline()
    {
        RequireOptIn();
        var sim = await new SimLocator(new WindowsSimEnvironment(), NullLogger<SimLocator>.Instance).LocateAsync(cancellationToken: TestContext.CancellationToken);
        var checker = new CompatibilityChecker(CoherentInspectorTests.Inspector("127.0.0.1:19999"), NullLogger<CompatibilityChecker>.Instance);

        var results = await checker.CheckOfflineAsync(CompatibilityCheckerTests.RealManifest(), sim.FsBaseUiPath, TestContext.CancellationToken);

        var failures = results.Where(result => !result.Ok).Select(result => $"{result.Group}: {result.Label} ({result.Detail})").ToList();
        Assert.IsEmpty(failures, string.Join("; ", failures));
        TestContext.WriteLine($"{results.Count} offline checks passed on fs-base-ui {sim.FsBaseUiVersion}");
    }

    [TestMethod]
    public async Task StatusOfTheRealCommunityFolderIsReadWithoutChangingAnything()
    {
        RequireOptIn();
        var locator = new SimLocator(new WindowsSimEnvironment(), NullLogger<SimLocator>.Instance);
        var sim = await locator.LocateAsync(cancellationToken: TestContext.CancellationToken);
        using var folder = new TempFolder();
        using var installer = new PackageInstaller(
            new PackageBuilder(TimeProvider.System, NullLogger<PackageBuilder>.Instance),
            locator,
            new AppPaths(folder.Path),
            NullLogger<PackageInstaller>.Instance);
        var communityBefore = Directory.EnumerateFileSystemEntries(sim.CommunityPath).Order(StringComparer.Ordinal).ToList();

        var status = await installer.GetStatusAsync(sim, new PackageInputs("1.0.0-test", "export {};\n"u8.ToArray(), "export default {};\n", ReadOnlyMemory<byte>.Empty), TestContext.CancellationToken);

        CollectionAssert.AreEqual(communityBefore, Directory.EnumerateFileSystemEntries(sim.CommunityPath).Order(StringComparer.Ordinal).ToList());
        TestContext.WriteLine($"Package: {status.Kind}, reasons [{string.Join(", ", status.Reasons)}], conflicts [{string.Join(", ", status.Conflicts)}], sim running: {status.SimRunning}");
    }
}
