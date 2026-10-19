using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Xaml;
using MsfsUi.App.Services;
using MsfsUi.App.ViewModels;
using MsfsUi.Core;
using MsfsUi.Core.Coherent;
using MsfsUi.Core.Compatibility;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Settings;
using MsfsUi.Core.Sim;

namespace MsfsUi.App;

/// <summary>
/// Application entry: builds the service container, opens the main window and keeps the sim's state up to date
/// while it is open.
/// </summary>
public partial class App : Application
{
    /// <summary>Data folder used instead of <c>%LOCALAPPDATA%\MSFS-UI</c> (UI tests only).</summary>
    public const string TestDataRootVariable = "MSFS_UI_DATA_ROOT";

    /// <summary>Address of the sim's inspector used instead of the real one (UI tests only).</summary>
    public const string TestInspectorHostVariable = "MSFS_UI_INSPECTOR_HOST";

    private Window? _window;

    public App()
    {
        InitializeComponent();
        Services = ConfigureServices();
        var logger = Services.GetRequiredService<ILogger<App>>();
        UnhandledException += (_, e) => LogUnhandled(logger, e.Exception);
    }

    /// <summary>Services of the app: the Core services, the shared state and the page view models.</summary>
    public static IServiceProvider Services { get; private set; } = null!;

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        var logger = Services.GetRequiredService<ILogger<App>>();
        if (logger.IsEnabled(LogLevel.Information))
        {
            LogStarted(logger, ProductInfo.Version);
        }

        _window = new MainWindow();
        Services.GetRequiredService<DialogService>().Window = _window;
        // The remembered theme is applied before the window shows, so that it never flashes in the other one.
        await Services.GetRequiredService<ThemeService>().AttachAsync(_window);
        // The sim's state is polled while the window is open.
        var closing = new CancellationTokenSource();
        _window.Closed += (_, _) =>
        {
            closing.Cancel();
            closing.Dispose();
        };
        _window.Activate();
        _ = Services.GetRequiredService<SimSession>().RunAsync(closing.Token);
    }

    private static ServiceProvider ConfigureServices()
    {
        var services = new ServiceCollection();
        // The UI tests run the app on an isolated profile: their own data folder (with the fake sim's folders in
        // its app.json), and an inspector address where nothing listens, so that the real sim is never reached.
        var dataRoot = Environment.GetEnvironmentVariable(TestDataRootVariable);
        var paths = string.IsNullOrWhiteSpace(dataRoot) ? AppPaths.ForCurrentUser() : new AppPaths(dataRoot);
        var inspectorHost = Environment.GetEnvironmentVariable(TestInspectorHostVariable);
        var time = TimeProvider.System;
        var log = new FileLoggerProvider(paths.Logs, time);

        services.AddLogging(builder => builder.ClearProviders().SetMinimumLevel(LogLevel.Information).AddProvider(log));
        services.AddSingleton(log);
        services.AddSingleton(paths);
        services.AddSingleton(time);

        // Core services (MsfsUi.Core), as the developer tool composes them.
        services.AddSingleton<ISimEnvironment, WindowsSimEnvironment>();
        services.AddSingleton<SimLocator>();
        services.AddSingleton<PackageBuilder>();
        services.AddSingleton<PackageInstaller>();
        services.AddSingleton(new HttpClient { Timeout = TimeSpan.FromSeconds(5) });
        services.AddSingleton(string.IsNullOrWhiteSpace(inspectorHost) ? new CoherentInspectorOptions() : new CoherentInspectorOptions { Host = inspectorHost });
        services.AddSingleton<CoherentInspector>();
        services.AddSingleton<CompatibilityChecker>();
        services.AddSingleton<SettingsStore>();

        // The app's own services and view models.
        services.AddSingleton<ModResources>();
        services.AddSingleton<SimSession>();
        services.AddSingleton<DialogService>();
        services.AddSingleton<ThemeService>();
        services.AddSingleton<IDialogService>(provider => provider.GetRequiredService<DialogService>());
        services.AddTransient<HomeViewModel>();
        services.AddSingleton<FeaturesViewModel>();
        services.AddTransient<CompatibilityViewModel>();
        services.AddTransient<LogViewModel>();
        return services.BuildServiceProvider();
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "MSFS-UI-GENERATOR {Version} started")]
    private static partial void LogStarted(ILogger logger, string version);

    [LoggerMessage(Level = LogLevel.Critical, Message = "Unhandled exception")]
    private static partial void LogUnhandled(ILogger logger, Exception exception);
}
