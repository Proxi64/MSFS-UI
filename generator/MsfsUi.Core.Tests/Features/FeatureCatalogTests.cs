using MsfsUi.Core.Features;

namespace MsfsUi.Core.Tests.Features;

[TestClass]
public sealed class FeatureCatalogTests
{
    [TestMethod]
    public void ParsesFeaturesAndTypedOptions()
    {
        var catalog = FeatureCatalog.Parse(FeatureTestData.Catalog);

        Assert.AreEqual("1.0.0", catalog.ModVersion);
        Assert.HasCount(2, catalog.Features);
        var speed = catalog.Find("fastMenus")!.Options[0];
        Assert.AreEqual(OptionType.Number, speed.Type);
        Assert.AreEqual(OptionValue.FromNumber(2), speed.DefaultValue);
        Assert.AreEqual(0.5, speed.Step);
        Assert.AreEqual("×", speed.Unit);
        Assert.AreEqual(OptionValue.FromBoolean(true), catalog.Find("fastMenus")!.Options[1].DefaultValue);
        Assert.IsFalse(catalog.Find("tailNumber")!.EnabledByDefault);
        Assert.IsNull(catalog.Find("unknown"));
    }

    [TestMethod]
    [DataRow("\"schemaVersion\": 1", "\"schemaVersion\": 2", "schema version 2")]
    [DataRow("\"id\": \"tailNumber\"", "\"id\": \"fastMenus\"", "Duplicate feature id 'fastMenus'")]
    [DataRow("\"id\": \"instantImages\"", "\"id\": \"speed\"", "Duplicate option of feature 'fastMenus' id 'speed'")]
    [DataRow("\"default\": 2,", "\"default\": 9,", "outside its range")]
    [DataRow("\"default\": 2,", "\"default\": \"2\",", "needs a numeric default")]
    [DataRow("\"default\": true }", "\"default\": 1 }", "must be true or false")]
    [DataRow("\"min\": 1, \"max\": 4", "\"min\": 4, \"max\": 1", "invalid range or step")]
    [DataRow("\"step\": 0.5", "\"step\": 0", "invalid range or step")]
    [DataRow("\"type\": \"boolean\"", "\"type\": \"text\"", "not valid JSON")]
    public void RejectsAnInconsistentCatalogue(string original, string replacement, string expectedMessage)
    {
        var json = FeatureTestData.Catalog.Replace(original, replacement, StringComparison.Ordinal);
        Assert.AreNotEqual(FeatureTestData.Catalog, json, "the test case must change the catalogue");

        var error = Assert.ThrowsExactly<InvalidFeatureCatalogException>(() => FeatureCatalog.Parse(json));

        StringAssert.Contains(error.Message, expectedMessage);
    }

    [TestMethod]
    public void AFeatureWithoutAnOptionsKeyHasNoOptions()
    {
        var json = FeatureTestData.Catalog.Replace(",\n      \"options\": []", string.Empty, StringComparison.Ordinal).Replace(",\r\n      \"options\": []", string.Empty, StringComparison.Ordinal);
        Assert.DoesNotContain("\"options\": []", json, "the test case must remove the key");

        var catalog = FeatureCatalog.Parse(json);

        Assert.IsEmpty(catalog.Find("tailNumber")!.Options);
        Assert.IsTrue(SettingsNormalizer.Normalize(catalog, null).Selection.Find("tailNumber") is { Options.Count: 0 });
    }

    [TestMethod]
    public void RejectsANullFeatureOrOption()
    {
        var nullFeature = FeatureTestData.Catalog.Replace("\"features\": [", "\"features\": [ null,", StringComparison.Ordinal);
        var nullOption = FeatureTestData.Catalog.Replace("\"options\": [\n", "\"options\": [ null,\n", StringComparison.Ordinal)
            .Replace("\"options\": [\r\n", "\"options\": [ null,\r\n", StringComparison.Ordinal);

        Assert.ThrowsExactly<InvalidFeatureCatalogException>(() => FeatureCatalog.Parse(nullFeature));
        Assert.ThrowsExactly<InvalidFeatureCatalogException>(() => FeatureCatalog.Parse(nullOption));
    }

    [TestMethod]
    public void RejectsADefaultOffItsStepGrid()
    {
        var json = FeatureTestData.Catalog.Replace("\"default\": 2,", "\"default\": 2.2,", StringComparison.Ordinal);

        var error = Assert.ThrowsExactly<InvalidFeatureCatalogException>(() => FeatureCatalog.Parse(json));

        StringAssert.Contains(error.Message, "not on its step grid");
    }

    [TestMethod]
    public void RejectsAnEmptyCatalogue()
    {
        Assert.ThrowsExactly<InvalidFeatureCatalogException>(() => FeatureCatalog.Parse("""{ "schemaVersion": 1, "modVersion": "1.0.0", "features": [] }"""));
        Assert.ThrowsExactly<InvalidFeatureCatalogException>(() => FeatureCatalog.Parse("null"));
    }
}
