using MsfsUi.Core.Tests.Contracts;

namespace MsfsUi.Core.Tests;

[TestClass]
public sealed class ProductInfoTests
{
    [TestMethod]
    public void VersionComesFromTheBuildWithoutSourceRevisionSuffix()
    {
        // The app's version follows the mod's (Directory.Build.props, modVersion of mod/features.json).
        Assert.AreEqual(ModContractTests.RealCatalog().ModVersion, ProductInfo.Version);
        Assert.IsFalse(ProductInfo.Version.Contains('+', StringComparison.Ordinal));
    }
}
