using System.Text.RegularExpressions;

namespace MsfsUi.Core.Compatibility;

/// <summary>
/// The names a module of the sim exports, read from its code (the compatibility check finds the readable exports the
/// mod imports there).
/// </summary>
public static partial class ModuleExports
{
    /// <summary>
    /// Names exported by a module of the sim: <c>export{a as B,C}</c> lists, <c>export class|function|const …</c>
    /// declarations, and <c>export*from"…"</c> re-exports, followed (absolute <c>/Global/…</c> or relative paths).
    /// </summary>
    public static HashSet<string> Of(IReadOnlyDictionary<string, string> scripts, string module)
    {
        ArgumentNullException.ThrowIfNull(scripts);
        return Of(scripts, module, new HashSet<string>(StringComparer.Ordinal));
    }

    private static HashSet<string> Of(IReadOnlyDictionary<string, string> scripts, string module, HashSet<string> seen)
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
            names.UnionWith(Of(scripts, resolved, seen));
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

    [GeneratedRegex(@"export\s*\{([^}]*)\}")]
    private static partial Regex ExportListRegex();

    [GeneratedRegex(@"\s+as\s+")]
    private static partial Regex AsRegex();

    [GeneratedRegex(@"export\s+(?:async\s+)?(?:class|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)")]
    private static partial Regex ExportDeclarationRegex();

    [GeneratedRegex("""export\s*\*\s*from\s*["']([^"']+)["']""")]
    private static partial Regex ReexportRegex();
}
