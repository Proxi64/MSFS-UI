using System.Text.Json;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Packaging;

[TestClass]
public sealed class SimPackageFilesTests
{
    [TestMethod]
    public void LayoutIsExactlyTheOneOfMsfsUi030ForTheSameFiles()
    {
        using var fixture = JsonDocument.Parse(Golden.Text("layout-entries.json"));
        var entries = fixture.RootElement.GetProperty("entries").EnumerateArray()
            .Select(entry => new LayoutEntry(
                entry.GetProperty("path").GetString()!,
                entry.GetProperty("size").GetInt64(),
                long.Parse(entry.GetProperty("fileTime").GetString()!, System.Globalization.CultureInfo.InvariantCulture)))
            .ToList();

        Assert.AreEqual(Golden.Text("layout.json"), SimPackageFiles.FormatLayout(entries));
    }

    [TestMethod]
    public void ManifestIsExactlyTheOneOfMsfsUi030ExceptItsEnglishTitle()
    {
        using var fixture = JsonDocument.Parse(Golden.Text("layout-entries.json"));
        var version = fixture.RootElement.GetProperty("version").GetString()!;
        var totalSize = fixture.RootElement.GetProperty("entries").EnumerateArray().Sum(entry => entry.GetProperty("size").GetInt64());
        var expected = Golden.Text("manifest.json")
            .Replace("\"title\": \"MSFS-UI (personnel)\"", "\"title\": \"MSFS-UI (personal)\"", StringComparison.Ordinal);

        Assert.AreEqual(expected, SimPackageFiles.FormatManifest(version, totalSize));
    }

    [TestMethod]
    public void JsonStringEscapesLikeJsonStringify()
    {
        Assert.AreEqual("\"a+b<c>&'d\"", SimPackageFiles.JsonString("a+b<c>&'d"), "no HTML-safe escaping");
        Assert.AreEqual("\"q\\\"b\\\\n\\n\\u0001\"", SimPackageFiles.JsonString("q\"b\\n\n\u0001"));
    }
}
