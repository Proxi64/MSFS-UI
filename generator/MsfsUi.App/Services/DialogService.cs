using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Windows.Storage.Pickers;

namespace MsfsUi.App.Services;

/// <summary>Dialogs a view model may need: a confirmation before a destructive action, a folder to choose.</summary>
public interface IDialogService
{
    /// <summary>Asks to confirm; true when the user chose <paramref name="confirm"/>.</summary>
    Task<bool> ConfirmAsync(string title, string message, string confirm);

    /// <summary>Asks for a folder; null when cancelled.</summary>
    Task<string?> PickFolderAsync(string commitText);
}

/// <summary>The dialogs, shown over the main window (set by <see cref="App"/> once it exists).</summary>
public sealed class DialogService : IDialogService
{
    /// <summary>The window the dialogs belong to.</summary>
    public Window? Window { get; set; }

    public async Task<bool> ConfirmAsync(string title, string message, string confirm)
    {
        var root = Window?.Content?.XamlRoot ?? throw new InvalidOperationException("The main window is not shown yet.");
        var dialog = new ContentDialog
        {
            XamlRoot = root,
            Title = title,
            Content = message,
            PrimaryButtonText = confirm,
            CloseButtonText = Strings.Get("DialogCancel"),
            // A destructive action is never the default: Enter cancels.
            DefaultButton = ContentDialogButton.Close,
        };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }

    public async Task<string?> PickFolderAsync(string commitText)
    {
        var window = Window ?? throw new InvalidOperationException("The main window is not shown yet.");
        var picker = new FolderPicker(window.AppWindow.Id) { CommitButtonText = commitText };
        var result = await picker.PickSingleFolderAsync();
        return result?.Path;
    }
}
