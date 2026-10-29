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
    public void ManifestIsTheOneOfAPackageTheSimRunsAModuleFrom()
    {
        var expected = "{\n"
            + "  \"dependencies\": [],\n"
            + "  \"content_type\": \"MISC\",\n"
            + "  \"title\": \"MSFS-UI (personal)\",\n"
            + "  \"manufacturer\": \"\",\n"
            + "  \"creator\": \"Proxi64\",\n"
            + "  \"package_version\": \"2.0.0\",\n"
            + "  \"minimum_game_version\": \"1.9.12\",\n"
            + "  \"minimum_compatibility_version\": \"9.12.0.245\",\n"
            + "  \"export_type\": \"Community\",\n"
            + "  \"builder\": \"Microsoft Flight Simulator 2024\",\n"
            + "  \"release_notes\": {\n"
            + "    \"neutral\": {\n"
            + "      \"LastUpdate\": \"\",\n"
            + "      \"OlderHistory\": \"\"\n"
            + "    }\n"
            + "  },\n"
            + "  \"total_package_size\": \"00000000000000381388\"\n"
            + "}\n";

        Assert.AreEqual(expected, SimPackageFiles.FormatManifest("2.0.0", 381388));
    }

    [TestMethod]
    public void JsonStringEscapesLikeJsonStringify()
    {
        Assert.AreEqual("\"a+b<c>&'d\"", SimPackageFiles.JsonString("a+b<c>&'d"), "no HTML-safe escaping");
        Assert.AreEqual("\"q\\\"b\\\\n\\n\\u0001\"", SimPackageFiles.JsonString("q\"b\\n\n\u0001"));
    }
}
