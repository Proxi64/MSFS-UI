using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Sim;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Packaging;

[TestClass]
public sealed class UninstallerTests
{
    private static readonly PackageInputs Inputs = new("1.0.0", Encoding.UTF8.GetBytes("export const mod = 1;\n"), "export default { a: 1 };\n", new byte[] { 0, 0x61, 0x73, 0x6D, 1 });

    private const string SteamVault = "roaming/Microsoft Flight Simulator 2024/WASM/MSFS2024/msfs-ui";
    private const string StoreVault2020 = "local/Packages/Microsoft.Limitless_8wekyb3d8bbwe/LocalState/WASM/MSFS2020/msfs-ui";
    private const string StoreVault2024 = "local/Packages/Microsoft.Limitless_8wekyb3d8bbwe/LocalState/WASM/MSFS2024/msfs-ui";

    public TestContext TestContext { get; set; } = null!;

    /// <summary>
    /// A machine with everything MSFS-UI leaves: the package installed, the vault in the Steam and Store places, the
    /// app's data and its legacy folder; and what is not MSFS-UI's beside them.
    /// </summary>
    private sealed class Setup : IDisposable
    {
        public Setup()
        {
            Folder = new TempFolder();
            Environment = new FakeSimEnvironment(Folder);
            Directory.CreateDirectory(Folder["Community"]);
            Sim = FakeFsBaseUi.Installation(FakeFsBaseUi.Create(Folder), Folder["Community"]);
            Paths = new AppPaths(Folder["local/MSFS-UI-GENERATOR"], Folder["local/MSFS-UI"]);
            var locator = new SimLocator(Environment, NullLogger<SimLocator>.Instance);
            Installer = new PackageInstaller(new PackageBuilder(TimeProvider.System, NullLogger<PackageBuilder>.Instance), locator, Paths, NullLogger<PackageInstaller>.Instance);
            Uninstaller = new Uninstaller(Environment, Paths, Installer, locator, NullLogger<Uninstaller>.Instance);
        }

        public TempFolder Folder { get; }

        public FakeSimEnvironment Environment { get; }

        public SimInstallation Sim { get; }

        public AppPaths Paths { get; }

        public PackageInstaller Installer { get; }

        public Uninstaller Uninstaller { get; }

        public async Task FillAsync(CancellationToken cancellationToken)
        {
            await Installer.InstallAsync(Sim, Inputs, cancellationToken);
            Folder.Write($"{SteamVault}/work/vault-a.head", "1");
            Folder.Write($"{SteamVault}/m1f650e76cb8d40e2_0.dll", "compiled");
            Folder.Write($"{StoreVault2020}/work/vault-a.head", "1");
            Folder.Write("local/MSFS-UI-GENERATOR/settings.json", "{}");
            Folder.Write("local/MSFS-UI-GENERATOR/logs/msfs-ui-20261031.log", "line");
            Folder.Write("local/MSFS-UI/settings.json", "{}");
            // Not MSFS-UI's.
            Folder.Write($"Community/other-mod/layout.json", "{}");
            Folder.Write("roaming/Microsoft Flight Simulator 2024/WASM/MSFS2024/other-mod/work/data", "1");
            Folder.Write("roaming/Microsoft Flight Simulator 2024/UserCfg.opt", "InstalledPackagesPath \"x\"");
        }

        public void Dispose()
        {
            Installer.Dispose();
            Folder.Dispose();
        }
    }

    [TestMethod]
    public async Task ListsWhatExistsOfTheModPackageVaultThenAppData()
    {
        using var setup = new Setup();
        await setup.FillAsync(TestContext.CancellationToken);

        var folders = await setup.Uninstaller.FindAsync(setup.Sim, TestContext.CancellationToken);

        CollectionAssert.AreEqual(
            new[] { setup.Folder["Community/msfs-ui"], setup.Folder[SteamVault], setup.Folder[StoreVault2020], setup.Folder["local/MSFS-UI-GENERATOR"], setup.Folder["local/MSFS-UI"] },
            folders.ToArray(),
            "the Store's MSFS2024 vault does not exist here");
    }

