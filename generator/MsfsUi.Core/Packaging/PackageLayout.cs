namespace MsfsUi.Core.Packaging;

/// <summary>
/// Shape of the Community package. This is the only place that knows it.
/// </summary>
/// <remarks>
/// <code>
/// cookedcomps/{MasterPage}.html   copy of the sim component, with the loader inserted
/// cookedcomps/{MasterPage}.json   unchanged copy
/// html_ui/msfs-ui/main.js         the menu mod (embedded in the app, ES2017)
/// html_ui/msfs-ui/config.js       the user's settings, read by the mod at runtime
/// html_ui/msfs-ui/px.gif          1 × 1 image that triggers the loader
/// modules/msfs-ui.wasm            the vault, a WASM module of the sim (embedded in the app; may be absent)
/// msfs-ui.json                    package state (versions and hashes)
/// layout.json, manifest.json      files the sim expects in every package
/// </code>
/// No sim file ships with the app: the MasterPage is read on the user's machine at generation time.
/// </remarks>
public static class PackageLayout
{
    /// <summary>Folder name of the package in Community.</summary>
    public const string PackageName = "msfs-ui";

    /// <summary>Package state file.</summary>
    public const string StateFile = "msfs-ui.json";

    /// <summary>GUID of the menu's root component, the MasterPage.</summary>
    public const string MasterPageGuid = "{7DA60FBA-EF32-48F2-974D-F8BEA35337A4}";

    /// <summary>Path of the mod module in the package.</summary>
    public const string ModulePath = "html_ui/msfs-ui/main.js";

    /// <summary>Path of the generated settings module in the package.</summary>
    public const string ConfigPath = "html_ui/msfs-ui/config.js";

    /// <summary>Path of the vault WASM module in the package (the sim runs it from start-up to quit).</summary>
    public const string VaultModulePath = "modules/msfs-ui.wasm";

    /// <summary>Path of the loader trigger image in the package.</summary>
    public const string PixelPath = "html_ui/msfs-ui/px.gif";

    /// <summary>Package manifest required by the sim.</summary>
    public const string ManifestFile = "manifest.json";

    /// <summary>Package file list required by the sim.</summary>
    public const string LayoutFile = "layout.json";

    /// <summary>Path of the MasterPage component HTML, relative to a package folder.</summary>
    public static string MasterPageHtmlPath => $"cookedcomps/{MasterPageGuid}.html";

    /// <summary>Path of the MasterPage component JSON, relative to a package folder.</summary>
    public static string MasterPageJsonPath => $"cookedcomps/{MasterPageGuid}.json";

    /// <summary>Transparent 1 × 1 GIF.</summary>
    internal static ReadOnlyMemory<byte> Pixel { get; } = Convert.FromBase64String("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");

    /// <summary>Full path of a package-relative path (forward slashes) under a package folder.</summary>
    public static string Resolve(string packageFolder, string relativePath)
    {
        return Path.Combine(packageFolder, relativePath.Replace('/', Path.DirectorySeparatorChar));
    }
}
