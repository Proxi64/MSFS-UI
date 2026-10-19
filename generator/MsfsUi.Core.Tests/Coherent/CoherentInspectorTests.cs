using System.Text.Json;
using Jint;
using Microsoft.Extensions.Logging.Abstractions;
using MsfsUi.Core.Coherent;
using MsfsUi.Core.Tests.TestSupport;

namespace MsfsUi.Core.Tests.Coherent;

[TestClass]
public sealed class CoherentInspectorTests
{
    public TestContext TestContext { get; set; } = null!;

    internal static CoherentInspector Inspector(string host, TimeSpan? evaluationTimeout = null, TimeSpan? requestTimeout = null, TimeSpan? consoleMaxDuration = null) => new(
        new HttpClient { Timeout = TimeSpan.FromSeconds(5) },
        new CoherentInspectorOptions
        {
            Host = host,
            EvaluationTimeout = evaluationTimeout ?? TimeSpan.FromSeconds(5),
            PollInterval = TimeSpan.FromMilliseconds(20),
            ConsoleSettle = TimeSpan.FromMilliseconds(300),
            RequestTimeout = requestTimeout ?? TimeSpan.FromSeconds(10),
            ConsoleMaxDuration = consoleMaxDuration ?? TimeSpan.FromSeconds(5),
        },
        TimeProvider.System,
        NullLogger<CoherentInspector>.Instance);

