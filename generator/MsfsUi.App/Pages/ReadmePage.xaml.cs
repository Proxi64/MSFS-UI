using Microsoft.UI.Xaml.Controls;
using MsfsUi.App.Services;
using MsfsUi.Core;

namespace MsfsUi.App.Pages;

/// <summary>
/// Readme page: how the app and the mod work, and that no file of the simulator is modified. Static text, from the
/// resources; only the version is computed.
/// </summary>
public sealed partial class ReadmePage : Page
{
    public ReadmePage()
    {
        InitializeComponent();
    }

    /// <summary>The app's name and version, at the bottom of the note.</summary>
    public string VersionText { get; } = Strings.Format("ReadmeVersion", ProductInfo.Name, ProductInfo.Version);
}
