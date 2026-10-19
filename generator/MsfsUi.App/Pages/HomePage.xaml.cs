using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml.Controls;
using MsfsUi.App.ViewModels;

namespace MsfsUi.App.Pages;

/// <summary>
/// Home page: the sim found, the package in Community and its actions (see <see cref="HomeViewModel"/>).
/// </summary>
public sealed partial class HomePage : Page
{
    public HomePage()
    {
        InitializeComponent();
        Unloaded += (_, _) => ViewModel.Dispose();
    }

    public HomeViewModel ViewModel { get; } = App.Services.GetRequiredService<HomeViewModel>();
}
