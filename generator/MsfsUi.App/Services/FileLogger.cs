using System.Globalization;
using System.Text;
using Microsoft.Extensions.Logging;

namespace MsfsUi.App.Services;

/// <summary>One line of the app's log.</summary>
/// <param name="Time">When it was written (UTC).</param>
/// <param name="Level">Its level.</param>
/// <param name="Category">Short name of the class that wrote it.</param>
/// <param name="Message">The message, with the exception if any.</param>
public sealed record LogEntry(DateTimeOffset Time, LogLevel Level, string Category, string Message);

/// <summary>
/// The app's log: one file per day in <c>%LOCALAPPDATA%\MSFS-UI\logs</c>, and the latest lines in memory for the
/// Log page.
/// </summary>
public sealed class FileLoggerProvider : ILoggerProvider
{
    private const int KeptInMemory = 500;

    private readonly string _folder;
    private readonly TimeProvider _time;
    private readonly Lock _lock = new();
    private readonly LinkedList<LogEntry> _recent = new();

    public FileLoggerProvider(string folder, TimeProvider time)
    {
        _folder = folder;
        _time = time;
    }

    /// <summary>Raised after each line, on the thread that wrote it.</summary>
    public event EventHandler<LogEntry>? EntryWritten;

    /// <summary>The latest lines, oldest first.</summary>
    public IReadOnlyList<LogEntry> Recent
    {
        get
        {
            lock (_lock)
            {
                return [.. _recent];
            }
        }
    }

    public ILogger CreateLogger(string categoryName) => new FileLogger(this, ShortName(categoryName));

    public void Dispose()
    {
        // Each line is appended and closed at once: nothing stays open.
    }

    private void Write(LogEntry entry)
    {
        var line = string.Create(
            CultureInfo.InvariantCulture,
            $"{entry.Time:yyyy-MM-ddTHH:mm:ss.fffZ} {Level(entry.Level)} {entry.Category}: {entry.Message}{Environment.NewLine}");
        lock (_lock)
        {
            _recent.AddLast(entry);
            if (_recent.Count > KeptInMemory)
            {
                _recent.RemoveFirst();
            }

            try
            {
                Directory.CreateDirectory(_folder);
                File.AppendAllText(Path.Combine(_folder, string.Create(CultureInfo.InvariantCulture, $"msfs-ui-{entry.Time:yyyyMMdd}.log")), line, Encoding.UTF8);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // The log must never break the app: the line stays in memory.
            }
        }

        EntryWritten?.Invoke(this, entry);
    }

    private static string ShortName(string category)
    {
        var dot = category.LastIndexOf('.');
        return dot >= 0 ? category[(dot + 1)..] : category;
    }

    private static string Level(LogLevel level) => level switch
    {
        LogLevel.Trace => "TRACE",
        LogLevel.Debug => "DEBUG",
        LogLevel.Information => "INFO ",
        LogLevel.Warning => "WARN ",
        LogLevel.Error => "ERROR",
        LogLevel.Critical => "CRIT ",
        _ => "     ",
    };

    private sealed class FileLogger(FileLoggerProvider provider, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
            {
                return;
            }

            var message = formatter(state, exception);
            if (exception is not null)
            {
                message += Environment.NewLine + exception;
            }

            provider.Write(new LogEntry(provider._time.GetUtcNow(), logLevel, category, message));
        }
    }
}
