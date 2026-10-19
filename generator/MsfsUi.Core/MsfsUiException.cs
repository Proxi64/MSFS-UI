namespace MsfsUi.Core;

/// <summary>
/// An expected failure with a message meant for the user (sim not found, unexpected sim file, invalid
/// settings…). Unexpected failures keep their own exception types.
/// </summary>
public class MsfsUiException : Exception
{
    /// <summary>Creates the exception with a user-facing message.</summary>
    public MsfsUiException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a user-facing message and the underlying cause.</summary>
    public MsfsUiException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>Creates the exception without a message (prefer the constructors with a message).</summary>
    public MsfsUiException()
    {
    }
}
