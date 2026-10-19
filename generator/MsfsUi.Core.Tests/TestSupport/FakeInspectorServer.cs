using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using Jint;
using System.Text.Json.Nodes;

namespace MsfsUi.Core.Tests.TestSupport;

/// <summary>
/// A local stand-in for the Coherent inspector of the sim: it lists one page (<c>mainUi</c>) and answers the
/// inspector protocol on its WebSocket, running every <c>Runtime.evaluate</c> in a <see cref="FakeCoherentPage"/>.
/// </summary>
internal sealed class FakeInspectorServer : IAsyncDisposable
{
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _stopping = new();
    private readonly Task _loop;

    public FakeInspectorServer(FakeCoherentPage page, bool chromeStylePageList = false)
    {
        Page = page;
        ChromeStylePageList = chromeStylePageList;
        Port = FreePort();
        _listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
        _listener.Start();
        _loop = Task.Run(AcceptLoopAsync);
    }

    public FakeCoherentPage Page { get; }

    /// <summary>Serve the page list on <c>/json/list</c> only (like Chrome), not on Coherent's <c>/pagelist.json</c>.</summary>
    public bool ChromeStylePageList { get; }

    public int Port { get; }

    /// <summary>When set, Runtime.evaluate is never answered (a frozen sim UI).</summary>
    public bool Unresponsive { get; set; }

    public string Host => $"127.0.0.1:{Port}";

    /// <summary>Methods received on the WebSocket, in order.</summary>
    public List<string> Methods { get; } = [];

    public async ValueTask DisposeAsync()
    {
        await _stopping.CancelAsync();
        _listener.Stop();
        _listener.Close();
        try
        {
            await _loop;
        }
        catch (Exception ex) when (ex is HttpListenerException or ObjectDisposedException or OperationCanceledException)
        {
            // Stopping.
        }

        _stopping.Dispose();
    }

