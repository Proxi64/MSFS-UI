namespace MsfsUi.Core.Tests;

[TestClass]
public sealed class ProductInfoTests
{
    [TestMethod]
    public void VersionComesFromTheBuildWithoutSourceRevisionSuffix()
    {
        StringAssert.StartsWith(ProductInfo.Version, "1.0.0");
        Assert.IsFalse(ProductInfo.Version.Contains('+', StringComparison.Ordinal));
    }
}
