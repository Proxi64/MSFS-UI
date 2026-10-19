using MsfsUi.Core.Packaging;

namespace MsfsUi.Core;

/// <summary>
/// Folders and files the app owns, under one root (<c>%LOCALAPPDATA%\MSFS-UI-GENERATOR</c> for the real user). Tests give
/// a temporary root so they never touch the real profile.
/// </summary>
public sealed class AppPaths
{
    /// <summary>Creates the paths under <paramref name="root"/>.</summary>
    public AppPaths(string root)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(root);
        Root = root;
    }

    /// <summary>Name of the data folder before the app was named MSFS-UI-GENERATOR.</summary>
    public const string LegacyFolderName = "MSFS-UI";

    /// <summary>
    /// The paths of the current Windows user: <c>%LOCALAPPDATA%\MSFS-UI-GENERATOR</c>. The folder of earlier versions
    /// (<see cref="LegacyFolderName"/>) is moved there the first time.
    /// </summary>
    public static AppPaths ForCurrentUser()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return FromLegacy(Path.Combine(local, LegacyFolderName), Path.Combine(local, ProductInfo.Name));
    }

    /// <summary>
    /// The paths under <paramref name="root"/>, after moving <paramref name="legacyRoot"/> there when only the legacy
    /// folder exists. If it cannot be moved (a file in use), the legacy folder is used as it is.
    /// </summary>
    public static AppPaths FromLegacy(string legacyRoot, string root)
    {
        if (Directory.Exists(root) || !Directory.Exists(legacyRoot))
        {
            return new AppPaths(root);
        }

        try
        {
            Directory.Move(legacyRoot, root);
            return new AppPaths(root);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new AppPaths(legacyRoot);
        }
    }

    /// <summary>Root folder of the app's data.</summary>
    public string Root { get; }

    /// <summary>Where the package is generated before being copied to Community.</summary>
    public string StagingPackage => Path.Combine(Root, "staging", PackageLayout.PackageName);

    /// <summary>Log files of the app.</summary>
    public string Logs => Path.Combine(Root, "logs");

    /// <summary>The user's feature choices.</summary>
    public string SettingsFile => Path.Combine(Root, "settings.json");

    /// <summary>The app's own preferences (folders chosen by hand).</summary>
    public string PreferencesFile => Path.Combine(Root, "app.json");
}
