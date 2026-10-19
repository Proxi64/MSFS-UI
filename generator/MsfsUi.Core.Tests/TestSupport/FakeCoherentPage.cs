using Jint;
using Jint.Native;
using Jint.Runtime;

namespace MsfsUi.Core.Tests.TestSupport;

/// <summary>
/// A page of the sim's UI played by the Jint interpreter: a <c>window</c> with the sim's <c>datastorage</c>
/// contract and a loaded mod (<c>window.__msfsUiRuntime</c>), so the programs the app sends really run.
/// </summary>
internal sealed class FakeCoherentPage : IDisposable
{
    private readonly Engine _engine;
    private readonly Lock _gate = new();

    public FakeCoherentPage(IReadOnlyDictionary<string, string>? storage = null)
    {
        _engine = new Engine(options => options.TimeoutInterval(TimeSpan.FromSeconds(5)));
        _engine.Execute("""
            var window = globalThis;
            window.top = window;
            var __storage = {};
            var __calls = [];
            var __unloads = 0;
            window.datastorage = {
              getData: function (key) { return __storage[key]; },
              setData: function (key, value) { __calls.push('set ' + key); __storage[key] = value; },
              deleteData: function (key) { __calls.push('delete ' + key); delete __storage[key]; },
              searchData: function (prefix) {
                return Object.keys(__storage).filter(function (k) { return k.indexOf(prefix) === 0; })
                  .map(function (k) { return { key: k, data: __storage[k] }; });
              }
            };
            window.__msfsUiRuntime = { unload: function () { __unloads++; } };
            // The sim's modules do not exist here: every dynamic import is rejected (see Evaluate).
            function __fakeImport(specifier) { return Promise.reject(new Error('Cannot import ' + specifier + ' in the fake page')); }
            """);
        foreach (var (key, value) in storage ?? new Dictionary<string, string>())
        {
            _engine.Execute($"__storage[{Js(key)}] = {Js(value)};");
        }
    }

    /// <summary>When set, the hot reload of the mod fails like a missing module.</summary>
    public bool ReloadFails { get; set; }

    /// <summary>How many times the mod was hot-reloaded.</summary>
    public int Reloads { get; private set; }

    /// <summary>Console messages replayed by the fake inspector when the console is enabled.</summary>
    public List<(string Level, string Text)> Console { get; } = [];

    /// <summary>Storage content.</summary>
    public Dictionary<string, string> Storage
    {
        get
        {
            lock (_gate)
            {
                var json = _engine.Evaluate("JSON.stringify(__storage)").AsString();
                return System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(json)!;
            }
        }
    }

    /// <summary>Storage calls, in order (<c>set KEY</c>, <c>delete KEY</c>).</summary>
    public List<string> Calls
    {
        get
        {
            lock (_gate)
            {
                return [.. _engine.Evaluate("__calls.join('\\n')").AsString().Split('\n', StringSplitOptions.RemoveEmptyEntries)];
            }
        }
    }

    /// <summary>How many times the mod was unloaded.</summary>
    public int Unloads
    {
        get
        {
            lock (_gate)
            {
                return (int)_engine.Evaluate("__unloads").AsNumber();
            }
        }
    }

    /// <summary>
    /// Runs a program like <c>Runtime.evaluate</c>: pending promise jobs run before returning. A JavaScript
    /// error is returned as the inspector's <c>wasThrown</c> description.
    /// </summary>
    public (JsValue? Value, string? Thrown) Evaluate(string program)
    {
        lock (_gate)
        {
            // Module loading is the sim's job: the reload of the mod is simulated.
            if (program.Contains(MsfsUi.Core.Coherent.PagePrograms.ReloadMod, StringComparison.Ordinal))
            {
                Reloads++;
                program = program.Replace(
                    MsfsUi.Core.Coherent.PagePrograms.ReloadMod,
                    ReloadFails ? "Promise.reject(new Error('module not found'))" : "Promise.resolve('mod reloaded')",
                    StringComparison.Ordinal);
            }

            // Jint never settles an import() of a module it cannot load: other imports are rejected at once.
            program = program.Replace("import(", "__fakeImport(", StringComparison.Ordinal);

            try
            {
                var value = _engine.Evaluate(program);
                _engine.Advanced.ProcessTasks();
                return (value, null);
            }
            catch (JavaScriptException ex)
            {
                return (null, ex.Error.ToString());
            }
            catch (Acornima.ParseErrorException ex)
            {
                return (null, $"SyntaxError: {ex.Message}");
            }
        }
    }

    /// <summary>Whether the program parses as a script (syntax check only).</summary>
    public static bool Parses(string program, out string? error)
    {
        try
        {
            Engine.PrepareScript(program);
            error = null;
            return true;
        }
        catch (Exception ex) when (ex is Acornima.ParseErrorException)
        {
            error = ex.Message;
            return false;
        }
    }

    public void Dispose() => _engine.Dispose();

    private static string Js(string value) => System.Text.Json.JsonSerializer.Serialize(value);
}
