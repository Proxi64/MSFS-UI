using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using MsfsUi.Core.Coherent;

namespace MsfsUi.Core.Compatibility;

/// <summary>
/// Checks that the installed sim still provides what the mod relies on (<see cref="CompatManifest"/>): offline in
/// the files of <c>fs-base-ui</c>, and live in the main menu when the sim runs. The check sees whether names are
/// present, not whether their behaviour changed.
/// </summary>
public sealed partial class CompatibilityChecker
{
    /// <summary>Time allowed to the live probe besides its checks (module imports, registry, translations…).</summary>
    private static readonly TimeSpan LiveProbeBaseTimeout = TimeSpan.FromSeconds(15);

    private const int DefaultLiveCheckTimeoutMs = 3000;

    private readonly CoherentInspector _inspector;
    private readonly ILogger<CompatibilityChecker> _logger;

    /// <summary>Creates the checker.</summary>
    public CompatibilityChecker(CoherentInspector inspector, ILogger<CompatibilityChecker> logger)
    {
        _inspector = inspector;
        _logger = logger;
    }

    /// <summary>Checks the files of <c>fs-base-ui</c> (scripts and styles of <c>html_ui</c>, cooked components).</summary>
    public async Task<IReadOnlyList<CheckResult>> CheckOfflineAsync(CompatManifest manifest, string fsBaseUiPath, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentException.ThrowIfNullOrWhiteSpace(fsBaseUiPath);

        var scripts = await ReadFilesAsync(Path.Combine(fsBaseUiPath, "html_ui"), "*.*", name => name.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".css", StringComparison.OrdinalIgnoreCase), cancellationToken).ConfigureAwait(false);
        var components = (await ReadFilesAsync(Path.Combine(fsBaseUiPath, "cookedcomps"), "*.html", _ => true, cancellationToken).ConfigureAwait(false)).Values.ToList();
        var allScripts = scripts.Values.ToList();
        var results = new List<CheckResult>();

        foreach (var requirement in manifest.Exports)
        {
            var path = $"Global/{requirement.Module}";
            var exported = ModuleExports(scripts, path);
            foreach (var name in requirement.Names)
            {
                results.Add(Result("Module exports", $"{name} ({requirement.Module})", exported.Contains(name), scripts.ContainsKey(path) ? "export not found" : "module not found"));
            }
        }

        foreach (var screen in manifest.Screens)
        {
            var found = allScripts.Any(code => code.Contains(screen.ComponentGuid, StringComparison.Ordinal) && code.Contains(screen.ClassName, StringComparison.Ordinal));
            results.Add(Result("Screens", $"{screen.Label}: {screen.ClassName} {screen.ComponentGuid}", found, "GUID or class not found"));
        }

        foreach (var anchor in manifest.Anchors)
        {
            var needle = $"name=\"{anchor}\"";
            results.Add(Result("Anchors", needle, components.Any(html => html.Contains(needle, StringComparison.Ordinal)), "missing from the components"));
        }

        foreach (var component in manifest.Components)
        {
            results.Add(await CheckComponentAsync(component, fsBaseUiPath, cancellationToken).ConfigureAwait(false));
        }

        foreach (var requirement in manifest.ComponentPatterns)
        {
            var patterns = requirement.Patterns.Select(pattern => new Regex(pattern, RegexOptions.CultureInvariant, TimeSpan.FromSeconds(5))).ToList();
            var found = components.Any(html => html.Contains(requirement.Component, StringComparison.Ordinal) && patterns.All(pattern => pattern.IsMatch(html)));
            results.Add(Result(requirement.Group, requirement.Label, found, requirement.Failure));
        }

        foreach (var group in manifest.Symbols)
        {
            foreach (var name in group.Names)
            {
                results.Add(Result(group.Group, name, allScripts.Any(code => code.Contains(name, StringComparison.Ordinal)), "not found in html_ui"));
            }
        }

        foreach (var file in manifest.Files)
        {
            results.Add(Result("Files", file, File.Exists(Path.Combine(fsBaseUiPath, file.Replace('/', Path.DirectorySeparatorChar))), "missing from fs-base-ui"));
        }

