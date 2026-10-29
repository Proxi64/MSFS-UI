using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Sim;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Packaging;

[TestClass]
public sealed class PackageInstallerTests
{
    private static readonly PackageInputs Inputs = new("1.0.0", Encoding.UTF8.GetBytes("export const mod = 1;\n"), "export default { a: 1 };\n", new byte[] { 0, 0x61, 0x73, 0x6D, 1 });

    public TestContext TestContext { get; set; } = null!;

    /// <summary>A fake sim (fs-base-ui, empty Community), an app data root and an installer.</summary>
    private sealed class Setup : IDisposable
    {
        public Setup()
        {
            Folder = new TempFolder();
            Environment = new FakeSimEnvironment(Folder);
            Directory.CreateDirectory(Folder["Community"]);
            Sim = FakeFsBaseUi.Installation(FakeFsBaseUi.Create(Folder), Folder["Community"]);
            Installer = new PackageInstaller(
                new PackageBuilder(TimeProvider.System, NullLogger<PackageBuilder>.Instance),
                new SimLocator(Environment, NullLogger<SimLocator>.Instance),
                new AppPaths(Folder["appdata"]),
                NullLogger<PackageInstaller>.Instance);
        }

        public TempFolder Folder { get; }

        public FakeSimEnvironment Environment { get; }

        public SimInstallation Sim { get; }

        public PackageInstaller Installer { get; }

        public string Package => PackageInstaller.PackageFolder(Sim);

        public void Dispose()
        {
            Installer.Dispose();
            Folder.Dispose();
        }
    }

    [TestMethod]
    public async Task FirstInstallCopiesTheWholePackageWithItsFileTimes()
    {
        using var setup = new Setup();

        var result = await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        Assert.IsTrue(result.FirstInstall);
        Assert.IsTrue(result.MasterPageChanged);
        Assert.AreEqual(NextStep.None, result.NextStep, "sim not running");
        var staged = new AppPaths(setup.Folder["appdata"]).StagingPackage;
        foreach (var file in Directory.EnumerateFiles(staged, "*", SearchOption.AllDirectories))
        {
            var installed = Path.Combine(setup.Package, Path.GetRelativePath(staged, file));
            CollectionAssert.AreEqual(File.ReadAllBytes(file), File.ReadAllBytes(installed), file);
            Assert.AreEqual(File.GetLastWriteTimeUtc(file), File.GetLastWriteTimeUtc(installed), "layout.json dates must stay exact");
        }

        var layout = File.ReadAllText(Path.Combine(setup.Package, "layout.json"));
        Assert.AreEqual(SimPackageFiles.FormatLayout(PackageBuilder.ListLayoutEntries(setup.Package)), layout);
    }

    [TestMethod]
    public async Task ReinstallReplacesFilesAndRemovesStaleOnes()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        setup.Folder.Write("Community/msfs-ui/html_ui/msfs-ui/old-module.js", "stale");
        setup.Folder.Write("Community/msfs-ui/obsolete/folder/file.txt", "stale");

        var result = await setup.Installer.InstallAsync(setup.Sim, Inputs with { ConfigScript = "export default { a: 2 };\n" }, TestContext.CancellationToken);

