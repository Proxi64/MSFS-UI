using System.Text.Json;
using System.Text.Json.Serialization;

namespace MsfsUi.Core.Coherent;

/// <summary>A page of the sim's UI that the Coherent inspector can attach to.</summary>
/// <param name="Id">Page id (numeric for Coherent GT, as text here).</param>
/// <param name="Title">Page title (the main menu is <c>mainUi</c>).</param>
/// <param name="Url">Page URL (<c>coui://html_UI/Global/mainUI.html</c> for the main menu).</param>
/// <param name="WebSocketDebuggerUrl">WebSocket address of the page, when the inspector gives it.</param>
public sealed record InspectorPage(string Id, string Title, string Url, string? WebSocketDebuggerUrl);

/// <summary>Outcome of an evaluation in a page.</summary>
/// <param name="Ok">The expression (or its promise) succeeded.</param>
/// <param name="Value">Its value, as JSON (absent for <c>undefined</c>).</param>
/// <param name="Error">What went wrong, when it failed.</param>
public sealed record EvalResult(bool Ok, JsonElement? Value, string? Error)
{
    /// <summary>A failure with this message.</summary>
    public static EvalResult Failure(string error) => new(false, null, error);
}

/// <summary>Settings of the Coherent inspector client.</summary>
public sealed record CoherentInspectorOptions
{
    /// <summary>Host and port of the inspector the sim exposes while it runs.</summary>
    public string Host { get; init; } = "127.0.0.1:19999";

    /// <summary>How long an evaluation may wait for its promise.</summary>
    public TimeSpan EvaluationTimeout { get; init; } = TimeSpan.FromSeconds(10);

    /// <summary>How often the result of an evaluation is polled.</summary>
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromMilliseconds(100);

    /// <summary>Console reading stops this long after the last message received.</summary>
    public TimeSpan ConsoleSettle { get; init; } = TimeSpan.FromMilliseconds(800);

    /// <summary>Console reading stops after this long in any case (a page that keeps logging).</summary>
    public TimeSpan ConsoleMaxDuration { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// How long one protocol request may wait for its answer. A page that never answers (frozen sim, a program
    /// that blocks) must not freeze the app.
    /// </summary>
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(15);
}

/// <summary>The inspector does not answer: the sim is not running, or its main menu is not displayed yet.</summary>
public sealed class InspectorUnavailableException : MsfsUiException
{
    /// <summary>Creates the exception.</summary>
    public InspectorUnavailableException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with its cause.</summary>
    public InspectorUnavailableException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>Creates the exception without a message.</summary>
    public InspectorUnavailableException()
    {
    }
}

/// <summary>Stored outcome read back from the page (<see cref="PagePrograms.ReadResult"/>).</summary>
internal sealed record StoredResult(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("value")] JsonElement? Value,
    [property: JsonPropertyName("error")] string? Error);

[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(StoredResult))]
internal sealed partial class CoherentJsonContext : JsonSerializerContext;
