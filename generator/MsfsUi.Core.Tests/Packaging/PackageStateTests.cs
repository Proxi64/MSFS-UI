using MsfsUi.Core.Packaging;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Packaging;

[TestClass]
public sealed class PackageStateTests
{
    public TestContext TestContext { get; set; } = null!;

    [TestMethod]
    public async Task ReadsThePackageStateOfMsfsUi030WithoutTheNewHashes()
    {
        using var folder = new TempFolder();
        folder.Write("pkg/msfs-ui.json", """
            {
              "name": "msfs-ui",
              "version": "0.3.0",
              "builtAt": "2026-10-16T18:41:14Z",
              "fsBaseUiVersion": "0.1.10",
              "masterPageSha256": "25d93bf82baaa98bd726cf86275c955d65d050b8efdcc80507b19a796263ba5d"
            }
            """);

        var state = await PackageState.ReadAsync(folder["pkg"], TestContext.CancellationToken);

        Assert.IsNotNull(state);
        Assert.AreEqual("0.3.0", state.Version);
        Assert.AreEqual("0.1.10", state.FsBaseUiVersion);
        Assert.IsNull(state.ModSha256);
        Assert.IsNull(state.SettingsSha256);
    }

    [TestMethod]
    [DataRow("")]
    [DataRow("not json")]
    [DataRow("{\"name\":\"other-package\",\"version\":\"1\",\"builtAt\":\"\",\"fsBaseUiVersion\":\"\",\"masterPageSha256\":\"\"}")]
    public async Task AFolderWithoutOurStateIsForeign(string content)
    {
        using var folder = new TempFolder();
        folder.Write("pkg/msfs-ui.json", content);

        Assert.IsNull(await PackageState.ReadAsync(folder["pkg"], TestContext.CancellationToken));
        Assert.IsNull(await PackageState.ReadAsync(folder["missing"], TestContext.CancellationToken));
    }

    [TestMethod]
    public void JsonUsesCamelCaseTwoSpacesLfAndOmitsMissingHashes()
    {
        var json = new PackageState("msfs-ui", "1.0.0", "2026-10-16T18:41:14Z", "0.1.10", "abc").ToJson();

        Assert.AreEqual(
            "{\n  \"name\": \"msfs-ui\",\n  \"version\": \"1.0.0\",\n  \"builtAt\": \"2026-10-16T18:41:14Z\",\n"
            + "  \"fsBaseUiVersion\": \"0.1.10\",\n  \"masterPageSha256\": \"abc\"\n}\n",
            json);
    }
}
