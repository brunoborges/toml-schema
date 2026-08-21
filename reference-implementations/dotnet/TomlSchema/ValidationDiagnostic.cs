namespace TomlSchema;

/// <summary>
/// A single diagnostic produced while discovering a schema, loading a schema, or
/// validating a document. This one record shape carries every normative field defined by
/// SPEC.md's <c>### Diagnostic Record</c>: the <see cref="Phase"/>, the
/// <see cref="Severity"/>, the registry <see cref="Code"/>, an optional
/// <see cref="InstancePath"/>, an optional <see cref="SchemaPath"/>, and a human-readable
/// <see cref="Message"/>. Errors and warnings share this type; they are told apart by
/// <see cref="Severity"/> and are exposed separately by <see cref="ValidationResult"/>.
/// </summary>
/// <remarks>
/// Message text is presentation only. SPEC.md states implementations "MUST NOT be
/// compared, and MUST NOT compare themselves, by message text", so conformance is judged
/// on phase, severity, code, instance path, and schema path.
/// </remarks>
public sealed record ValidationDiagnostic(
    DiagnosticPhase Phase,
    DiagnosticSeverity Severity,
    string Code,
    string? InstancePath,
    string? SchemaPath,
    string Message)
{
    /// <summary>
    /// Gets the instance path to the affected document value, or <c>null</c>. Alias for
    /// <see cref="InstancePath"/> kept for call sites that refer to a document path.
    /// </summary>
    public string? Path => InstancePath;

    /// <summary>Creates a validation-phase error.</summary>
    public static ValidationDiagnostic Error(string code, string? instancePath, string? schemaPath, string message) =>
        new(DiagnosticPhase.Validation, DiagnosticSeverity.Error, code, instancePath, schemaPath, message);

    /// <summary>Creates a validation-phase warning.</summary>
    public static ValidationDiagnostic Warning(string code, string? instancePath, string? schemaPath, string message) =>
        new(DiagnosticPhase.Validation, DiagnosticSeverity.Warning, code, instancePath, schemaPath, message);

    /// <summary>Returns the diagnostic as a location and message when a path is present.</summary>
    public override string ToString()
    {
        var location = InstancePath ?? SchemaPath;
        return location == null ? Message : $"{location}: {Message}";
    }
}
