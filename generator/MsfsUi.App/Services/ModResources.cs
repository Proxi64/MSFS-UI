using System.Reflection;
using MsfsUi.Core.Compatibility;
using MsfsUi.Core.Features;

namespace MsfsUi.App.Services;

/// <summary>
/// The menu mod embedded in the app (see the project file): its module (<c>main.js</c>), its feature catalogue
/// (<c>features.json</c>) and what it needs from the sim (<c>compat.json</c>).
/// </summary>
public sealed class ModResources
{
    private const string Prefix = "MsfsUi.Mod.";

    public ModResources()
    {
        ModScript = ReadBytes("main.js");
        Catalog = FeatureCatalog.Parse(ReadText("features.json"));
        Compat = CompatManifest.Parse(ReadText("compat.json"));
    }

    /// <summary>The mod module, copied unchanged into the package.</summary>
    public ReadOnlyMemory<byte> ModScript { get; }

    /// <summary>Every feature of the mod with its options and defaults.</summary>
    public FeatureCatalog Catalog { get; }

    /// <summary>What the mod uses in the sim, for the compatibility check.</summary>
    public CompatManifest Compat { get; }

    private static byte[] ReadBytes(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(Prefix + name)
            ?? throw new InvalidOperationException($"The embedded mod file {name} is missing from the app.");
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    private static string ReadText(string name) => System.Text.Encoding.UTF8.GetString(ReadBytes(name));
}
