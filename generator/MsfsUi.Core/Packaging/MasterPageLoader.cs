using System.Text.RegularExpressions;

namespace MsfsUi.Core.Packaging;

/// <summary>
/// Inserts the mod loader into the sim's MasterPage component.
/// </summary>
/// <remarks>
/// The HTML of a component is injected without running its <c>&lt;script&gt;</c> tags, so an invisible image
/// creates the module when it loads: once per page (<c>window.__msfsUi</c>) and only in <c>mainUi.html</c>.
/// The loader text is byte-identical to the one of MSFS-UI 0.3.0, so packages from both generations behave the
/// same in the sim.
/// </remarks>
public static partial class MasterPageLoader
{
    /// <summary>The loader inserted before the last closing tag.</summary>
    public const string Loader =
        "<img data-msfs-ui=\"loader\" src=\"/msfs-ui/px.gif\" "
        + "style=\"position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;\" "
        + "onload=\"this.onload=null;if(/mainui\\.html/i.test(location.href)&&!window.__msfsUi){"
        + "window.__msfsUi=1;var s=document.createElement('script');s.type='module';"
        + "s.src='/msfs-ui/main.js';document.head.appendChild(s)}\">";

    private const string OpenTag = "<ui-resource-element";
    private const string CloseTag = "</ui-resource-element>";

    /// <summary>Byte order mark, written by its code point: never put this invisible character raw in the source.</summary>
    private const char ByteOrderMark = (char)0xFEFF;

    /// <summary>
    /// Returns the component with the loader inserted before its last closing tag, after checking that the
    /// component has the expected shape: one line of nested <c>&lt;ui-resource-element&gt;</c>, balanced, without
    /// scripts and without a loader already.
    /// </summary>
    /// <exception cref="UnexpectedMasterPageException">The component does not have the expected shape.</exception>
    public static string Insert(string html)
    {
        ArgumentNullException.ThrowIfNull(html);
        if (!HasExpectedShape(html))
        {
            throw new UnexpectedMasterPageException();
        }

        var at = html.LastIndexOf(CloseTag, StringComparison.Ordinal);
        return string.Concat(html.AsSpan(0, at), Loader, html.AsSpan(at));
    }

    private static bool HasExpectedShape(string html)
    {
        var content = html.TrimStart(ByteOrderMark).Trim();
        var opened = OpenTagRegex().Count(content);
        var closed = CountOccurrences(content, CloseTag);
        return content.StartsWith(OpenTag, StringComparison.Ordinal)
            && content.EndsWith(CloseTag, StringComparison.Ordinal)
            && !content.Contains('\r', StringComparison.Ordinal)
            && !content.Contains('\n', StringComparison.Ordinal)
            && opened > 0
            && opened == closed
            && !content.Contains("<script", StringComparison.OrdinalIgnoreCase)
            && !content.Contains("data-msfs-ui", StringComparison.Ordinal);
    }

    private static int CountOccurrences(string text, string value)
    {
        var count = 0;
        for (var at = text.IndexOf(value, StringComparison.Ordinal); at >= 0; at = text.IndexOf(value, at + value.Length, StringComparison.Ordinal))
        {
            count++;
        }

        return count;
    }

    [GeneratedRegex(@"<ui-resource-element[\s>]")]
    private static partial Regex OpenTagRegex();
}

/// <summary>The sim's MasterPage component no longer has the shape the loader can be inserted into.</summary>
public sealed class UnexpectedMasterPageException : MsfsUiException
{
    /// <summary>Creates the exception with its user-facing message.</summary>
    public UnexpectedMasterPageException()
        : base("The sim's MasterPage component has an unexpected shape (a single line of nested <ui-resource-element> "
            + "tags is expected). A sim update probably changed it: the loader cannot be inserted until MSFS-UI-GENERATOR is updated.")
    {
    }

    /// <summary>Creates the exception with a custom message.</summary>
    public UnexpectedMasterPageException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a custom message and cause.</summary>
    public UnexpectedMasterPageException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
