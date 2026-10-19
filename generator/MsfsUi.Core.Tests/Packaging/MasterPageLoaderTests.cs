using MsfsUi.Core.Packaging;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Packaging;

[TestClass]
public sealed class MasterPageLoaderTests
{
    private const string CloseTag = "</ui-resource-element>";

    [TestMethod]
    [DataRow("masterpage-input.html", "masterpage-output.html")]
    [DataRow("masterpage-bom-crlf-input.html", "masterpage-bom-crlf-output.html")]
    public void InsertProducesExactlyTheOutputOfMsfsUi030(string input, string expected)
    {
        var output = MasterPageLoader.Insert(Golden.Text(input));

        Assert.AreEqual(Golden.Text(expected), output);
    }

    [TestMethod]
    public void LoaderCreatesTheModuleOnceAndOnlyInMainUi()
    {
        var output = MasterPageLoader.Insert(FakeFsBaseUi.MasterPageHtml);

        StringAssert.Contains(output, "src=\"/msfs-ui/px.gif\"");
        StringAssert.Contains(output, "this.onload=null;");
        StringAssert.Contains(output, "if(/mainui\\.html/i.test(location.href)&&!window.__msfsUi){window.__msfsUi=1;");
        StringAssert.Contains(output, "s.type='module';s.src='/msfs-ui/main.js';document.head.appendChild(s)");
        Assert.IsTrue(output.EndsWith(CloseTag, StringComparison.Ordinal), "the loader goes before the last closing tag");
    }

    [TestMethod]
    [DataRow("on several lines")]
    [DataRow("with a script")]
    [DataRow("already loaded")]
    [DataRow("unbalanced")]
    [DataRow("another root")]
    [DataRow("empty")]
    public void InsertRefusesAComponent(string shape)
    {
        var html = FakeFsBaseUi.MasterPageHtml;
        html = shape switch
        {
            "on several lines" => html.Replace("><ui-resource-element name=\"BlurPage\"", ">\n<ui-resource-element name=\"BlurPage\"", StringComparison.Ordinal),
            "with a script" => html.Replace(CloseTag, "<script>x()</script>" + CloseTag, StringComparison.Ordinal),
            "already loaded" => MasterPageLoader.Insert(html),
            "unbalanced" => html[..^CloseTag.Length] + "<ui-resource-element name=\"X\">" + CloseTag,
            "another root" => $"<div>{html}</div>",
            _ => string.Empty,
        };

        Assert.ThrowsExactly<UnexpectedMasterPageException>(() => MasterPageLoader.Insert(html));
    }
}