    [TestMethod]
    public async Task UninstallDeletesThemAndNothingElse()
    {
        using var setup = new Setup();
        await setup.FillAsync(TestContext.CancellationToken);
        setup.Folder.Write($"{StoreVault2024}/work/vault-a.head", "1");

        var left = await setup.Uninstaller.UninstallAsync(setup.Sim, TestContext.CancellationToken);

        Assert.IsEmpty(left);
        foreach (var gone in new[] { "Community/msfs-ui", SteamVault, StoreVault2020, StoreVault2024, "local/MSFS-UI-GENERATOR", "local/MSFS-UI" })
        {
            Assert.IsFalse(Directory.Exists(setup.Folder[gone]), gone);
        }

        foreach (var kept in new[] { "Community/other-mod/layout.json", "roaming/Microsoft Flight Simulator 2024/WASM/MSFS2024/other-mod/work/data", "roaming/Microsoft Flight Simulator 2024/UserCfg.opt" })
        {
            Assert.IsTrue(File.Exists(setup.Folder[kept]), kept);
        }
    }

    [TestMethod]
    public async Task WithoutTheSimFoundTheRestIsStillFound()
    {
        using var setup = new Setup();
        await setup.FillAsync(TestContext.CancellationToken);

        var folders = await setup.Uninstaller.FindAsync(null, TestContext.CancellationToken);

        CollectionAssert.DoesNotContain(folders.ToArray(), setup.Folder["Community/msfs-ui"]);
        CollectionAssert.Contains(folders.ToArray(), setup.Folder[SteamVault]);
    }

    [TestMethod]
    public async Task AForeignMsfsUiFolderAndAnUnknownLegacyFolderAreLeftAlone()
    {
        using var setup = new Setup();
        setup.Folder.Write("Community/msfs-ui/layout.json", "{}");
        setup.Folder.Write("local/MSFS-UI/something-else.txt", "not ours");

        var folders = await setup.Uninstaller.FindAsync(setup.Sim, TestContext.CancellationToken);
        await setup.Uninstaller.UninstallAsync(setup.Sim, TestContext.CancellationToken);

        Assert.IsEmpty(folders);
        Assert.IsTrue(File.Exists(setup.Folder["Community/msfs-ui/layout.json"]));
        Assert.IsTrue(File.Exists(setup.Folder["local/MSFS-UI/something-else.txt"]));
    }

    [TestMethod]
    public async Task RefusesWhileTheSimRuns()
    {
        using var setup = new Setup();
        await setup.FillAsync(TestContext.CancellationToken);
        setup.Environment.Running = true;

        var error = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => setup.Uninstaller.UninstallAsync(setup.Sim, TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "Close the sim");
        Assert.IsTrue(Directory.Exists(setup.Folder[SteamVault]), "nothing deleted");
        Assert.IsTrue(Directory.Exists(setup.Folder["Community/msfs-ui"]));
    }

    [TestMethod]
    public async Task AFolderInUseIsReportedAndTheOthersAreDeleted()
    {
        using var setup = new Setup();
        await setup.FillAsync(TestContext.CancellationToken);

        IReadOnlyList<string> left;
        using (File.Open(setup.Folder[$"{SteamVault}/work/vault-a.head"], FileMode.Open, FileAccess.Read, FileShare.None))
        {
            left = await setup.Uninstaller.UninstallAsync(setup.Sim, TestContext.CancellationToken);
        }

        CollectionAssert.AreEqual(new[] { setup.Folder[SteamVault] }, left.ToArray());
        Assert.IsFalse(Directory.Exists(setup.Folder["local/MSFS-UI-GENERATOR"]), "the next ones deleted all the same");
    }
}
