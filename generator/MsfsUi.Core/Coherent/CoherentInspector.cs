using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace MsfsUi.Core.Coherent;

/// <summary>
/// Client of the inspector that MSFS 2024 exposes while it runs (Coherent GT, <c>127.0.0.1:19999</c>): lists the
/// UI pages, evaluates JavaScript in a page, reads its console and hot-reloads the mod.
/// </summary>
public sealed class CoherentInspector
{
    /// <summary>The main menu page, where the mod runs.</summary>
    public const string MainPage = "mainUi";

    /// <summary>Page lists tried in order: Coherent GT's own (verified on sim 1.9.18), then Chrome-style ones.</summary>
    private static readonly string[] PageListPaths = ["/pagelist.json", "/json/list", "/json"];

    private readonly HttpClient _http;
    private readonly CoherentInspectorOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger<CoherentInspector> _logger;

    /// <summary>Creates the client.</summary>
    public CoherentInspector(HttpClient http, CoherentInspectorOptions options, TimeProvider time, ILogger<CoherentInspector> logger)
    {
        _http = http;
        _options = options;
        _time = time;
        _logger = logger;
    }

    /// <summary>Pages the inspector can attach to.</summary>
    /// <exception cref="InspectorUnavailableException">The inspector does not answer.</exception>
    public async Task<IReadOnlyList<InspectorPage>> ListPagesAsync(CancellationToken cancellationToken = default)
    {
        Exception? lastError = null;
        foreach (var path in PageListPaths)
        {
            try
            {
                using var response = await _http.GetAsync(new Uri($"http://{_options.Host}{path}"), cancellationToken).ConfigureAwait(false);
                if (!response.IsSuccessStatusCode)
                {
                    continue;
                }

                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
                using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
                if (document.RootElement.ValueKind == JsonValueKind.Array)
                {
                    return [.. document.RootElement.EnumerateArray().Where(page => page.ValueKind == JsonValueKind.Object).Select(ReadPage)];
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or JsonException || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
            {
                lastError = ex;
            }
        }

        throw new InspectorUnavailableException(
            $"The Coherent inspector does not answer at {_options.Host}: the sim is not running, or its main menu is not displayed yet.",
            lastError ?? new InvalidOperationException("No page list."));
    }

    /// <summary>
    /// A page by its title, then by the name of its HTML file (<c>mainUi</c> matches <c>…/mainUI.html</c>), then
    /// by a part of its title or URL; case-insensitive.
    /// </summary>
    public static InspectorPage? MatchPage(IEnumerable<InspectorPage> pages, string name)
    {
        ArgumentNullException.ThrowIfNull(pages);
        ArgumentNullException.ThrowIfNull(name);
        var list = pages.ToList();
        var file = new Regex($@"[/\\]{Regex.Escape(name)}\.html", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
        return list.FirstOrDefault(page => string.Equals(page.Title, name, StringComparison.OrdinalIgnoreCase))
            ?? list.FirstOrDefault(page => file.IsMatch(page.Url))
            ?? list.FirstOrDefault(page => $"{page.Title} {page.Url}".Contains(name, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The page with this name.</summary>
    /// <exception cref="InspectorUnavailableException">The inspector does not answer, or has no such page.</exception>
    public async Task<InspectorPage> FindPageAsync(string name, CancellationToken cancellationToken = default)
    {
        return MatchPage(await ListPagesAsync(cancellationToken).ConfigureAwait(false), name)
            ?? throw new InspectorUnavailableException($"The sim's UI has no page \"{name}\" (is the main menu displayed?).");
    }

    /// <summary>
    /// Opens one connection to a page for several requests (evaluations, console). Dispose it when done.
    /// </summary>
    /// <exception cref="InspectorUnavailableException">The inspector does not answer, or has no such page.</exception>
    public async Task<InspectorSession> OpenSessionAsync(string page = MainPage, CancellationToken cancellationToken = default)
    {
        var target = await FindPageAsync(page, cancellationToken).ConfigureAwait(false);
        var address = target.WebSocketDebuggerUrl is { Length: > 0 } url
            ? new Uri(url)
            : new Uri($"ws://{_options.Host}/devtools/page/{target.Id}");
        var connection = await InspectorConnection.OpenAsync(address, _options.RequestTimeout, cancellationToken).ConfigureAwait(false);
        return new InspectorSession(connection, _options, _time, _logger);
    }

    /// <summary>
    /// Evaluates one JavaScript expression in a page and returns its value; a promise is awaited up to
    /// <paramref name="timeout"/> (default <see cref="CoherentInspectorOptions.EvaluationTimeout"/>).
    /// </summary>
    /// <exception cref="InspectorUnavailableException">The inspector does not answer.</exception>
    public async Task<EvalResult> EvaluateAsync(string expression, string page = MainPage, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
        await using var session = await OpenSessionAsync(page, cancellationToken).ConfigureAwait(false);
        return await session.EvaluateAsync(expression, timeout, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Console messages already in the page, as <c>[level] text</c> lines (see <see cref="InspectorSession.ReadConsoleAsync"/>).</summary>
    /// <exception cref="InspectorUnavailableException">The inspector does not answer.</exception>
    public async Task<IReadOnlyList<string>> ReadConsoleAsync(string page = MainPage, CancellationToken cancellationToken = default)
    {
        await using var session = await OpenSessionAsync(page, cancellationToken).ConfigureAwait(false);
        return await session.ReadConsoleAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Hot-reloads the installed mod in the main menu.</summary>
    public Task<EvalResult> ReloadModAsync(CancellationToken cancellationToken = default) =>
        EvaluateAsync(PagePrograms.ReloadMod, MainPage, cancellationToken: cancellationToken);

    /// <summary><c>[level] text</c> for a console event (WebKit or Chrome form), or null for other events.</summary>
    public static string? FormatConsoleEvent(string method, JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (method == "Console.messageAdded" && JsonReading.Object(parameters, "message") is { } message)
        {
            return $"[{JsonReading.Text(message, "level") ?? "log"}] {JsonReading.Text(message, "text")}";
        }

        if (method == "Runtime.consoleAPICalled")
        {
            var args = parameters.TryGetProperty("args", out var a) && a.ValueKind == JsonValueKind.Array
                ? a.EnumerateArray().Select(arg => JsonReading.Text(arg, "value") ?? JsonReading.Text(arg, "description") ?? string.Empty)
                : [];
            return $"[{JsonReading.Text(parameters, "type") ?? "log"}] {string.Join(' ', args)}";
        }

        return null;
    }

    /// <summary>
    /// Description of the exception of a <c>Runtime.evaluate</c> answer (WebKit and Chrome forms), or null when
    /// the evaluation did not throw. A thrown value without description gives <c>error</c>.
    /// </summary>
    public static string? RuntimeException(JsonElement response)
    {
        if (response.ValueKind != JsonValueKind.Object)
        {
            return "empty answer";
        }

        if (JsonReading.Object(response, "exceptionDetails") is { } details)
        {
            return (JsonReading.Object(details, "exception") is { } exception ? JsonReading.Text(exception, "description") : null)
                ?? JsonReading.Text(details, "text")
                ?? "error";
        }

        if (response.TryGetProperty("wasThrown", out var thrown) && thrown.ValueKind == JsonValueKind.True)
        {
            var result = JsonReading.Object(response, "result");
            return (result is { } r ? JsonReading.Text(r, "description") ?? JsonReading.Text(r, "value") : null) ?? "error";
        }

        return null;
    }

    private static InspectorPage ReadPage(JsonElement page)
    {
        var socket = JsonReading.Text(page, "webSocketDebuggerUrl");
        return new InspectorPage(
            JsonReading.Text(page, "id") ?? string.Empty,
            JsonReading.Text(page, "title") ?? string.Empty,
            JsonReading.Text(page, "url") ?? string.Empty,
            string.IsNullOrEmpty(socket) ? null : socket);
    }
}

/// <summary>One connection to a page of the sim's UI, for several requests. Dispose it when done.</summary>
public sealed partial class InspectorSession : IAsyncDisposable
{
    private readonly InspectorConnection _connection;
    private readonly CoherentInspectorOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger _logger;

    internal InspectorSession(InspectorConnection connection, CoherentInspectorOptions options, TimeProvider time, ILogger logger)
    {
        _connection = connection;
        _options = options;
        _time = time;
        _logger = logger;
    }

    /// <summary>
    /// Evaluates one JavaScript expression and returns its value; a promise is awaited up to
    /// <paramref name="timeout"/> (default <see cref="CoherentInspectorOptions.EvaluationTimeout"/>).
    /// </summary>
    /// <exception cref="InspectorUnavailableException">The page does not answer.</exception>
    public async Task<EvalResult> EvaluateAsync(string expression, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(expression);
        var limit = timeout ?? _options.EvaluationTimeout;
        var token = $"{_time.GetUtcNow().ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}";
        var started = await SendEvaluateAsync(PagePrograms.Evaluate(PagePrograms.PrepareExpression(expression), token), cancellationToken).ConfigureAwait(false);
        if (CoherentInspector.RuntimeException(started) is { } thrown)
        {
            return EvalResult.Failure($"Exception: {thrown}");
        }

        var read = PagePrograms.ReadResult(token);
        var startedAt = _time.GetTimestamp();
        while (_time.GetElapsedTime(startedAt) < limit)
        {
            var response = await SendEvaluateAsync(read, cancellationToken).ConfigureAwait(false);
            if (JsonReading.Object(response, "result") is { } result
                && result.TryGetProperty("value", out var value)
                && value.ValueKind == JsonValueKind.String)
            {
                var stored = JsonSerializer.Deserialize(value.GetString()!, CoherentJsonContext.Default.StoredResult);
                return stored is null ? EvalResult.Failure("Unreadable result.") : new EvalResult(stored.Ok, stored.Value, stored.Error);
            }

            await Task.Delay(_options.PollInterval, _time, cancellationToken).ConfigureAwait(false);
        }

        await SendEvaluateAsync(PagePrograms.ForgetResult(token), cancellationToken).ConfigureAwait(false);
        LogTimeout(limit.TotalSeconds);
        return EvalResult.Failure(string.Create(CultureInfo.InvariantCulture, $"Timed out after {limit.TotalSeconds:0.#} s: the promise did not settle."));
    }

    /// <summary>
    /// Console messages already in the page (the inspector replays them when the console is enabled), as
    /// <c>[level] text</c> lines. Reading stops <see cref="CoherentInspectorOptions.ConsoleSettle"/> after the last
    /// message, and after <see cref="CoherentInspectorOptions.ConsoleMaxDuration"/> in any case.
    /// </summary>
    public async Task<IReadOnlyList<string>> ReadConsoleAsync(CancellationToken cancellationToken = default)
    {
        var lines = new List<string>();
        var started = _time.GetTimestamp();
        var lastMessage = started;
        void OnEvent(string method, JsonElement parameters)
        {
            var line = CoherentInspector.FormatConsoleEvent(method, parameters);
            if (line is null)
            {
                return;
            }

            lock (lines)
            {
                lines.Add(line);
                lastMessage = _time.GetTimestamp();
            }
        }

        _connection.EventReceived += OnEvent;
        try
        {
            try
            {
                await _connection.SendAsync("Console.enable", null, cancellationToken).ConfigureAwait(false);
            }
            catch (InspectorUnavailableException)
            {
                await _connection.SendAsync("Runtime.enable", null, cancellationToken).ConfigureAwait(false);
            }

            while (_time.GetElapsedTime(started) < _options.ConsoleMaxDuration)
            {
                long last;
                lock (lines)
                {
                    last = lastMessage;
                }

                if (_time.GetElapsedTime(last) >= _options.ConsoleSettle)
                {
                    break;
                }

                await Task.Delay(_options.PollInterval, _time, cancellationToken).ConfigureAwait(false);
            }
        }
        finally
        {
            _connection.EventReceived -= OnEvent;
        }

        lock (lines)
        {
            return [.. lines];
        }
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync() => _connection.DisposeAsync();

    private Task<JsonElement> SendEvaluateAsync(string expression, CancellationToken cancellationToken) =>
        _connection.SendAsync(
            "Runtime.evaluate",
            writer =>
            {
                writer.WriteString("expression", expression);
                writer.WriteBoolean("returnByValue", true);
            },
            cancellationToken);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Evaluation in the sim timed out after {Seconds} s")]
    private partial void LogTimeout(double seconds);
}
