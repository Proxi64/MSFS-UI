using System.Globalization;
using Microsoft.Windows.ApplicationModel.Resources;

namespace MsfsUi.App.Services;

/// <summary>Texts of the app shown from code (the XAML uses <c>x:Uid</c>), in <c>Strings/en-us/Resources.resw</c>.</summary>
public static class Strings
{
    private static readonly ResourceLoader Loader = new();

    /// <summary>The text of <paramref name="key"/>; the key itself when it is missing, so that it shows up.</summary>
    public static string Get(string key)
    {
        var text = Loader.GetString(key);
        return string.IsNullOrEmpty(text) ? key : text;
    }

    /// <summary>The text of <paramref name="key"/> with its <c>{0}</c>… placeholders filled.</summary>
    public static string Format(string key, params object?[] values) =>
        string.Format(CultureInfo.CurrentCulture, Get(key), values);
}