    /// <summary>A port nobody listens on (for "sim closed" tests).</summary>
    public static int FreePort()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    private async Task AcceptLoopAsync()
    {
        while (!_stopping.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync();
            }
            catch (Exception ex) when (ex is HttpListenerException or ObjectDisposedException or InvalidOperationException)
            {
                return;
            }

            _ = Task.Run(() => HandleAsync(context));
        }
    }

    private async Task HandleAsync(HttpListenerContext context)
    {
        var path = context.Request.Url!.AbsolutePath;
        if (context.Request.IsWebSocketRequest && path == "/devtools/page/2")
        {
            var socket = (await context.AcceptWebSocketAsync(null)).WebSocket;
            await ServeSocketAsync(socket);
            return;
        }

        var listPath = ChromeStylePageList ? "/json/list" : "/pagelist.json";
        if (path == listPath)
        {
            var pages = new JsonArray(new JsonObject
            {
                ["id"] = 2,
                ["title"] = "mainUi",
                ["url"] = "coui://html_UI/Global/mainUI.html",
                ["webSocketDebuggerUrl"] = $"ws://{Host}/devtools/page/2",
            }, new JsonObject
            {
                ["id"] = 0,
                ["title"] = "atlas",
                ["url"] = "coui://html_UI/Global/atlas.html",
            });
            var body = Encoding.UTF8.GetBytes(pages.ToJsonString());
            context.Response.ContentType = "application/json";
            await context.Response.OutputStream.WriteAsync(body);
        }
        else
        {
            context.Response.StatusCode = 404;
        }

        context.Response.Close();
    }

    /// <summary>Send malformed and unexpected frames before every answer (the client must ignore them).</summary>
    public bool SendNoise { get; set; }

    /// <summary>Close the socket right after the first answer (the sim closing).</summary>
    public bool CloseAfterFirstAnswer { get; set; }

    /// <summary>After Console.enable, keep sending a console message every 50 ms (a page that keeps logging).</summary>
    public bool ChattyConsole { get; set; }

    /// <summary>Whether a client closed a socket with a normal close handshake.</summary>
    public bool NormalCloseReceived { get; private set; }

    private static readonly string[] NoiseFrames = ["not json", "[1, 2]", """{"method": 5}""", """{"id": "x", "result": {}}""", """{"method": "Console.messageAdded", "params": {"message": {"level": 3, "text": ["a"]}}}"""];

    private async Task ServeSocketAsync(WebSocket socket)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        var sending = new SemaphoreSlim(1, 1);
        var answers = 0;
        while (socket.State == WebSocketState.Open && !_stopping.IsCancellationRequested)
        {
            WebSocketReceiveResult received;
            try
            {
                received = await socket.ReceiveAsync(buffer, _stopping.Token);
            }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException)
            {
                return;
            }

            if (received.MessageType == WebSocketMessageType.Close)
            {
                NormalCloseReceived = received.CloseStatus == WebSocketCloseStatus.NormalClosure;
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                return;
            }

            message.Write(buffer, 0, received.Count);
            if (!received.EndOfMessage)
            {
                continue;
            }

            var request = JsonNode.Parse(message.ToArray())!.AsObject();
            message.SetLength(0);
            if (SendNoise)
            {
                foreach (var noise in NoiseFrames)
                {
                    await SendAsync(socket, sending, noise);
                }
            }

            foreach (var reply in Answer(request))
            {
                await SendAsync(socket, sending, reply.ToJsonString());
            }

            if (ChattyConsole && request["method"]!.GetValue<string>() == "Console.enable")
            {
                _ = Task.Run(async () =>
                {
                    for (var i = 0; socket.State == WebSocketState.Open && !_stopping.IsCancellationRequested; i++)
                    {
                        var line = new JsonObject { ["method"] = "Console.messageAdded", ["params"] = new JsonObject { ["message"] = new JsonObject { ["level"] = "log", ["text"] = $"tick {i}" } } };
                        try
                        {
                            await SendAsync(socket, sending, line.ToJsonString());
                            await Task.Delay(50);
                        }
                        catch (Exception ex) when (ex is WebSocketException or ObjectDisposedException)
                        {
                            return;
                        }
                    }
                });
            }

            if (CloseAfterFirstAnswer && ++answers == 1)
            {
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "sim closing", CancellationToken.None);
            }
        }
    }

    private static async Task SendAsync(WebSocket socket, SemaphoreSlim sending, string text)
    {
        await sending.WaitAsync();
        try
        {
            await socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);
        }
        finally
        {
            sending.Release();
        }
    }

    private IEnumerable<JsonObject> Answer(JsonObject request)
    {
        var id = request["id"]!.GetValue<int>();
        var method = request["method"]!.GetValue<string>();
        lock (Methods)
        {
            Methods.Add(method);
        }

        switch (method)
        {
            case "Runtime.evaluate" when Unresponsive:
                yield break;
            case "Runtime.evaluate":
                var (value, thrown) = Page.Evaluate(request["params"]!["expression"]!.GetValue<string>());
                if (thrown is not null)
                {
                    yield return new JsonObject { ["id"] = id, ["result"] = new JsonObject { ["wasThrown"] = true, ["result"] = new JsonObject { ["description"] = thrown } } };
                }
                else if (value is not null && value.IsString())
                {
                    yield return new JsonObject { ["id"] = id, ["result"] = new JsonObject { ["result"] = new JsonObject { ["type"] = "string", ["value"] = value.AsString() } } };
                }
                else
                {
                    yield return new JsonObject { ["id"] = id, ["result"] = new JsonObject { ["result"] = new JsonObject { ["type"] = "object", ["subtype"] = "null", ["value"] = null } } };
                }

                break;
            case "Console.enable":
                foreach (var (level, text) in Page.Console)
                {
                    yield return new JsonObject { ["method"] = "Console.messageAdded", ["params"] = new JsonObject { ["message"] = new JsonObject { ["level"] = level, ["text"] = text } } };
                }

                yield return new JsonObject { ["id"] = id, ["result"] = new JsonObject() };
                break;
            default:
                yield return new JsonObject { ["id"] = id, ["error"] = new JsonObject { ["message"] = $"'{method}' wasn't found" } };
                break;
        }
    }
}
