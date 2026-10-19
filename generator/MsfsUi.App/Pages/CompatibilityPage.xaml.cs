using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MsfsUi.App.ViewModels;

namespace MsfsUi.App.Pages;

/// <summary>
/// Compatibility page: what the mod needs from the sim, checked (see <see cref="CompatibilityViewModel"/>).
/// </summary>
public sealed partial class CompatibilityPage : Page
{
    public CompatibilityPage()
    {
        InitializeComponent();
    }

    public CompatibilityViewModel ViewModel { get; } = App.Services.GetRequiredService<CompatibilityViewModel>();

    /// <summary>The check runs when the page opens.</summary>
    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        if (ViewModel.RunCommand.CanExecute(null))
        {
            ViewModel.RunCommand.Execute(null);
        }
    }
}
