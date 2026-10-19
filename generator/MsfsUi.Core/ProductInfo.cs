using System.Reflection;

namespace MsfsUi.Core;

/// <summary>
/// Name and version of the product, shared by the app and the generated package.
/// </summary>
public static class ProductInfo
{
    /// <summary>Product name, as shown in the app and in the package manifest.</summary>
    public const string Name = "MSFS-UI-GENERATOR";

    /// <summary>
    /// Product version (informational version of this assembly, without the source revision suffix).
    /// </summary>
    public static string Version { get; } = ReadVersion();

    private static string ReadVersion()
    {
        var informational = typeof(ProductInfo).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        if (string.IsNullOrEmpty(informational))
        {
            return "0.0.0";
        }

        var plus = informational.IndexOf('+', StringComparison.Ordinal);
        return plus < 0 ? informational : informational[..plus];
    }
}
