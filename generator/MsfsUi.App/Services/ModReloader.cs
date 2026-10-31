using Microsoft.Extensions.Logging;
using MsfsUi.Core.Coherent;

namespace MsfsUi.App.Services;

/// <summary>
/// The mod reloaded in the running sim after its package was installed: the sim only re-reads the files. The package
/// is installed whatever happens here: a reload that fails, or an inspector that does not answer, is a warning for the
/// page to show, not a failed installation.
/// </summary>
public sealed partial class ModReloader
{
    private readonly CoherentInspector _inspector;
    private readonly ILogger<ModReloader> _logger;

    public ModReloader(CoherentInspector inspector, ILogger<ModReloader> logger)
    {
        _inspector = inspector;
        _logger = logger;
    }

    /// <summary>Reloads the mod after an installation; null when it was reloaded, otherwise why it was not.</summary>
    public async Task<string?> ReloadAfterInstallAsync()
    {
        try
        {
            var reload = await _inspector.ReloadModAsync();
            return reload.Ok ? null : reload.Error ?? string.Empty;
        }
        catch (InspectorUnavailableException ex)
        {
            LogReloadFailed(ex);
            return ex.Message;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Package installed, but the mod could not be reloaded in the sim")]
    private partial void LogReloadFailed(Exception exception);
}
