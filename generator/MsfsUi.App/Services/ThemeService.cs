using Microsoft.Extensions.Logging;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using MsfsUi.Core.Settings;

namespace MsfsUi.App.Services;

/// <summary>
/// The app's light or dark theme: Windows' theme until the user picks one with the sun / moon button, then that
/// choice, kept in <c>app.json</c>. Applied to the window's content and to its title bar buttons.
/// </summary>
public sealed partial class ThemeService
{
    private readonly SettingsStore _store;
    private readonly ILogger<ThemeService> _logger;
    private Window? _window;

    public ThemeService(SettingsStore store, ILogger<ThemeService> logger)
    {
        _store = store;
        _logger = logger;
    }

    /// <summary>The theme shown.</summary>
    public AppTheme Current { get; private set; }

    /// <summary>Raised after the theme changed.</summary>
    public event EventHandler? Changed;

    /// <summary>Applies the remembered theme (or Windows' one) to the window, before it is shown.</summary>
    public async Task AttachAsync(Window window)
    {
        _window = window;
        AppTheme? chosen = null;
        try
        {
            chosen = (await _store.LoadPreferencesAsync()).Theme;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            LogNotRead(ex);
        }

        Apply(chosen ?? WindowsTheme());
    }

    /// <summary>Switches between light and dark, and remembers the choice.</summary>
    public async Task ToggleAsync()
    {
        var next = Current == AppTheme.Dark ? AppTheme.Light : AppTheme.Dark;
        Apply(next);
        try
        {
            // The other preferences (folders chosen by hand) are kept.
            var preferences = await _store.LoadPreferencesAsync();
            await _store.SavePreferencesAsync(preferences with { Theme = next });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            LogNotSaved(ex);
        }
    }

    /// <summary>Windows' app mode, which the app follows when no theme was chosen in it.</summary>
    private static AppTheme WindowsTheme() =>
        Application.Current.RequestedTheme == ApplicationTheme.Dark ? AppTheme.Dark : AppTheme.Light;

    private void Apply(AppTheme theme)
    {
        Current = theme;
        if (_window is not null)
        {
            if (_window.Content is FrameworkElement root)
            {
                root.RequestedTheme = theme == AppTheme.Dark ? ElementTheme.Dark : ElementTheme.Light;
            }

            // The minimise, maximise and close buttons are drawn by Windows: they follow this, not the content.
            _window.AppWindow.TitleBar.PreferredTheme = theme == AppTheme.Dark ? TitleBarTheme.Dark : TitleBarTheme.Light;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "The theme preference could not be read: Windows' theme is used")]
    private partial void LogNotRead(Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "The theme preference could not be saved")]
    private partial void LogNotSaved(Exception exception);
}
