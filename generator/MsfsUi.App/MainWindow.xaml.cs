using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MsfsUi.App.Pages;
using MsfsUi.App.Services;
using MsfsUi.Core.Settings;
using Windows.Graphics;

namespace MsfsUi.App;

/// <summary>
/// Main window: title bar and navigation between the app pages. Navigation is view logic and stays here;
/// page behaviour lives in the page view models.
/// </summary>
public sealed partial class MainWindow : Window
{
    private static readonly SizeInt32 InitialSize = new(1100, 760);

    private static readonly Dictionary<string, Type> Pages = new(StringComparer.Ordinal)
    {
        ["home"] = typeof(HomePage),
        ["features"] = typeof(FeaturesPage),
        ["compatibility"] = typeof(CompatibilityPage),
        ["log"] = typeof(LogPage),
        ["readme"] = typeof(ReadmePage),
    };

    // Segoe Fluent Icons, built from their code points (no invisible character in the source).
    private static readonly string MoonGlyph = char.ConvertFromUtf32(0xE708);
    private static readonly string SunGlyph = char.ConvertFromUtf32(0xE706);

    private readonly ThemeService _theme = App.Services.GetRequiredService<ThemeService>();

    public MainWindow()
    {
        InitializeComponent();
        _theme.Changed += (_, _) => ShowThemeButton();
        ShowThemeButton();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
        AppWindow.SetIcon("Assets/AppIcon.ico");
        AppWindow.Resize(InitialSize);

        NavView.SelectedItem = HomeItem;
    }

    private async void ThemeButton_Click(object sender, RoutedEventArgs e) => await _theme.ToggleAsync();

    /// <summary>The button shows the theme it switches to, and says so.</summary>
    private void ShowThemeButton()
    {
        var toDark = _theme.Current != AppTheme.Dark;
        ThemeIcon.Glyph = toDark ? MoonGlyph : SunGlyph;
        var text = Strings.Get(toDark ? "ThemeToDark" : "ThemeToLight");
        ToolTipService.SetToolTip(ThemeButton, text);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(ThemeButton, text);
    }

    private void TitleBar_PaneToggleRequested(TitleBar sender, object args)
    {
        NavView.IsPaneOpen = !NavView.IsPaneOpen;
    }

    private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is NavigationViewItem { Tag: string tag } && Pages.TryGetValue(tag, out var page)
            && ContentFrame.CurrentSourcePageType != page)
        {
            ContentFrame.Navigate(page);
        }
    }
}
