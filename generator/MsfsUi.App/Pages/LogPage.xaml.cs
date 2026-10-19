using System.Collections.Specialized;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml.Controls;
using MsfsUi.App.ViewModels;

namespace MsfsUi.App.Pages;

/// <summary>
/// Log page: the app's log, live, and the mod's log read from the sim (see <see cref="LogViewModel"/>). Switching
/// between them and following the newest line are view logic, kept here.
/// </summary>
public sealed partial class LogPage : Page
{
    public LogPage()
    {
        InitializeComponent();
        ViewModel.AppLines.CollectionChanged += OnAppLinesChanged;
        Loaded += (_, _) => ScrollToEnd(AppList, ViewModel.AppLines.Count);
        Unloaded += (_, _) =>
        {
            ViewModel.AppLines.CollectionChanged -= OnAppLinesChanged;
            ViewModel.Dispose();
        };
    }

    public LogViewModel ViewModel { get; } = App.Services.GetRequiredService<LogViewModel>();

    private void Logs_SelectionChanged(SelectorBar sender, SelectorBarSelectionChangedEventArgs args)
    {
        ViewModel.ShowsMod = sender.SelectedItem == ModTab;
        if (ViewModel.ShowsMod && ViewModel.ReadModCommand.CanExecute(null) && ViewModel.ModLines.Count == 0)
        {
            ViewModel.ReadModCommand.Execute(null);
        }
    }

    private void OnAppLinesChanged(object? sender, NotifyCollectionChangedEventArgs e) => ScrollToEnd(AppList, ViewModel.AppLines.Count);

    private static void ScrollToEnd(ListView list, int count)
    {
        if (count > 0)
        {
            list.ScrollIntoView(list.Items[count - 1]);
        }
    }
}
