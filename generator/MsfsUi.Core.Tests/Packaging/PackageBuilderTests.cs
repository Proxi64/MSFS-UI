using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Packaging;

[TestClass]
public sealed class PackageBuilderTests
{
    private static readonly DateTimeOffset BuildTime = new(2026, 10, 16, 18, 41, 14, 456, TimeSpan.Zero);
    private static readonly byte[] ModScript = Encoding.UTF8.GetBytes("export const mod = 1;\n");
    private static readonly byte[] VaultModule = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00, 0x42];
    private const string ConfigText = "// settings\nexport default {};\n";

    public TestContext TestContext { get; set; } = null!;

    private static PackageBuilder CreateBuilder() => new(new FixedTimeProvider(BuildTime), NullLogger<PackageBuilder>.Instance);

    private async Task<(TempFolder Folder, string Output, PackageState State)> BuildAsync()
    {
        var folder = new TempFolder();
        var fsBaseUi = FakeFsBaseUi.Create(folder);
        var output = folder["out"];
        var state = await CreateBuilder().BuildAsync(
            FakeFsBaseUi.Installation(fsBaseUi, folder.Path),
            new PackageInputs("1.0.0", ModScript, ConfigText, VaultModule),
            output,
            TestContext.CancellationToken);
        return (folder, output, state);
    }

    [TestMethod]
    public async Task WritesEveryFileOfThePackage()
    {
        var (folder, output, _) = await BuildAsync();
        using (folder)
        {
            var files = Directory.EnumerateFiles(output, "*", SearchOption.AllDirectories)
                .Select(file => Path.GetRelativePath(output, file).Replace('\\', '/'))
                .Order(StringComparer.Ordinal)
                .ToList();

            CollectionAssert.AreEqual(
                new[]
                {
                    $"cookedcomps/{PackageLayout.MasterPageGuid}.html",
                    $"cookedcomps/{PackageLayout.MasterPageGuid}.json",
                    "html_ui/msfs-ui/config.js",
                    "html_ui/msfs-ui/main.js",
                    "html_ui/msfs-ui/px.gif",
                    "layout.json",
                    "manifest.json",
                    "modules/msfs-ui.wasm",
                    "msfs-ui.json",
                },
                files);
        }
    }

    [TestMethod]
    public async Task MasterPageHasTheLoaderAndItsJsonIsCopiedUnchanged()
    {
        var (folder, output, _) = await BuildAsync();
        using (folder)
        {
            Assert.AreEqual(Golden.Text("masterpage-output.html"), File.ReadAllText(PackageLayout.Resolve(output, PackageLayout.MasterPageHtmlPath)));
            Assert.AreEqual("{\"children\":[]}", File.ReadAllText(PackageLayout.Resolve(output, PackageLayout.MasterPageJsonPath)));
        }
    }

    [TestMethod]
    public async Task ModConfigAndPixelAreWrittenAsGiven()
    {
        var (folder, output, _) = await BuildAsync();
        using (folder)
        {
            CollectionAssert.AreEqual(ModScript, File.ReadAllBytes(PackageLayout.Resolve(output, PackageLayout.ModulePath)));
            Assert.AreEqual(ConfigText, File.ReadAllText(PackageLayout.Resolve(output, PackageLayout.ConfigPath)));
            var pixel = File.ReadAllBytes(PackageLayout.Resolve(output, PackageLayout.PixelPath));
            Assert.AreEqual("GIF89a", Encoding.ASCII.GetString(pixel, 0, 6));
            Assert.AreEqual(1, pixel[6] | (pixel[7] << 8), "width");
            Assert.AreEqual(1, pixel[8] | (pixel[9] << 8), "height");
        }
    }

    [TestMethod]
    public async Task TheVaultModuleIsWrittenAsGivenListedAndCounted()
    {
        var (folder, output, state) = await BuildAsync();
        using (folder)
        {
            CollectionAssert.AreEqual(VaultModule, File.ReadAllBytes(PackageLayout.Resolve(output, PackageLayout.VaultModulePath)));
            Assert.AreEqual(PackageBuilder.Sha256(VaultModule), state.VaultSha256);
            StringAssert.Contains(File.ReadAllText(Path.Combine(output, "layout.json")), "\"path\": \"modules/msfs-ui.wasm\"");
            var entries = PackageBuilder.ListLayoutEntries(output);
            Assert.AreEqual(VaultModule.Length, entries.Single(entry => entry.Path == PackageLayout.VaultModulePath).Size);
            StringAssert.Contains(File.ReadAllText(Path.Combine(output, "manifest.json")), $"\"total_package_size\": \"{entries.Sum(entry => entry.Size):D20}\"");
        }
    }

    [TestMethod]
    public async Task WithoutAVaultModuleThereIsNoModulesFolderAndNoHash()
    {
        using var folder = new TempFolder();
        var output = folder["out"];

        var state = await CreateBuilder().BuildAsync(
            FakeFsBaseUi.Installation(FakeFsBaseUi.Create(folder), folder.Path),
            new PackageInputs("1.0.0", ModScript, ConfigText, ReadOnlyMemory<byte>.Empty),
            output,
            TestContext.CancellationToken);

        Assert.IsFalse(Directory.Exists(Path.Combine(output, "modules")));
        Assert.IsNull(state.VaultSha256);
        Assert.DoesNotContain("vaultSha256", File.ReadAllText(Path.Combine(output, PackageLayout.StateFile)));
    }

    [TestMethod]
    public async Task StateRecordsVersionsTimeAndHashes()
    {
        var (folder, output, state) = await BuildAsync();
        using (folder)
        {
            Assert.AreEqual("msfs-ui", state.Name);
            Assert.AreEqual("1.0.0", state.Version);
            Assert.AreEqual("2026-10-16T18:41:14Z", state.BuiltAt, "UTC, to the second");
            Assert.AreEqual(FakeFsBaseUi.Version, state.FsBaseUiVersion);
            Assert.AreEqual(PackageBuilder.Sha256(Encoding.UTF8.GetBytes(FakeFsBaseUi.MasterPageHtml)), state.MasterPageSha256, "hash of the sim's original MasterPage");
            Assert.AreEqual(PackageBuilder.Sha256(ModScript), state.ModSha256);
            Assert.AreEqual(PackageBuilder.Sha256(Encoding.UTF8.GetBytes(ConfigText)), state.SettingsSha256);
            Assert.AreEqual(state, await PackageState.ReadAsync(output, TestContext.CancellationToken));
        }
    }

    [TestMethod]
    public async Task LayoutListsEveryOtherFileWithItsSizeAndExactFileTime()
    {
        var (folder, output, _) = await BuildAsync();
        using (folder)
        {
            var expected = SimPackageFiles.FormatLayout(PackageBuilder.ListLayoutEntries(output));
            Assert.AreEqual(expected, File.ReadAllText(Path.Combine(output, "layout.json")));
            StringAssert.DoesNotMatch(expected, new System.Text.RegularExpressions.Regex("\"(manifest|layout)\\.json\""));

            var mainJs = new FileInfo(PackageLayout.Resolve(output, PackageLayout.ModulePath));
            StringAssert.Contains(expected, $"\"date\": {mainJs.LastWriteTimeUtc.ToFileTimeUtc()}");
        }
    }

    [TestMethod]
    public async Task ManifestGivesTheTotalSizeOfTheListedFiles()
    {
        var (folder, output, _) = await BuildAsync();
        using (folder)
        {
            var total = PackageBuilder.ListLayoutEntries(output).Sum(entry => entry.Size);
            Assert.AreEqual(SimPackageFiles.FormatManifest("1.0.0", total), File.ReadAllText(Path.Combine(output, "manifest.json")));
        }
    }

    [TestMethod]
    public async Task RebuildReplacesAPreviousPackage()
    {
        var (folder, output, _) = await BuildAsync();
        using (folder)
        {
            File.WriteAllText(Path.Combine(output, "stale.txt"), "old");
            await CreateBuilder().BuildAsync(
                FakeFsBaseUi.Installation(folder["fs-base-ui"], folder.Path),
                new PackageInputs("1.0.1", ModScript, ConfigText, VaultModule),
                output,
                TestContext.CancellationToken);

            Assert.IsFalse(File.Exists(Path.Combine(output, "stale.txt")));
            Assert.AreEqual("1.0.1", (await PackageState.ReadAsync(output, TestContext.CancellationToken))!.Version);
        }
    }

    [TestMethod]
    public async Task RefusesAForeignNonEmptyOutputFolder()
    {
        using var folder = new TempFolder();
        var fsBaseUi = FakeFsBaseUi.Create(folder);
        var precious = folder.Write("out/precious.txt", "user data");

        var error = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => CreateBuilder().BuildAsync(
            FakeFsBaseUi.Installation(fsBaseUi, folder.Path),
            new PackageInputs("1.0.0", ModScript, ConfigText, VaultModule),
            folder["out"],
            TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "left untouched");
        Assert.IsTrue(File.Exists(precious));
    }

    [TestMethod]
    public async Task RefusesAnUnexpectedMasterPage()
    {
        using var folder = new TempFolder();
        var fsBaseUi = FakeFsBaseUi.Create(folder, masterPage: "<div>changed by a sim update</div>");

        await Assert.ThrowsExactlyAsync<UnexpectedMasterPageException>(() => CreateBuilder().BuildAsync(
            FakeFsBaseUi.Installation(fsBaseUi, folder.Path),
            new PackageInputs("1.0.0", ModScript, ConfigText, VaultModule),
            folder["out"],
            TestContext.CancellationToken));
    }

    [TestMethod]
    public async Task AnUnexpectedMasterPageKeepsThePreviousPackage()
    {
        var (folder, output, _) = await BuildAsync();
        using (folder)
        {
            folder.Write($"fs-base-ui/{PackageLayout.MasterPageHtmlPath}", "<div>changed by a sim update</div>");

            await Assert.ThrowsExactlyAsync<UnexpectedMasterPageException>(() => CreateBuilder().BuildAsync(
                FakeFsBaseUi.Installation(folder["fs-base-ui"], folder.Path),
                new PackageInputs("1.0.1", ModScript, ConfigText, VaultModule),
                output,
                TestContext.CancellationToken));

            Assert.AreEqual("1.0.0", (await PackageState.ReadAsync(output, TestContext.CancellationToken))!.Version, "the working package is still there");
        }
    }

    [TestMethod]
    public async Task ReportsAMissingMasterPage()
    {
        using var folder = new TempFolder();
        var fsBaseUi = FakeFsBaseUi.Create(folder);
        File.Delete(folder[$"fs-base-ui/{PackageLayout.MasterPageJsonPath}"]);

        var error = await Assert.ThrowsExactlyAsync<MsfsUiException>(() => CreateBuilder().BuildAsync(
            FakeFsBaseUi.Installation(fsBaseUi, folder.Path),
            new PackageInputs("1.0.0", ModScript, ConfigText, VaultModule),
            folder["out"],
            TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "MasterPage component was not found");
    }
}
