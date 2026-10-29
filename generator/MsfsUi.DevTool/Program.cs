using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using MsfsUi.Core;
using MsfsUi.Core.Coherent;
using MsfsUi.Core.Compatibility;
using MsfsUi.Core.Features;
using MsfsUi.Core.Packaging;
using MsfsUi.Core.Sim;

// Developer console over MsfsUi.Core (not shipped). Usage: msfs-ui-dev <command> [options]; see Usage below.
using var loggers = LoggerFactory.Create(builder => builder.AddSimpleConsole(options => options.SingleLine = true).SetMinimumLevel(LogLevel.Information));
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
using var cancel = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cancel.Cancel();
};

var time = TimeProvider.System;
var paths = AppPaths.ForCurrentUser();
var locator = new SimLocator(new WindowsSimEnvironment(), loggers.CreateLogger<SimLocator>());
var builder = new PackageBuilder(time, loggers.CreateLogger<PackageBuilder>());
using var installer = new PackageInstaller(builder, locator, paths, loggers.CreateLogger<PackageInstaller>());
var inspector = new CoherentInspector(http, new CoherentInspectorOptions(), time, loggers.CreateLogger<CoherentInspector>());
var checker = new CompatibilityChecker(inspector, loggers.CreateLogger<CompatibilityChecker>());

var command = args.Length > 0 ? args[0] : "help";
string Option(string name, string fallback)
{
    var at = Array.IndexOf(args, name);
    if (at < 0)
    {
        return fallback;
    }

    return at + 1 < args.Length && !args[at + 1].StartsWith("--", StringComparison.Ordinal)
        ? args[at + 1]
        : throw new MsfsUiException($"{name}: value missing.");
}

var repository = FindRepository();
PackageInputs Inputs()
{
    var catalog = FeatureCatalog.Parse(File.ReadAllText(Path.Combine(repository, "mod", "features.json")));
    var settingsFile = Option("--settings", paths.SettingsFile);
    FeatureSettings? settings = null;
    if (File.Exists(settingsFile))
    {
        settings = FeatureSettings.TryParse(File.ReadAllText(settingsFile)) ?? throw new MsfsUiException($"{settingsFile} is not valid settings JSON.");
        Console.WriteLine($"Settings     : {settingsFile}");
    }
    else if (args.Contains("--settings"))
    {
        throw new MsfsUiException($"{settingsFile} not found.");
    }

    var normalized = SettingsNormalizer.Normalize(catalog, settings);
    foreach (var adjustment in normalized.Adjustments)
    {
        Console.WriteLine($"Settings     : {adjustment}");
    }

    var vaultOption = Option("--vault", Path.Combine(repository, "wasm", "dist", "msfs-ui.wasm"));
    ReadOnlyMemory<byte> vault = string.Equals(vaultOption, "none", StringComparison.OrdinalIgnoreCase)
        ? ReadOnlyMemory<byte>.Empty
        : ReadMod(vaultOption, "pwsh -File wasm/build.ps1");
    var inputs = PackageInputs.ForMod(catalog, ReadMod(Option("--mod", Path.Combine(repository, "mod", "dist", "main.js")), "npm run build in mod"), vault, normalized.Selection);
    return inputs with { Version = Option("--version", inputs.Version) };
}

static byte[] ReadMod(string path, string build) =>
    File.Exists(path) ? File.ReadAllBytes(path) : throw new MsfsUiException($"{path} not found: run `{build}` first.");

