using System.Buffers;
using System.Collections.Concurrent;
using System.Globalization;
using System.Net.WebSockets;
using System.Text.Json;

namespace MsfsUi.Core.Coherent;

/// <summary>
/// One WebSocket connection to a page, speaking the inspector protocol: numbered requests answered by
/// <c>id</c>, and events (<c>method</c> without <c>id</c>). A malformed message from the inspector is ignored; it
/// never ends the connection.
/// </summary>
internal sealed class InspectorConnection : IAsyncDisposable
{
    private static readonly TimeSpan CloseTimeout = TimeSpan.FromSeconds(1);

    private readonly ClientWebSocket _socket;
    private readonly TimeSpan _requestTimeout;
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly CancellationTokenSource _receiving = new();
    private readonly SemaphoreSlim _sending = new(1, 1);
    private readonly Task _receiveLoop;
    private int _nextId;
    private volatile bool _closed;

    private InspectorConnection(ClientWebSocket socket, TimeSpan requestTimeout)
    {
        _socket = socket;
        _requestTimeout = requestTimeout;
        _receiveLoop = Task.Run(ReceiveLoopAsync);
    }

    /// <summary>Raised for every protocol event (method name, parameters). Exceptions of handlers are ignored.</summary>
    public event Action<string, JsonElement>? EventReceived;

    public static async Task<InspectorConnection> OpenAsync(Uri address, TimeSpan requestTimeout, CancellationToken cancellationToken)
    {
        var socket = new ClientWebSocket();
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(requestTimeout);
            await socket.ConnectAsync(address, timeout.Token).ConfigureAwait(false);
            return new InspectorConnection(socket, requestTimeout);
        }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            socket.Dispose();
            throw new InspectorUnavailableException($"The Coherent inspector at {address} did not accept the connection in time.", ex);
        }
        catch (Exception ex) when (ex is WebSocketException or HttpRequestException)
        {
            socket.Dispose();
            throw new InspectorUnavailableException($"Cannot connect to the Coherent inspector at {address}: {ex.Message}", ex);
        }
    }

    /// <summary>Sends a request and returns its <c>result</c>.</summary>
    /// <exception cref="InspectorUnavailableException">The connection is closed, the inspector refused the request, or it did not answer in time.</exception>
    public async Task<JsonElement> SendAsync(string method, Action<Utf8JsonWriter>? writeParams, CancellationToken cancellationToken)
    {
        var id = Interlocked.Increment(ref _nextId);
        var answer = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = answer;
        try
        {
            // Checked after registering: the receive loop sets the flag before failing pending requests, so a
            // request is either failed by the loop or refused here, never left waiting.
            if (_closed)
            {
                throw new InspectorUnavailableException("The connection to the Coherent inspector was closed.");
            }

            var buffer = new ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(buffer))
            {
                writer.WriteStartObject();
                writer.WriteNumber("id", id);
                writer.WriteString("method", method);
                writer.WriteStartObject("params");
                writeParams?.Invoke(writer);
                writer.WriteEndObject();
                writer.WriteEndObject();
            }

            await _sending.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await _socket.SendAsync(buffer.WrittenMemory, WebSocketMessageType.Text, endOfMessage: true, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is WebSocketException or ObjectDisposedException)
            {
                throw new InspectorUnavailableException($"The connection to the Coherent inspector was lost: {ex.Message}", ex);
            }
            finally
            {
                _sending.Release();
            }

            try
            {
                return await answer.Task.WaitAsync(_requestTimeout, cancellationToken).ConfigureAwait(false);
            }
            catch (TimeoutException ex)
            {
                throw new InspectorUnavailableException(
                    string.Create(CultureInfo.InvariantCulture, $"The sim did not answer '{method}' within {_requestTimeout.TotalSeconds:0.#} s: its UI may be frozen."),
                    ex);
            }
        }
        finally
        {
            _pending.TryRemove(id, out _);
        }
    }

    /// <summary>Closes the connection with a normal close handshake, then stops receiving.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_socket.State == WebSocketState.Open)
        {
            try
            {
                using var timeout = new CancellationTokenSource(CloseTimeout);
                await _socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, timeout.Token).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException)
            {
                // Closing is best effort.
            }
        }

        // Give the inspector a moment to acknowledge the close; then stop the loop if it is still waiting.
        if (await Task.WhenAny(_receiveLoop, Task.Delay(CloseTimeout)).ConfigureAwait(false) != _receiveLoop)
        {
            await _receiving.CancelAsync().ConfigureAwait(false);
        }

        await _receiveLoop.ConfigureAwait(false);
        _socket.Dispose();
        _receiving.Dispose();
        _sending.Dispose();
    }

    private async Task ReceiveLoopAsync()
    {
        var message = new ArrayBufferWriter<byte>();
        try
        {
            while (_socket.State is WebSocketState.Open or WebSocketState.CloseSent && !_receiving.IsCancellationRequested)
            {
                var result = await _socket.ReceiveAsync(message.GetMemory(16 * 1024), _receiving.Token).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }

                message.Advance(result.Count);
                if (!result.EndOfMessage)
                {
                    continue;
                }

                Dispatch(message.WrittenMemory);
                message.Clear();
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            // The connection ended; pending requests fail below.
        }
        finally
        {
            _closed = true;
            foreach (var waiting in _pending.Values)
            {
                waiting.TrySetException(new InspectorUnavailableException("The connection to the Coherent inspector was closed."));
            }
        }
    }

    private void Dispatch(ReadOnlyMemory<byte> data)
    {
        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(data);
            root = document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return;
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (root.TryGetProperty("id", out var idElement) && idElement.ValueKind == JsonValueKind.Number && idElement.TryGetInt32(out var id))
        {
            if (!_pending.TryGetValue(id, out var waiting))
            {
                return;
            }

            if (root.TryGetProperty("error", out var error))
            {
                var text = JsonReading.Text(error, "message") ?? error.ToString();
                waiting.TrySetException(new InspectorUnavailableException($"The inspector refused the request: {text}"));
            }
            else
            {
                waiting.TrySetResult(root.TryGetProperty("result", out var result) ? result : default);
            }
        }
        else if (JsonReading.Text(root, "method") is { } name)
        {
            try
            {
                EventReceived?.Invoke(name, root.TryGetProperty("params", out var parameters) ? parameters : default);
            }
            catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException or FormatException)
            {
                // An event handler choked on an unexpected shape: the event is dropped, the connection lives on.
            }
        }
    }
}

/// <summary>Tolerant reading of JSON coming from the sim: wrong shapes give null instead of throwing.</summary>
internal static class JsonReading
{
    /// <summary>A property as text: strings as is, other values as JSON, missing or null as null.</summary>
    public static string? Text(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => value.ToString(),
        };
    }

    /// <summary>A child object, or null.</summary>
    public static JsonElement? Object(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : null;
}
