using MsfsUi.Core.Features;

namespace MsfsUi.Core.Tests.Features;

[TestClass]
public sealed class ChoiceOptionTests
{
    private static readonly FeatureCatalog Catalog = FeatureCatalog.Parse(FeatureTestData.CatalogWithChoice);

    private static NormalizationResult Normalize(string layoutJson) => SettingsNormalizer.Normalize(
        Catalog,
        FeatureSettings.TryParse($$"""{ "schemaVersion": 1, "features": { "aircraftGallery": { "options": { "layout": {{layoutJson}} } } } }""")
            ?? throw new AssertFailedException("unreadable test settings"));

    private static OptionValue Layout(NormalizationResult result) => result.Selection.Find("aircraftGallery")!.Options[0].Value;

    [TestMethod]
    public void ParsesTheChoicesAndTheirDefault()
    {
        var layout = Catalog.Find("aircraftGallery")!.Options[0];

        Assert.AreEqual(OptionType.Choice, layout.Type);
        Assert.HasCount(2, layout.Choices!);
        Assert.AreEqual(new ChoiceDefinition("sideBySide", "Side by side", "Two columns."), layout.Choices![1]);
        Assert.AreEqual(OptionValue.FromChoice("classic"), layout.DefaultValue);
        Assert.AreEqual("classic", layout.DefaultValue.Text);
    }

    [TestMethod]
    [DataRow("\"default\": \"classic\"", "\"default\": \"stacked\"", "not one of its choices")]
    [DataRow("\"default\": \"classic\"", "\"default\": 1", "not one of its choices")]
    [DataRow(", { \"id\": \"sideBySide\", \"title\": \"Side by side\", \"description\": \"Two columns.\" }", "", "at least two choices")]
    [DataRow("\"id\": \"sideBySide\"", "\"id\": \"classic\"", "choice 'classic' twice")]
    [DataRow("\"title\": \"Side by side\"", "\"title\": \" \"", "id and a title")]
    [DataRow("\"choices\":", "\"others\":", "at least two choices")]
    public void RejectsAnInconsistentChoice(string original, string replacement, string expectedMessage)
    {
        var json = FeatureTestData.CatalogWithChoice.Replace(original, replacement, StringComparison.Ordinal);
        Assert.AreNotEqual(FeatureTestData.CatalogWithChoice, json, "the test case must change the catalogue");

        var error = Assert.ThrowsExactly<InvalidFeatureCatalogException>(() => FeatureCatalog.Parse(json));

        StringAssert.Contains(error.Message, expectedMessage);
    }

    [TestMethod]
    public void KeepsAStoredChoice()
    {
        var result = Normalize("\"sideBySide\"");

        Assert.IsEmpty(result.Adjustments);
        Assert.AreEqual(OptionValue.FromChoice("sideBySide"), Layout(result));
    }

    [TestMethod]
    [DataRow("\"stacked\"")]
    [DataRow("3")]
    public void AnUnknownChoiceTakesTheDefaultAndIsReported(string stored)
    {
        var result = Normalize(stored);

        Assert.AreEqual(OptionValue.FromChoice("classic"), Layout(result));
        CollectionAssert.AreEqual(ExpectedAdjustment, result.Adjustments.ToArray());
    }

    private static readonly string[] ExpectedAdjustment = ["Option 'aircraftGallery.layout' is not one of its choices: default used."];

    [TestMethod]
    public void AMissingChoiceTakesTheDefaultSilently()
    {
        var result = SettingsNormalizer.Normalize(Catalog, null);

        Assert.IsEmpty(result.Adjustments);
        Assert.AreEqual(OptionValue.FromChoice("classic"), Layout(result));
    }

    [TestMethod]
    public void AChoiceRoundTripsAndReachesConfigJs()
    {
        var selection = Normalize("\"sideBySide\"").Selection;

        var reread = SettingsNormalizer.Normalize(Catalog, FeatureSettings.TryParse(selection.ToSettings().ToJson()));

        Assert.IsEmpty(reread.Adjustments);
        Assert.AreEqual(OptionValue.FromChoice("sideBySide"), Layout(reread));
        StringAssert.Contains(ConfigScript.Generate(reread.Selection, "1.0.0"), "\"layout\": \"sideBySide\"");
    }
}
