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

/// <summary>Wire-spelling helpers for <see cref="DiagnosticSeverity"/>.</summary>
public static class DiagnosticSeverityExtensions
{
    /// <summary>Returns the normative wire spelling (<c>error</c> or <c>warning</c>).</summary>
    public static string WireName(this DiagnosticSeverity severity) =>
        severity == DiagnosticSeverity.Error ? "error" : "warning";
}