    [TestMethod]
    public async Task ListsPagesFromPageListJson()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page);

        var pages = await Inspector(server.Host).ListPagesAsync(TestContext.CancellationToken);

        Assert.HasCount(2, pages);
        Assert.AreEqual(new InspectorPage("2", "mainUi", "coui://html_UI/Global/mainUI.html", $"ws://{server.Host}/devtools/page/2"), pages[0]);
        Assert.IsNull(pages[1].WebSocketDebuggerUrl);
    }

    [TestMethod]
    public async Task FallsBackToChromeStylePageLists()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page, chromeStylePageList: true);

        var found = await Inspector(server.Host).FindPageAsync("mainUi", TestContext.CancellationToken);

        Assert.AreEqual("2", found.Id);
    }

    [TestMethod]
    public void MatchesByTitleThenFileNameThenSubstring()
    {
        InspectorPage[] pages =
        [
            new("1", "Toolbar", "coui://html_UI/Global/Panel.html", null),
            new("2", "Main", "coui://html_UI/Global/mainUI.html", null),
            new("3", "notifications", "coui://html_UI/Global/notifications.html?type=POPUP", null),
        ];

        Assert.AreEqual("1", CoherentInspector.MatchPage(pages, "toolbar")!.Id, "title, any case");
        Assert.AreEqual("2", CoherentInspector.MatchPage(pages, "mainUi")!.Id, "HTML file name");
        Assert.AreEqual("3", CoherentInspector.MatchPage(pages, "POPUP")!.Id, "part of the URL");
        Assert.IsNull(CoherentInspector.MatchPage(pages, "atlas"));
    }

    [TestMethod]
    public async Task EvaluatesValuesPromisesAndUndefined()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page);
        var inspector = Inspector(server.Host);

        var number = await inspector.EvaluateAsync("1 + 2;", cancellationToken: TestContext.CancellationToken);
        var promise = await inspector.EvaluateAsync("Promise.resolve({ a: [1, 'x'] }).then((v) => v)", cancellationToken: TestContext.CancellationToken);
        var undefinedValue = await inspector.EvaluateAsync("undefined", cancellationToken: TestContext.CancellationToken);
        var commented = await inspector.EvaluateAsync("(() => 'ok')()\n// final comment", cancellationToken: TestContext.CancellationToken);

        Assert.IsTrue(number.Ok);
        Assert.AreEqual(3, number.Value!.Value.GetInt32());
        Assert.AreEqual("""{"a":[1,"x"]}""", JsonSerializer.Serialize(promise.Value));
        Assert.IsTrue(undefinedValue.Ok);
        Assert.IsNull(undefinedValue.Value, "undefined has no JSON value");
        Assert.AreEqual("ok", commented.Value!.Value.GetString());
    }

    [TestMethod]
    public async Task ReportsRejectionsSyntaxErrorsAndTimeouts()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page);
        var inspector = Inspector(server.Host, evaluationTimeout: TimeSpan.FromMilliseconds(300));

        var rejected = await inspector.EvaluateAsync("Promise.reject(new TypeError('boom'))", cancellationToken: TestContext.CancellationToken);
        var syntax = await inspector.EvaluateAsync("const x = ;", cancellationToken: TestContext.CancellationToken);
        var never = await inspector.EvaluateAsync("new Promise(() => {})", cancellationToken: TestContext.CancellationToken);

        Assert.IsFalse(rejected.Ok);
        StringAssert.StartsWith(rejected.Error, "TypeError: boom");
        Assert.IsFalse(syntax.Ok);
        StringAssert.StartsWith(syntax.Error, "Exception: ");
        Assert.IsFalse(never.Ok);
        StringAssert.Contains(never.Error, "Timed out");
    }

    [TestMethod]
    public async Task ReadsTheConsoleLines()
    {
        using var page = new FakeCoherentPage();
        page.Console.Add(("log", "[msfs-ui] module loaded"));
        page.Console.Add(("error", "[msfs-ui] something failed"));
        await using var server = new FakeInspectorServer(page);

        var lines = await Inspector(server.Host).ReadConsoleAsync(cancellationToken: TestContext.CancellationToken);

        CollectionAssert.AreEqual(ExpectedConsole, lines.ToArray());
    }

    private static readonly string[] ExpectedConsole = ["[log] [msfs-ui] module loaded", "[error] [msfs-ui] something failed"];

    [TestMethod]
    public async Task AFrozenPageDoesNotFreezeTheApp()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page) { Unresponsive = true };

        var error = await Assert.ThrowsExactlyAsync<InspectorUnavailableException>(() => Inspector(server.Host, requestTimeout: TimeSpan.FromMilliseconds(300)).EvaluateAsync("1", cancellationToken: TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "did not answer");
    }

    [TestMethod]
    public async Task ASimThatIsNotRunningGivesAClearError()
    {
        var inspector = Inspector($"127.0.0.1:{FakeInspectorServer.FreePort()}");

        var error = await Assert.ThrowsExactlyAsync<InspectorUnavailableException>(() => inspector.EvaluateAsync("1", cancellationToken: TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "the sim is not running");
    }

    [TestMethod]
    public async Task MalformedOrUnexpectedFramesFromTheInspectorAreIgnored()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page) { SendNoise = true };

        var result = await Inspector(server.Host).EvaluateAsync("'still fine'", cancellationToken: TestContext.CancellationToken);

        Assert.AreEqual("still fine", result.Value!.Value.GetString());
    }

    [TestMethod]
    public async Task ConnectionsEndWithANormalCloseHandshake()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page);

        await Inspector(server.Host).EvaluateAsync("1", cancellationToken: TestContext.CancellationToken);
        await Task.Delay(200, TestContext.CancellationToken);

        Assert.IsTrue(server.NormalCloseReceived);
    }

    [TestMethod]
    public async Task ARequestAfterTheSimClosedTheConnectionFailsAtOnce()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page) { CloseAfterFirstAnswer = true };
        var watch = System.Diagnostics.Stopwatch.StartNew();

        var error = await Assert.ThrowsExactlyAsync<InspectorUnavailableException>(() => Inspector(server.Host, requestTimeout: TimeSpan.FromSeconds(10)).EvaluateAsync("new Promise((r) => r(1))", cancellationToken: TestContext.CancellationToken));

        StringAssert.Contains(error.Message, "closed");
        Assert.IsLessThan(TimeSpan.FromSeconds(5), watch.Elapsed, "no wait for the request timeout");
    }

    [TestMethod]
    public async Task ConsoleReadingIsCappedForAPageThatKeepsLogging()
    {
        using var page = new FakeCoherentPage();
        await using var server = new FakeInspectorServer(page) { ChattyConsole = true };
        var watch = System.Diagnostics.Stopwatch.StartNew();

        var lines = await Inspector(server.Host, consoleMaxDuration: TimeSpan.FromMilliseconds(600)).ReadConsoleAsync(cancellationToken: TestContext.CancellationToken);

        Assert.IsLessThan(TimeSpan.FromSeconds(4), watch.Elapsed);
        Assert.IsNotEmpty(lines);
    }

    [TestMethod]
    public void OverlappingEvaluationsKeepTheirOwnResults()
    {
        using var page = new FakeCoherentPage();
        page.Evaluate("var releaseA; var a = new Promise((r) => { releaseA = r; });");

        page.Evaluate(PagePrograms.Evaluate("a", "A"));
        page.Evaluate(PagePrograms.Evaluate("'b'", "B"));
        Assert.IsTrue(page.Evaluate(PagePrograms.ReadResult("A")).Value!.IsNull(), "A is still pending");
        page.Evaluate("releaseA('a')");

        Assert.AreEqual("a", ValueOf(page.Evaluate(PagePrograms.ReadResult("A")).Value!.AsString()));
        Assert.AreEqual("b", ValueOf(page.Evaluate(PagePrograms.ReadResult("B")).Value!.AsString()));
        Assert.IsTrue(page.Evaluate(PagePrograms.ReadResult("B")).Value!.IsNull(), "a result is read once, then its slot is freed");
    }

    private static string? ValueOf(string storedJson)
    {
        using var stored = JsonDocument.Parse(storedJson);
        return stored.RootElement.GetProperty("value").GetString();
    }

    [TestMethod]
    public void AnAbandonedEvaluationDiscardsItsLateResult()
    {
        using var page = new FakeCoherentPage();
        page.Evaluate("var release; var p = new Promise((r) => { release = r; });");

        page.Evaluate(PagePrograms.Evaluate("p", "T"));
        page.Evaluate(PagePrograms.ForgetResult("T"));
        page.Evaluate("release(1)");

        Assert.AreEqual("[]", page.Evaluate($"JSON.stringify(Object.keys(window.{PagePrograms.ResultVariable}))").Value!.AsString());
    }

    [TestMethod]
    public void AThrownValueWithoutDescriptionIsStillAnError()
    {
        using var noDescription = JsonDocument.Parse("""{ "wasThrown": true, "result": { "description": null } }""");
        using var numeric = JsonDocument.Parse("""{ "wasThrown": true, "result": { "description": 42 } }""");

        Assert.AreEqual("error", CoherentInspector.RuntimeException(noDescription.RootElement));
        Assert.AreEqual("42", CoherentInspector.RuntimeException(numeric.RootElement));
    }

    [TestMethod]
    public void FormatsWebKitAndChromeConsoleEvents()
    {
        using var webKit = JsonDocument.Parse("""{ "message": { "level": "warning", "text": "careful" } }""");
        using var chrome = JsonDocument.Parse("""{ "type": "log", "args": [ { "value": "a" }, { "value": 2 }, { "description": "Object" } ] }""");

        Assert.AreEqual("[warning] careful", CoherentInspector.FormatConsoleEvent("Console.messageAdded", webKit.RootElement));
        Assert.AreEqual("[log] a 2 Object", CoherentInspector.FormatConsoleEvent("Runtime.consoleAPICalled", chrome.RootElement));
        Assert.IsNull(CoherentInspector.FormatConsoleEvent("Page.loadEventFired", webKit.RootElement));
    }

    [TestMethod]
    public void ReadsRuntimeExceptionsInBothForms()
    {
        using var webKit = JsonDocument.Parse("""{ "wasThrown": true, "result": { "description": "SyntaxError: x" } }""");
        using var chrome = JsonDocument.Parse("""{ "exceptionDetails": { "text": "Uncaught", "exception": { "description": "ReferenceError: y" } } }""");
        using var fine = JsonDocument.Parse("""{ "result": { "type": "string", "value": "pending" } }""");

        Assert.AreEqual("SyntaxError: x", CoherentInspector.RuntimeException(webKit.RootElement));
        Assert.AreEqual("ReferenceError: y", CoherentInspector.RuntimeException(chrome.RootElement));
        Assert.IsNull(CoherentInspector.RuntimeException(fine.RootElement));
    }

    [TestMethod]
    public void JsLiteralEscapesLineSeparatorsForOldEngines()
    {
        var lineSeparator = (char)0x2028;
        var literal = PagePrograms.JsLiteral($"a{lineSeparator}b\"c");

        Assert.IsFalse(literal.Contains(lineSeparator, StringComparison.Ordinal));
        using var page = new FakeCoherentPage();
        Assert.AreEqual($"a{lineSeparator}b\"c", page.Evaluate(literal).Value!.AsString());
    }

    [TestMethod]
    public void PrepareExpressionRemovesTrailingSemicolons()
    {
        Assert.AreEqual("f()", PagePrograms.PrepareExpression("  f();; \r\n"));
    }
}
