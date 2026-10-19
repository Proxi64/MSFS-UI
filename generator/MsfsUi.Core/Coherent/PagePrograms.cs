using System.Globalization;
using System.Text;
using System.Text.Json;

namespace MsfsUi.Core.Coherent;

/// <summary>
/// JavaScript programs sent to a page of the sim's UI through the Coherent inspector. They run in Coherent GT,
/// an old WebKit: the evaluation wrapper is ES5, and every value is embedded with <see cref="JsLiteral"/>.
/// </summary>
public static class PagePrograms
{
    /// <summary>
    /// Global variable of the page holding pending evaluation results, one slot per token, so evaluations that
    /// overlap (a status poll during a backup…) never overwrite each other.
    /// </summary>
    public const string ResultVariable = "__msfsUiEvalResults";

    /// <summary>Re-imports the installed mod (hot reload); the new version unloads the previous one by itself.</summary>
    public const string ReloadMod = "import('/msfs-ui/main.js?t=' + Date.now()).then(() => 'mod reloaded')";

    private static readonly char[] LineSeparators = [(char)0x2028, (char)0x2029];

    /// <summary>
    /// The text is wrapped in parentheses, so it must be a single expression. Trailing semicolons and spaces are
    /// removed; the wrapper puts it on its own lines, so a final <c>//</c> comment is allowed.
    /// </summary>
    public static string PrepareExpression(string source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return source.Trim().TrimEnd(';', ' ', '\t', '\r', '\n');
    }

    /// <summary>
    /// Evaluates <paramref name="expression"/> (a promise is awaited) and stores the outcome in
    /// <see cref="ResultVariable"/>, tagged with <paramref name="token"/>. The inspector ignores
    /// <c>awaitPromise</c>, so the result is read back by <see cref="ReadResult"/>.
    /// </summary>
    public static string Evaluate(string expression, string token)
    {
        ArgumentNullException.ThrowIfNull(expression);
        ArgumentNullException.ThrowIfNull(token);
        return $$"""
            (function () {
              var token = {{JsLiteral(token)}};
              var slots = window.{{ResultVariable}} || (window.{{ResultVariable}} = {});
              var done = function (result) {
                if (slots[token] && slots[token].abandoned) { delete slots[token]; return; }
                slots[token] = result;
              };
              slots[token] = { pending: true };
              var fail = function (e) {
                var text = e && e.message ? (e.name || 'Error') + ': ' + e.message + (e.stack ? '\n' + e.stack : '') : String(e);
                done({ ok: false, error: text });
              };
              try {
                Promise.resolve((
            {{expression}}
            )).then(function (value) { done({ ok: true, value: value }); }, fail);
              } catch (e) { fail(e); }
              return 'pending';
            })()
            """;
    }

    /// <summary>The stored outcome as a JSON string (its slot is then freed), or <c>null</c> while it is not ready.</summary>
    public static string ReadResult(string token)
    {
        ArgumentNullException.ThrowIfNull(token);
        return $$"""
            (function () {
              var slots = window.{{ResultVariable}};
              var token = {{JsLiteral(token)}};
              var r = slots && slots[token];
              if (!r || r.pending) return null;
              delete slots[token];
              try { return JSON.stringify(r); }
              catch (e) { return JSON.stringify({ ok: r.ok, value: String(r.value), error: r.error }); }
            })()
            """;
    }

    /// <summary>
    /// Abandons an evaluation (timeout): a result already stored is freed, a late one is discarded when it arrives.
    /// </summary>
    public static string ForgetResult(string token)
    {
        ArgumentNullException.ThrowIfNull(token);
        return $$"""
            (function () {
              var slots = window.{{ResultVariable}};
              if (!slots) return true;
              var token = {{JsLiteral(token)}};
              if (slots[token] && slots[token].pending) slots[token] = { abandoned: true };
              else delete slots[token];
              return true;
            })()
            """;
    }

    /// <summary>
    /// A string as a JavaScript literal. JSON escaping, plus U+2028 and U+2029, which are line terminators in a
    /// string before ES2019 (Coherent GT).
    /// </summary>
    public static string JsLiteral(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return EscapeLineSeparators(JsonSerializer.Serialize(value, CoherentJsonContext.Default.String));
    }

    /// <summary>A JSON text made safe to embed in a JavaScript program (U+2028 and U+2029 escaped).</summary>
    public static string EscapeLineSeparators(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        if (json.IndexOfAny(LineSeparators) < 0)
        {
            return json;
        }

        var builder = new StringBuilder(json.Length + 12);
        foreach (var c in json)
        {
            if (Array.IndexOf(LineSeparators, c) >= 0)
            {
                builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
            }
            else
            {
                builder.Append(c);
            }
        }

        return builder.ToString();
    }
}
