namespace TomlSchema;

/// <summary>
/// Base type for validation diagnostics (errors and warnings).
/// </summary>
public abstract record ValidationDiagnostic(string Path, string Message, string Code)
{
    /// <summary>Gets the diagnostic severity.</summary>
    public abstract DiagnosticSeverity Severity { get; }
}

/// <summary>
/// Validation error that makes validation fail.
/// </summary>
public sealed record ValidationError(string Path, string Message, string Code) 
    : ValidationDiagnostic(Path, Message, Code)
{
    /// <inheritdoc />
    public override DiagnosticSeverity Severity => DiagnosticSeverity.Error;
}

/// <summary>
/// Validation warning that does not affect validation success.
/// </summary>
public sealed record ValidationWarning(string Path, string Message, string Code, DiagnosticSeverity WarningLevel) 
    : ValidationDiagnostic(Path, Message, Code)
{
    /// <summary>Creates a warning with standard warning severity.</summary>
    public ValidationWarning(string path, string message, string code) 
        : this(path, message, code, DiagnosticSeverity.Warning)
    {
    }

    /// <inheritdoc />
    public override DiagnosticSeverity Severity => WarningLevel;
}