try
{
    var ct = cancel.Token;
    switch (command)
    {
        case "status":
        {
            var sim = await locator.LocateAsync(cancellationToken: ct);
            var status = await installer.GetStatusAsync(sim, Inputs(), ct);
            Console.WriteLine($"Sim          : {sim.Edition}, fs-base-ui {sim.FsBaseUiVersion} ({sim.FsBaseUiPath})");
            Console.WriteLine($"Community    : {sim.CommunityPath}");
            Console.WriteLine($"Package      : {status.Kind}{(status.Installed is { } s ? $", {s.Version} built {s.BuiltAt}" : string.Empty)}");
            Console.WriteLine($"Reasons      : {(status.Reasons.Count == 0 ? "none" : string.Join(", ", status.Reasons))}");
            Console.WriteLine($"Conflicts    : {(status.Conflicts.Count == 0 ? "none" : string.Join(", ", status.Conflicts))}");
            Console.WriteLine($"Sim running  : {(status.SimRunning ? "yes" : "no")}");
            break;
        }

        case "install":
        {
            var sim = await locator.LocateAsync(cancellationToken: ct);
            var result = await installer.InstallAsync(sim, Inputs(), ct);
            Console.WriteLine($"Installed {result.State.Version} in {result.PackageFolder} (first install: {result.FirstInstall}, MasterPage changed: {result.MasterPageChanged}). Next step: {result.NextStep}.");
            break;
        }

        case "remove":
        {
            var sim = await locator.LocateAsync(cancellationToken: ct);
            Console.WriteLine(await installer.RemoveAsync(sim, ct) ? "Package removed." : "Package not installed.");
            break;
        }

        case "check":
        {
            var sim = await locator.LocateAsync(cancellationToken: ct);
            var manifest = CompatManifest.Parse(await File.ReadAllTextAsync(Option("--manifest", Path.Combine(repository, "mod", "compat.json")), ct));
            Print($"Sim files (fs-base-ui {sim.FsBaseUiVersion})", await checker.CheckOfflineAsync(manifest, sim.FsBaseUiPath, ct), args.Contains("--detail"));
            var live = await checker.CheckLiveAsync(manifest, ct);
            if (live is null)
            {
                Console.WriteLine("Sim running: no (inspector not answering), live checks skipped.");
            }
            else
            {
                Print("Sim running (mainUi page)", live, args.Contains("--detail"));
            }

            break;
        }

        case "console":
            foreach (var line in await inspector.ReadConsoleAsync(Option("--page", CoherentInspector.MainPage), ct))
            {
                if (args.Length < 2 || args[1].StartsWith("--", StringComparison.Ordinal) || line.Contains(args[1], StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine(line);
                }
            }

            break;

        case "eval":
        {
            var source = args.Length > 1 ? args[1] : throw new MsfsUiException("eval: expression missing.");
            var expression = source.StartsWith('@') ? await File.ReadAllTextAsync(source[1..], ct) : source;
            var result = await inspector.EvaluateAsync(expression, Option("--page", CoherentInspector.MainPage), cancellationToken: ct);
            Console.WriteLine(result.Ok ? (result.Value is { } value ? JsonSerializer.Serialize(value) : "undefined") : $"Error: {result.Error}");
            return result.Ok ? 0 : 1;
        }

        case "reload":
        {
            var result = await inspector.ReloadModAsync(ct);
            Console.WriteLine(result.Ok ? "Mod reloaded." : $"Error: {result.Error}");
            return result.Ok ? 0 : 1;
        }

        default:
            Console.WriteLine("""
                Usage: msfs-ui-dev <command> [options]
                  status   [package options]                    package status in Community
                  install  [package options]                    generate and install the package
                  remove                                        remove the package from Community
                  check    [--manifest compat.json] [--detail]  compatibility (offline, and live if the sim runs)
                  console  [filter] [--page mainUi]             console of a page of the sim's UI
                  eval     <expression|@file> [--page mainUi]   evaluate JavaScript in a page
                  reload                                        hot-reload the mod
                Package options:
                  --settings file   the app's settings format (default %LOCALAPPDATA%\MSFS-UI-GENERATOR\settings.json if present,
                                    else the defaults of mod\features.json)
                  --mod main.js     default mod\dist\main.js (npm run build in mod)
                  --vault file|none default wasm\dist\msfs-ui.wasm (pwsh -File wasm/build.ps1); none: a package without the module
                  --version v       default the modVersion of features.json
                """);
            return command == "help" ? 0 : 1;
    }

    return 0;
}
catch (MsfsUiException ex)
{
    Console.Error.WriteLine($"Error: {ex.Message}");
    return 1;
}

static void Print(string title, IReadOnlyList<CheckResult> checks, bool detail)
{
    Console.WriteLine(title);
    foreach (var group in checks.GroupBy(check => check.Group))
    {
        var failed = group.Where(check => !check.Ok).ToList();
        Console.WriteLine($"  {(failed.Count > 0 ? "FAILED" : "OK    ")}  {group.Key,-34}{group.Count() - failed.Count}/{group.Count()}");
        foreach (var check in detail ? [.. group] : failed)
        {
            var text = new StringBuilder($"          {(check.Ok ? "+" : "x")} {check.Label}");
            if (!string.IsNullOrEmpty(check.Detail) && (detail || !check.Ok))
            {
                text.Append(" : ").Append(check.Detail);
            }

            Console.WriteLine(text);
        }
    }

    Console.WriteLine($"  {checks.Count(check => check.Ok)}/{checks.Count} passed");
}

static string FindRepository()
{
    for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
    {
        if (File.Exists(Path.Combine(folder.FullName, "mod", "compat.json")))
        {
            return folder.FullName;
        }
    }

    return Directory.GetCurrentDirectory();
}
