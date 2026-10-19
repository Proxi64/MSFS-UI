namespace MsfsUi.Core.Tests;

[TestClass]
public sealed class AppPathsTests
{
    [TestMethod]
    public void EveryPathIsUnderTheRoot()
    {
        var paths = new AppPaths(@"C:\data\MSFS-UI");

        Assert.AreEqual(@"C:\data\MSFS-UI\staging\msfs-ui", paths.StagingPackage);
        Assert.AreEqual(@"C:\data\MSFS-UI\logs", paths.Logs);
        Assert.AreEqual(@"C:\data\MSFS-UI\settings.json", paths.SettingsFile);
        Assert.AreEqual(@"C:\data\MSFS-UI\app.json", paths.PreferencesFile);
    }

    [TestMethod]
    public void TheLegacyFolderIsMovedOnce()
    {
        using var folder = new TestSupport.TempFolder();
        folder.Write("MSFS-UI/settings.json", "{}");

        var paths = AppPaths.FromLegacy(folder["MSFS-UI"], folder["MSFS-UI-GENERATOR"]);

        Assert.AreEqual(folder["MSFS-UI-GENERATOR"], paths.Root);
        Assert.IsTrue(File.Exists(paths.SettingsFile), "settings moved");
        Assert.IsFalse(Directory.Exists(folder["MSFS-UI"]), "legacy folder gone");
    }

    [TestMethod]
    public void AnExistingFolderWinsOverTheLegacyOne()
    {
        using var folder = new TestSupport.TempFolder();
        folder.Write("MSFS-UI/settings.json", "{}");
        folder.Write("MSFS-UI-GENERATOR/app.json", "{}");

        var paths = AppPaths.FromLegacy(folder["MSFS-UI"], folder["MSFS-UI-GENERATOR"]);

        Assert.AreEqual(folder["MSFS-UI-GENERATOR"], paths.Root);
        Assert.IsTrue(Directory.Exists(folder["MSFS-UI"]), "legacy folder left alone");
    }

    [TestMethod]
    public void RejectsAnEmptyRoot()
    {
        Assert.ThrowsExactly<ArgumentException>(() => new AppPaths(" "));
    }
}