        var failures = results.Count(result => !result.Ok);
        LogOffline(failures, results.Count, fsBaseUiPath);
        return results;
    }

    /// <summary>
    /// Runs the live checks in the main menu, plus "no <c>[error] [msfs-ui]</c> in the console". Returns null when
    /// the inspector does not answer (sim closed): live checks are then skipped, which is not a failure.
    /// </summary>
    public async Task<IReadOnlyList<CheckResult>?> CheckLiveAsync(CompatManifest manifest, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        try
        {
            await _inspector.FindPageAsync(CoherentInspector.MainPage, cancellationToken).ConfigureAwait(false);
        }
        catch (InspectorUnavailableException)
        {
            return null;
        }

        var results = new List<CheckResult>();
        try
        {
            await using var session = await _inspector.OpenSessionAsync(CoherentInspector.MainPage, cancellationToken).ConfigureAwait(false);
            await RunLiveProbeAsync(session, manifest, results, cancellationToken).ConfigureAwait(false);
        }
        catch (InspectorUnavailableException)
        {
            // The sim closed or its UI stopped answering during the check: live checks are skipped.
            return null;
        }

        var failures = results.Count(result => !result.Ok);
        LogLive(failures, results.Count);
        return results;
    }

    /// <summary>
    /// Time allowed to the whole live probe: its fixed part plus the time limit of every check, which run one
    /// after the other.
    /// </summary>
    public static TimeSpan LiveProbeTimeout(CompatManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        return LiveProbeBaseTimeout + TimeSpan.FromMilliseconds(manifest.LiveChecks.Sum(check => check.TimeoutMs ?? DefaultLiveCheckTimeoutMs));
    }

    private static async Task RunLiveProbeAsync(InspectorSession session, CompatManifest manifest, List<CheckResult> results, CancellationToken cancellationToken)
    {
        var probe = await session.EvaluateAsync(LiveProbe(manifest), LiveProbeTimeout(manifest), cancellationToken).ConfigureAwait(false);
        results.AddRange(ProbeResults(probe));

        // The console keeps the whole session: errors of versions unloaded by a hot reload since do not count.
        var lines = await session.ReadConsoleAsync(cancellationToken).ConfigureAwait(false);
        var lastLoad = lines.Count - 1;
        while (lastLoad >= 0 && !lines[lastLoad].Contains(ModLoadedMarker, StringComparison.Ordinal))
        {
            lastLoad--;
        }

        var errors = lines
            .Skip(lastLoad + 1)
            .Where(line => line.Contains("[error] [msfs-ui]", StringComparison.Ordinal))
            .ToList();
        results.Add(Result("Console", "no [error] [msfs-ui] since the mod was loaded", errors.Count == 0, errors.FirstOrDefault() ?? string.Empty));
    }

    /// <summary>
    /// The results the live probe answered; one failed "live probe" result when it failed or answered another shape
    /// (never an exception: a check of the manifest that returns an unexpected value must not bring the app down).
    /// </summary>
    internal static IReadOnlyList<CheckResult> ProbeResults(EvalResult probe)
    {
        var problem = probe.Error;
        if (probe.Ok && probe.Value is { ValueKind: JsonValueKind.Array } value)
        {
            try
            {
                if (JsonSerializer.Deserialize(value, CompatJsonContext.Default.ListCheckResult) is { } results)
                {
                    return results;
                }
            }
            catch (JsonException ex)
            {
                problem = $"unexpected answer: {ex.Message}";
            }
        }

        return [new CheckResult("Mod", "live probe", false, problem ?? "unexpected answer")];
    }

    /// <summary>The first line the mod logs when it is loaded (mod/src/main.ts).</summary>
    public const string ModLoadedMarker = "[msfs-ui] module loaded";

    /// <summary>
    /// The ES2017 program run in the main menu: mod loaded, screens in the registry, the manifest's live checks
    /// (each with its time limit), translation keys, colour variables and the storage API.
    /// </summary>
    public static string LiveProbe(CompatManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        var checks = new StringBuilder();
        foreach (var check in manifest.LiveChecks)
        {
            checks.Append("    { group: ").Append(PagePrograms.JsLiteral(check.Group))
                .Append(", label: ").Append(PagePrograms.JsLiteral(check.Label))
                .Append(", timeoutMs: ").Append((check.TimeoutMs ?? DefaultLiveCheckTimeoutMs).ToString(CultureInfo.InvariantCulture))
                .Append(", run: ").Append(check.Run).Append(" },\n");
        }

        var screens = PagePrograms.EscapeLineSeparators(JsonSerializer.Serialize(manifest.Screens, CompatJsonContext.Default.IReadOnlyListScreenRequirement));
        var translations = PagePrograms.EscapeLineSeparators(JsonSerializer.Serialize(manifest.Translations, CompatJsonContext.Default.IReadOnlyListString));
        var colors = PagePrograms.EscapeLineSeparators(JsonSerializer.Serialize(manifest.ColorVariables, CompatJsonContext.Default.IReadOnlyListString));
        return $$"""
            (async () => {
              const results = [];
              const add = (group, label, ok, detail) => results.push({ group: String(group), label: String(label), ok: !!ok, detail: detail === undefined || detail === null ? '' : String(detail) });
              const timeout = (promise, ms) => Promise.race([
                Promise.resolve(promise),
                new Promise((resolve, reject) => setTimeout(() => reject(new Error('no answer within ' + ms + ' ms')), ms)),
              ]);
              add('Mod', 'loaded (window.__msfsUiRuntime)', !!window.__msfsUiRuntime, window.__msfsUiRuntime ? '' : 'mod missing: restart the sim, then check the package status');
              const modules = await Promise.all([import('/Global/engine_ui.bundle.js'), import('/Global/shared/utils.js'), import('/Global/shared/store.js')]);
              const engineUi = modules[0], utils = modules[1], storeModule = modules[2];
              for (const screen of {{screens}}) {
                const cls = engineUi.GuidToManipulator && engineUi.GuidToManipulator.get(screen.guid);
                add('Screens (registry)', screen.label, cls && cls.name === screen.className, cls ? 'class ' + cls.name : 'missing from GuidToManipulator');
              }
              const store = utils.UniversalProxy(new storeModule.ReadableStore());
              const ctx = { store: store, engineUi: engineUi, utils: utils, flight: store.Game.CurrentFlight.GameFlight, aircraft: store.Game.Aircraft };
              const checks = [
            {{checks}}  ];
              for (const check of checks) {
                try {
                  const verdict = await timeout(check.run(ctx), check.timeoutMs);
                  add(check.group, check.label, verdict === true || (verdict && verdict.ok), verdict && verdict.detail);
                } catch (e) {
                  add(check.group, check.label, false, String((e && e.message) || e));
                }
              }
              const loc = window.top.g_localization;
              for (const key of {{translations}}) {
                const text = loc && loc.Translate(key);
                add('Translations', key, text && text !== key, text || 'not translated');
              }
              const rootStyle = getComputedStyle(document.documentElement), bodyStyle = getComputedStyle(document.body);
              for (const name of {{colors}}) {
                const value = (rootStyle.getPropertyValue(name) || bodyStyle.getPropertyValue(name)).trim();
                add('Sim look', name, value !== '', value || 'variable missing');
              }
              const ds = window.datastorage || window.top.datastorage;
              const isFn = (f) => typeof f === 'function';
              add('Storage', 'datastorage (getData, setData, deleteData, searchData)', ds && isFn(ds.getData) && isFn(ds.setData) && isFn(ds.deleteData) && isFn(ds.searchData));
              return results;
            })()
            """;
    }

    /// <summary>
    /// Names exported by a module of the sim: <c>export{a as B,C}</c> lists, <c>export class|function|const …</c>
    /// declarations, and <c>export*from"…"</c> re-exports, followed (absolute <c>/Global/…</c> or relative paths).
    /// </summary>
    public static HashSet<string> ModuleExports(IReadOnlyDictionary<string, string> scripts, string module)
    {
        ArgumentNullException.ThrowIfNull(scripts);
        return ModuleExports(scripts, module, new HashSet<string>(StringComparer.Ordinal));
    }

    private static HashSet<string> ModuleExports(IReadOnlyDictionary<string, string> scripts, string module, HashSet<string> seen)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        if (!scripts.TryGetValue(module, out var code) || !seen.Add(module))
        {
            return names;
        }

        foreach (Match list in ExportListRegex().Matches(code))
        {
            foreach (var part in list.Groups[1].Value.Split(','))
            {
                var name = AsRegex().Split(part.Trim())[^1].Trim();
                if (name.Length > 0)
                {
                    names.Add(name);
                }
            }
        }

        foreach (Match declaration in ExportDeclarationRegex().Matches(code))
        {
            names.Add(declaration.Groups[1].Value);
        }

        foreach (Match reexport in ReexportRegex().Matches(code))
        {
            var target = reexport.Groups[1].Value;
            var resolved = target.StartsWith('/')
                ? target[1..]
                : NormalizeModulePath($"{module[..(module.LastIndexOf('/') + 1)]}{target}");
            names.UnionWith(ModuleExports(scripts, resolved, seen));
        }

        return names;
    }

    private static string NormalizeModulePath(string path)
    {
        var parts = new List<string>();
        foreach (var part in path.Split('/'))
        {
            if (part == "..")
            {
                if (parts.Count > 0)
                {
                    parts.RemoveAt(parts.Count - 1);
                }
            }
            else if (part is not ("." or ""))
            {
                parts.Add(part);
            }
        }

        return string.Join('/', parts);
    }

    private static async Task<Dictionary<string, string>> ReadFilesAsync(string root, string pattern, Func<string, bool> include, CancellationToken cancellationToken)
    {
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!Directory.Exists(root))
        {
            return files;
        }

        foreach (var file in Directory.EnumerateFiles(root, pattern, SearchOption.AllDirectories).Where(file => include(Path.GetFileName(file))))
        {
            var relative = Path.GetRelativePath(root, file).Replace(Path.DirectorySeparatorChar, '/');
            files[relative] = await File.ReadAllTextAsync(file, cancellationToken).ConfigureAwait(false);
        }

        return files;
    }

    /// <summary>
    /// A component the mod creates: <c>cookedcomps/{GUID}.html</c> has the expected root name, and its <c>.json</c>
    /// still declares the exposed attributes, visual states and exposed values the mod uses; the children the mod's CSS
    /// adjusts are in the component's own markup.
    /// </summary>
    private static async Task<CheckResult> CheckComponentAsync(ComponentRequirement component, string fsBaseUiPath, CancellationToken cancellationToken)
    {
        const string Group = "Sim components";
        var label = $"{component.Label}: {component.Name} {component.ComponentGuid}";
        var folder = Path.Combine(fsBaseUiPath, "cookedcomps");
        var html = Path.Combine(folder, $"{component.ComponentGuid}.html");
        var json = Path.Combine(folder, $"{component.ComponentGuid}.json");
        if (!File.Exists(html) || !File.Exists(json))
        {
            return Result(Group, label, false, "component not found");
        }

        var markup = await File.ReadAllTextAsync(html, cancellationToken).ConfigureAwait(false);
        var root = markup.IndexOf('>', StringComparison.Ordinal) is var end and > 0 ? markup[..end] : markup;
        if (!root.Contains($"name=\"{component.Name}\"", StringComparison.Ordinal))
        {
            return Result(Group, label, false, "the component has another name");
        }

        List<string> attributes;
        List<string> states;
        List<string> values;
        try
        {
            using var metadata = JsonDocument.Parse(await File.ReadAllTextAsync(json, cancellationToken).ConfigureAwait(false));
            attributes = Names(metadata.RootElement, "exposedAttributes");
            states = Names(metadata.RootElement, "visualStates");
            values = metadata.RootElement.TryGetProperty("exposedValues", out var exposed) && exposed.ValueKind == JsonValueKind.Object
                ? [.. exposed.EnumerateObject().Select(property => property.Name)]
                : [];
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return Result(Group, label, false, "unreadable component metadata");
        }

        var missing = (component.Attributes ?? []).Where(name => !attributes.Contains(name)).Select(name => $"attribute {name}")
            .Concat((component.States ?? []).Where(name => !states.Contains(name)).Select(name => $"state {name}"))
            .Concat((component.Values ?? []).Where(name => !values.Contains(name)).Select(name => $"value {name}"))
            .Concat((component.Children ?? []).Where(name => !markup.Contains($"name=\"{name}\"", StringComparison.Ordinal)).Select(name => $"child {name}"))
            .ToList();
        return Result(Group, label, missing.Count == 0, $"missing: {string.Join(", ", missing)}");

        // Entries of another shape are skipped (and reported as missing names), never thrown on.
        static List<string> Names(JsonElement metadata, string property) =>
            metadata.TryGetProperty(property, out var list) && list.ValueKind == JsonValueKind.Array
                ? [.. list.EnumerateArray()
                    .Where(entry => entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String)
                    .Select(entry => entry.GetProperty("name").GetString()!)]
                : [];
    }

    private static CheckResult Result(string group, string label, bool ok, string failure) =>
        ok ? new CheckResult(group, label, true) : new CheckResult(group, label, false, failure);

    [GeneratedRegex(@"export\s*\{([^}]*)\}")]
    private static partial Regex ExportListRegex();

    [GeneratedRegex(@"\s+as\s+")]
    private static partial Regex AsRegex();

    [GeneratedRegex(@"export\s+(?:async\s+)?(?:class|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)")]
    private static partial Regex ExportDeclarationRegex();

    [GeneratedRegex("""export\s*\*\s*from\s*["']([^"']+)["']""")]
    private static partial Regex ReexportRegex();

    [LoggerMessage(Level = LogLevel.Information, Message = "Live compatibility check: {Failures} failure(s) out of {Total}")]
    private partial void LogLive(int failures, int total);

    [LoggerMessage(Level = LogLevel.Information, Message = "Offline compatibility check: {Failures} failure(s) out of {Total} in {FsBaseUi}")]
    private partial void LogOffline(int failures, int total, string fsBaseUi);
}
