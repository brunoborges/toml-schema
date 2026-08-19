namespace TomlSchema;

/// <summary>
/// Severity level for validation diagnostics.
/// </summary>
public enum DiagnosticSeverity
{
    /// <summary>An error that makes validation unsuccessful.</summary>
    Error,
    /// <summary>A non-fatal validation diagnostic.</summary>
    Warning
}