        Assert.IsFalse(result.FirstInstall);
        Assert.IsFalse(result.MasterPageChanged);
        Assert.IsFalse(File.Exists(Path.Combine(setup.Package, "html_ui", "msfs-ui", "old-module.js")));
        Assert.IsFalse(Directory.Exists(Path.Combine(setup.Package, "obsolete")));
        Assert.AreEqual("export default { a: 2 };\n", File.ReadAllText(PackageLayout.Resolve(setup.Package, PackageLayout.ConfigPath)));
    }

    [TestMethod]
    public async Task NextStepTellsWhetherToRestartTheSimOrReloadTheMod()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        setup.Environment.Running = true;
        setup.Environment.SimStartedUtc = DateTime.UtcNow.AddSeconds(2);

        var settingsOnly = await setup.Installer.InstallAsync(setup.Sim, Inputs with { ConfigScript = "export default {};\n" }, TestContext.CancellationToken);
        setup.Folder.Write($"fs-base-ui/{PackageLayout.MasterPageHtmlPath}", FakeFsBaseUi.MasterPageHtml.Replace("TitlePage", "TitlePage2", StringComparison.Ordinal));
        var simUpdated = await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        Assert.AreEqual(NextStep.ReloadMod, settingsOnly.NextStep, "the package was mounted when the sim started; its files are re-read on the fly");
        Assert.AreEqual(NextStep.RestartSim, simUpdated.NextStep, "the MasterPage is read only at start-up");
        Assert.IsTrue(simUpdated.MasterPageChanged);
    }

    [TestMethod]
    public async Task AMountedPackageStaysMountedOverSeveralInstallsDuringTheSession()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        setup.Environment.Running = true;
        setup.Environment.SimStartedUtc = DateTime.UtcNow.AddSeconds(2);

        var first = await setup.Installer.InstallAsync(setup.Sim, Inputs with { ConfigScript = "export default { a: 2 };\n" }, TestContext.CancellationToken);
        var second = await setup.Installer.InstallAsync(setup.Sim, Inputs with { ConfigScript = "export default { a: 3 };\n" }, TestContext.CancellationToken);

        Assert.AreEqual(NextStep.ReloadMod, first.NextStep);
        Assert.AreEqual(NextStep.ReloadMod, second.NextStep, "files are copied over, never recreated: they are still the ones mounted at start-up");
    }

    [TestMethod]
    public async Task AFileAddedSinceTheSimStartedNeedsARestart()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        // As a package of the 0.3.0 tool, which had no config.js: the sim did not list it when it mounted the package.
        File.Delete(PackageLayout.Resolve(setup.Package, PackageLayout.ConfigPath));
        setup.Environment.Running = true;
        setup.Environment.SimStartedUtc = DateTime.UtcNow.AddSeconds(2);

        var result = await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        Assert.AreEqual(NextStep.RestartSim, result.NextStep, "a file missing from the mounted layout is not served until the sim restarts");
    }

    [TestMethod]
    public async Task AChangedVaultModuleNeedsARestartEvenWhenEveryFileExisted()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        setup.Environment.Running = true;
        setup.Environment.SimStartedUtc = DateTime.UtcNow.AddSeconds(2);

        var same = await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        var changed = await setup.Installer.InstallAsync(setup.Sim, Inputs with { VaultModule = new byte[] { 0, 0x61, 0x73, 0x6D, 2 } }, TestContext.CancellationToken);

        Assert.AreEqual(NextStep.ReloadMod, same.NextStep, "control: nothing changed, every file mounted");
        Assert.AreEqual(NextStep.RestartSim, changed.NextStep, "the module is read only at start-up");
    }

    [TestMethod]
    public async Task PackagesInstalledDuringTheSimSessionNeedARestart()
    {
        using var setup = new Setup();
        setup.Environment.Running = true;
        setup.Environment.SimStartedUtc = DateTime.UtcNow.AddMinutes(-5);

        var first = await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        var second = await setup.Installer.InstallAsync(setup.Sim, Inputs with { ConfigScript = "export default {};\n" }, TestContext.CancellationToken);

        Assert.AreEqual(NextStep.RestartSim, first.NextStep, "a new package is mounted only at start-up");
        Assert.AreEqual(NextStep.RestartSim, second.NextStep, "still not mounted: the sim started before the first install");
    }

    [TestMethod]
    public async Task AnInterruptedCopyLeavesThePreviousStateSoAnUpdateIsStillProposed()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        var newInputs = Inputs with { Version = "1.1.0", ModScript = Encoding.UTF8.GetBytes("export const mod = 2;\n") };

        using (File.Open(PackageLayout.Resolve(setup.Package, PackageLayout.ModulePath), FileMode.Open, FileAccess.Read, FileShare.None))
        {
            var error = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => setup.Installer.InstallAsync(setup.Sim, newInputs, TestContext.CancellationToken));
            StringAssert.Contains(error.Message, "could not be fully copied");
        }

        var status = await setup.Installer.GetStatusAsync(setup.Sim, newInputs, TestContext.CancellationToken);
        Assert.AreEqual("1.0.0", status.Installed!.Version, "the state file is copied last");
        Assert.AreEqual(PackageStatusKind.UpdateNeeded, status.Kind);
    }

    [TestMethod]
    public async Task RefusesToInstallIntoAMissingCommunityFolder()
    {
        using var setup = new Setup();
        var stale = setup.Sim with { CommunityPath = setup.Folder["Wrong/Community"] };

        var error = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => setup.Installer.InstallAsync(stale, Inputs, TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "Community folder not found");
        Assert.IsFalse(Directory.Exists(setup.Folder["Wrong"]));
    }

    [TestMethod]
    public async Task AMissingSimMasterPageIsReportedAsASimUpdate()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        File.Delete(setup.Folder[$"fs-base-ui/{PackageLayout.MasterPageHtmlPath}"]);

        var status = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        CollectionAssert.Contains(status.Reasons.ToList(), UpdateReason.SimUpdated);
    }

    [TestMethod]
    public async Task StatusNotInstalledThenUpToDate()
    {
        using var setup = new Setup();

        var before = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        var after = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        Assert.AreEqual(PackageStatusKind.NotInstalled, before.Kind);
        Assert.IsNull(before.Installed);
        Assert.AreEqual(PackageStatusKind.UpToDate, after.Kind);
        Assert.IsEmpty(after.Reasons);
        Assert.AreEqual("1.0.0", after.Installed!.Version);
        Assert.IsFalse(after.SimRunning);
    }

    [TestMethod]
    public async Task StatusGivesEachReasonToUpdate()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        var settings = await setup.Installer.GetStatusAsync(setup.Sim, Inputs with { ConfigScript = "export default {};\n" }, TestContext.CancellationToken);
        var mod = await setup.Installer.GetStatusAsync(setup.Sim, Inputs with { ModScript = Encoding.UTF8.GetBytes("changed") }, TestContext.CancellationToken);
        var vault = await setup.Installer.GetStatusAsync(setup.Sim, Inputs with { VaultModule = new byte[] { 9 } }, TestContext.CancellationToken);
        var version = await setup.Installer.GetStatusAsync(setup.Sim, Inputs with { Version = "1.1.0", ModScript = Encoding.UTF8.GetBytes("changed") }, TestContext.CancellationToken);
        setup.Folder.Write($"fs-base-ui/{PackageLayout.MasterPageHtmlPath}", FakeFsBaseUi.MasterPageHtml.Replace("TitlePage", "TitlePage2", StringComparison.Ordinal));
        var sim = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        CollectionAssert.AreEqual(new[] { UpdateReason.SettingsChanged }, settings.Reasons.ToArray());
        CollectionAssert.AreEqual(new[] { UpdateReason.ModChanged }, mod.Reasons.ToArray());
        CollectionAssert.AreEqual(new[] { UpdateReason.ModChanged }, vault.Reasons.ToArray(), "a changed vault module is a changed mod");
        CollectionAssert.AreEqual(new[] { UpdateReason.AppVersionChanged }, version.Reasons.ToArray(), "a new version implies a new mod");
        CollectionAssert.AreEqual(new[] { UpdateReason.SimUpdated }, sim.Reasons.ToArray());
        Assert.AreEqual(PackageStatusKind.UpdateNeeded, sim.Kind);
    }

    [TestMethod]
    public async Task APackageFromMsfsUi030NeedsAnUpdate()
    {
        using var setup = new Setup();
        setup.Folder.Write("Community/msfs-ui/msfs-ui.json", new PackageState(
            "msfs-ui", "0.3.0", "2026-10-16T18:41:14Z", FakeFsBaseUi.Version,
            PackageBuilder.Sha256(Encoding.UTF8.GetBytes(FakeFsBaseUi.MasterPageHtml))).ToJson());

        var status = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        Assert.AreEqual(PackageStatusKind.UpdateNeeded, status.Kind);
        CollectionAssert.AreEqual(new[] { UpdateReason.LegacyPackage }, status.Reasons.ToArray());
    }

    [TestMethod]
    public async Task AForeignFolderIsReportedAndNeverTouched()
    {
        using var setup = new Setup();
        var precious = setup.Folder.Write("Community/msfs-ui/readme.txt", "someone else's package");

        var status = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        var install = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken));
        var remove = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => setup.Installer.RemoveAsync(setup.Sim, TestContext.CancellationToken));

        Assert.AreEqual(PackageStatusKind.Foreign, status.Kind);
        StringAssert.Contains(install.Message, "left untouched");
        StringAssert.Contains(remove.Message, "left untouched");
        Assert.AreEqual("someone else's package", File.ReadAllText(precious));
        Assert.HasCount(1, Directory.EnumerateFileSystemEntries(setup.Package));
    }

    [TestMethod]
    public async Task RemoveDeletesOurPackageOnly()
    {
        using var setup = new Setup();

        Assert.IsFalse(await setup.Installer.RemoveAsync(setup.Sim, TestContext.CancellationToken), "nothing to remove");
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        Assert.IsTrue(await setup.Installer.RemoveAsync(setup.Sim, TestContext.CancellationToken));

        Assert.IsFalse(Directory.Exists(setup.Package));
        Assert.IsTrue(Directory.Exists(setup.Folder["Community"]));
    }

    [TestMethod]
    public async Task ARemovalStoppedByALockedFileLeavesAPackageStillOurs()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        // The running sim may hold a file of the package open.
        using (File.Open(Path.Combine(setup.Package, "html_ui", "msfs-ui", "main.js"), FileMode.Open, FileAccess.Read, FileShare.None))
        {
            await Assert.ThrowsExactlyAsync<MsfsUiException>(() => setup.Installer.RemoveAsync(setup.Sim, TestContext.CancellationToken));
        }

        Assert.IsTrue(File.Exists(Path.Combine(setup.Package, PackageLayout.StateFile)), "the state file is deleted last");
        var status = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        Assert.AreNotEqual(PackageStatusKind.Foreign, status.Kind);
        Assert.IsTrue(await setup.Installer.RemoveAsync(setup.Sim, TestContext.CancellationToken), "tried again once the file is free");
        Assert.IsFalse(Directory.Exists(setup.Package));
    }

    [TestMethod]
    public async Task AStatusReadAgainWithoutAnyChangeEqualsThePreviousOne()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs with { ConfigScript = "export default { a: 2 };\n" }, TestContext.CancellationToken);
        setup.Folder.Write("Community/other-ui/cookedcomps/{7DA60FBA-EF32-48F2-974D-F8BEA35337A4}.html", "<ui-resource-element></ui-resource-element>");

        // Each read gives new lists (reasons, conflicts): equal by value all the same, so the pages are not refreshed.
        var first = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        var second = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        Assert.AreNotSame(first.Reasons, second.Reasons);
        Assert.AreEqual(first, second);
        Assert.AreEqual(first.GetHashCode(), second.GetHashCode());
        Assert.AreNotEqual(first, second with { Conflicts = [] });
    }

    [TestMethod]
    public async Task InstallationsAndRemovalsAskedTogetherRunOneAtATime()
    {
        using var setup = new Setup();

        // Two pages of the app may ask at the same time: they share the staging folder and the package folder.
        await Task.WhenAll(
            setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken),
            setup.Installer.InstallAsync(setup.Sim, Inputs with { ConfigScript = "export default { a: 2 };\n" }, TestContext.CancellationToken),
            setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken));

        var status = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        Assert.AreEqual(PackageStatusKind.UpToDate, status.Kind, "the last installation is complete");
        await Task.WhenAll(
            setup.Installer.RemoveAsync(setup.Sim, TestContext.CancellationToken),
            setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken));
        Assert.IsTrue(File.Exists(Path.Combine(setup.Package, PackageLayout.StateFile)) || !Directory.Exists(setup.Package), "never half a package");
    }

    [TestMethod]
    public async Task ConflictsListOtherPackagesReplacingTheMasterPage()
    {
        using var setup = new Setup();
        setup.Folder.Write($"Community/other-ui/{PackageLayout.MasterPageHtmlPath}", "<ui-resource-element></ui-resource-element>");
        setup.Folder.Write("Community/liveries-pack/layout.json", "{}");

        var result = await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        var status = await setup.Installer.GetStatusAsync(setup.Sim, Inputs, TestContext.CancellationToken);

        CollectionAssert.AreEqual(ExpectedConflicts, result.Conflicts.ToArray(), "our own package is not a conflict");
        CollectionAssert.AreEqual(ExpectedConflicts, status.Conflicts.ToArray());
    }

    private static readonly string[] ExpectedConflicts = ["other-ui"];

    [TestMethod]
    public async Task AnUnexpectedMasterPageLeavesTheInstalledPackageUntouched()
    {
        using var setup = new Setup();
        await setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken);
        var before = File.ReadAllBytes(PackageLayout.Resolve(setup.Package, PackageLayout.MasterPageHtmlPath));
        setup.Folder.Write($"fs-base-ui/{PackageLayout.MasterPageHtmlPath}", "<div>sim update</div>");

        await Assert.ThrowsExactlyAsync<UnexpectedMasterPageException>(() => setup.Installer.InstallAsync(setup.Sim, Inputs, TestContext.CancellationToken));

        CollectionAssert.AreEqual(before, File.ReadAllBytes(PackageLayout.Resolve(setup.Package, PackageLayout.MasterPageHtmlPath)));
    }
}
