namespace MsfsUi.Core.Sim;

/// <summary>How the sim installation was found.</summary>
public enum SimEdition
{
    /// <summary>MSFS 2024 from Steam.</summary>
    Steam,

    /// <summary>MSFS 2024 from the Microsoft Store (Xbox app).</summary>
    Store,

    /// <summary>Both folders were given explicitly; nothing was detected.</summary>
    Manual,
}

/// <summary>
/// A located MSFS 2024 installation: the base UI package the MasterPage is read from, and the Community folder
/// the generated package is installed into.
/// </summary>
/// <param name="Edition">How the installation was found.</param>
/// <param name="FsBaseUiPath">Folder of the <c>fs-base-ui</c> base package.</param>
/// <param name="FsBaseUiVersion"><c>package_version</c> of its manifest, or <c>?</c> if unreadable.</param>
/// <param name="CommunityPath">Community folder (<c>&lt;InstalledPackagesPath&gt;\Community</c>).</param>
public sealed record SimInstallation(SimEdition Edition, string FsBaseUiPath, string FsBaseUiVersion, string CommunityPath);

/// <summary>
/// Folders to use instead of the detected ones. When both are set, detection is skipped
/// (<see cref="SimEdition.Manual"/>); when one is set, it replaces the detected value.
/// </summary>
public sealed record SimLocatorOptions
{
    /// <summary>Community folder to use instead of the detected one.</summary>
    public string? CommunityPath { get; init; }

    /// <summary><c>fs-base-ui</c> folder to use instead of the detected one.</summary>
    public string? FsBaseUiPath { get; init; }
}
