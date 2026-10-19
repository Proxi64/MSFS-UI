using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MsfsUi.App.ViewModels;

namespace MsfsUi.App.Pages;

/// <summary>
/// Features page: every feature of the mod with its options (see <see cref="FeaturesViewModel"/>).
/// </summary>
public sealed partial class FeaturesPage : Page
{
    public FeaturesPage()
    {
        InitializeComponent();
    }

    /// <summary>Shared for the app's lifetime: changes not applied yet survive a visit to another page.</summary>
    public FeaturesViewModel ViewModel { get; } = App.Services.GetRequiredService<FeaturesViewModel>();

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        await ViewModel.LoadAsync();
    }
}
