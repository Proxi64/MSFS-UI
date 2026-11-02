using System.Globalization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
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

    /// <summary>
    /// A NumberBox takes what is typed only when it loses the focus, and a click on a disabled button does not take the
    /// focus: Apply would stay disabled under the pointer. So the text being typed counts as a change at once; the click
    /// on Apply then takes the focus, which gives the box its value before the command runs.
    /// </summary>
    private void NumberBox_Loaded(object sender, RoutedEventArgs e)
    {
        if (FindInput((DependencyObject)sender) is { } input)
        {
            input.TextChanged -= NumberInput_TextChanged;
            input.TextChanged += NumberInput_TextChanged;
        }
    }

    private void NumberInput_TextChanged(object sender, TextChangedEventArgs e)
    {
        var input = (TextBox)sender;
        DependencyObject? parent = input;
        while (parent is not null and not NumberBox)
        {
            parent = VisualTreeHelper.GetParent(parent);
        }

        if (parent is NumberBox box)
        {
            ViewModel.NumberTyped(!ShowsValue(input.Text, box.Value));
        }
    }

    /// <summary>Whether the text is the box's value, in the box's own format (a point) or the culture's.</summary>
    private static bool ShowsValue(string text, double value) =>
        (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && number.Equals(value))
        || (double.TryParse(text, NumberStyles.Float, CultureInfo.CurrentCulture, out number) && number.Equals(value));

    private static TextBox? FindInput(DependencyObject element)
    {
        for (var at = 0; at < VisualTreeHelper.GetChildrenCount(element); at++)
        {
            var child = VisualTreeHelper.GetChild(element, at);
            if ((child as TextBox ?? FindInput(child)) is { } input)
            {
                return input;
            }
        }

        return null;
    }
}
