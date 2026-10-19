using Microsoft.Extensions.Logging.Abstractions;
using MsfsUi.Core.Sim;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Sim;

[TestClass]
public sealed class SimLocatorTests
{
    public TestContext TestContext { get; set; } = null!;

    private static SimLocator Locator(FakeSimEnvironment environment) => new(environment, NullLogger<SimLocator>.Instance);

    private static void WriteSteamUserCfg(TempFolder folder, string installedPackages) =>
        folder.Write("roaming/Microsoft Flight Simulator 2024/UserCfg.opt", $"Version 1\nInstalledPackagesPath \"{installedPackages}\"\n");

    [TestMethod]
    public async Task ExplicitFoldersSkipDetection()
    {
        using var folder = new TempFolder();
        var fsBaseUi = FakeFsBaseUi.Create(folder);
        Directory.CreateDirectory(folder["community"]);

        var sim = await Locator(new FakeSimEnvironment(folder)).LocateAsync(
            new SimLocatorOptions { CommunityPath = folder["community"], FsBaseUiPath = fsBaseUi },
            TestContext.CancellationToken);

        Assert.AreEqual(new SimInstallation(SimEdition.Manual, fsBaseUi, FakeFsBaseUi.Version, folder["community"]), sim);
    }

    [TestMethod]
    public async Task FindsSteamInALibraryOfLibraryFoldersVdfPreferringA2024Folder()
    {
        using var folder = new TempFolder();
        var environment = new FakeSimEnvironment(folder) { SteamPath = folder["steam"].Replace('\\', '/') };
        folder.Write("steam/steamapps/libraryfolders.vdf", $"\"libraryfolders\"\n{{\n  \"0\"\n  {{\n    \"path\"    \"{folder["library"].Replace("\\", "\\\\", StringComparison.Ordinal)}\"\n  }}\n}}\n");
        FakeFsBaseUi.Create(folder, "library/steamapps/common/MSFS2020/Packages/fs-base-ui");
        var expected = FakeFsBaseUi.Create(folder, "library/steamapps/common/MSFS2024/Packages/fs-base-ui");
        WriteSteamUserCfg(folder, folder["packages"]);
        Directory.CreateDirectory(folder["packages/Community"]);

        var sim = await Locator(environment).LocateAsync(cancellationToken: TestContext.CancellationToken);

        Assert.AreEqual(SimEdition.Steam, sim.Edition);
        Assert.AreEqual(expected, sim.FsBaseUiPath, ignoreCase: true);
        Assert.AreEqual(folder["packages/Community"], sim.CommunityPath);
        Assert.AreEqual(FakeFsBaseUi.Version, sim.FsBaseUiVersion);
    }

    [TestMethod]
    public async Task FindsTheStoreEditionInXboxGames()
    {
        using var folder = new TempFolder();
        var environment = new FakeSimEnvironment(folder);
        environment.Drives.Add(folder["drive-c"]);
        environment.Drives.Add(folder["drive-d"]);
        folder.Write("local/Packages/Microsoft.Limitless_8wekyb3d8bbwe/LocalCache/UserCfg.opt", $"InstalledPackagesPath {folder["store-packages"]}\r\n");
        Directory.CreateDirectory(folder["store-packages/Community"]);
        var expected = FakeFsBaseUi.Create(folder, "drive-d/XboxGames/Microsoft Flight Simulator 2024/Content/Packages/fs-base-ui");

        var sim = await Locator(environment).LocateAsync(cancellationToken: TestContext.CancellationToken);

        Assert.AreEqual(new SimInstallation(SimEdition.Store, expected, FakeFsBaseUi.Version, folder["store-packages/Community"]), sim);
    }

    [TestMethod]
    public async Task OneExplicitFolderReplacesTheDetectedOne()
    {
        using var folder = new TempFolder();
        var environment = new FakeSimEnvironment(folder) { SteamPath = folder["steam"] };
        FakeFsBaseUi.Create(folder, "steam/steamapps/common/MSFS2024/Packages/fs-base-ui");
        WriteSteamUserCfg(folder, folder["packages"]);
        Directory.CreateDirectory(folder["packages/Community"]);
        Directory.CreateDirectory(folder["my-community"]);

        var sim = await Locator(environment).LocateAsync(new SimLocatorOptions { CommunityPath = folder["my-community"] }, TestContext.CancellationToken);

        Assert.AreEqual(SimEdition.Steam, sim.Edition);
        Assert.AreEqual(folder["my-community"], sim.CommunityPath);
    }

    [TestMethod]
    public async Task ReportsASimNotFound()
    {
        using var folder = new TempFolder();

        var error = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => Locator(new FakeSimEnvironment(folder)).LocateAsync(cancellationToken: TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "MSFS 2024 was not found");
    }

    [TestMethod]
    public async Task ReportsAFsBaseUiWithoutManifest()
    {
        using var folder = new TempFolder();
        Directory.CreateDirectory(folder["fs-base-ui"]);
        Directory.CreateDirectory(folder["community"]);

        var error = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => Locator(new FakeSimEnvironment(folder)).LocateAsync(
            new SimLocatorOptions { CommunityPath = folder["community"], FsBaseUiPath = folder["fs-base-ui"] },
            TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "no manifest.json");
    }

    [TestMethod]
    public async Task ReportsAMissingCommunityFolder()
    {
        using var folder = new TempFolder();
        var fsBaseUi = FakeFsBaseUi.Create(folder);

        var error = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => Locator(new FakeSimEnvironment(folder)).LocateAsync(
            new SimLocatorOptions { CommunityPath = folder["missing"], FsBaseUiPath = fsBaseUi },
            TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "Community folder not found");
    }

    [TestMethod]
    public async Task AnUnreadableManifestGivesAnUnknownVersion()
    {
        using var folder = new TempFolder();
        var fsBaseUi = FakeFsBaseUi.Create(folder);
        folder.Write("fs-base-ui/manifest.json", "{ broken");
        Directory.CreateDirectory(folder["community"]);

        var sim = await Locator(new FakeSimEnvironment(folder)).LocateAsync(
            new SimLocatorOptions { CommunityPath = folder["community"], FsBaseUiPath = fsBaseUi },
            TestContext.CancellationToken);

        Assert.AreEqual("?", sim.FsBaseUiVersion);
    }

    [TestMethod]
    public void TellsWhetherTheSimIsRunning()
    {
        using var folder = new TempFolder();
        var environment = new FakeSimEnvironment(folder);

        Assert.IsFalse(Locator(environment).IsSimRunning());
        environment.Running = true;
        Assert.IsTrue(Locator(environment).IsSimRunning());
    }
}
