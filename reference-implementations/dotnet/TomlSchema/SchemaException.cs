namespace TomlSchema;

/// <summary>
/// Thrown when a TOML Schema document is malformed or cannot be loaded. The exception
/// carries a structured diagnostic (phase, code, and optional schema path) so callers can
/// report a normative <see cref="ValidationDiagnostic"/> instead of parsing free-form
/// message text. The one-argument constructor defaults to the schema-load
/// <c>schema-malformed</c> catch-all, which SPEC.md designates for any schema-load failure
/// with no more specific code.
/// </summary>
public sealed class SchemaException : Exception
{
    /// <summary>Creates a schema-load <c>schema-malformed</c> failure.</summary>
    public SchemaException(string message)
        : this(DiagnosticCodes.SchemaMalformed, null, message)
    {
    }

    /// <summary>Creates a schema-load <c>schema-malformed</c> failure with a cause.</summary>
    public SchemaException(string message, Exception innerException)
        : base(message, innerException)
    {
        Phase = DiagnosticPhase.SchemaLoad;
        Code = DiagnosticCodes.SchemaMalformed;
        SchemaPath = null;
    }

    /// <summary>Creates a schema-load failure with an explicit code and schema path.</summary>
    public SchemaException(string code, string? schemaPath, string message)
        : this(DiagnosticPhase.SchemaLoad, code, schemaPath, message)
    {
    }

    /// <summary>Creates a failure with an explicit phase, code, and schema path.</summary>
    public SchemaException(DiagnosticPhase phase, string code, string? schemaPath, string message)
        : base(message)
    {
        Phase = phase;
        Code = code;
        SchemaPath = schemaPath;
    }

    /// <summary>Gets the phase that detected the failure.</summary>
    public DiagnosticPhase Phase { get; }

    /// <summary>Gets the registry code for the failure.</summary>
    public string Code { get; }

    /// <summary>Gets the schema path attributed to the failure, or <c>null</c>.</summary>
    public string? SchemaPath { get; }

    /// <summary>
    /// Returns this failure as a normative diagnostic. Schema-load and discovery
    /// diagnostics never carry an instance path.
    /// </summary>
    public ValidationDiagnostic ToDiagnostic() =>
        new(Phase, DiagnosticSeverity.Error, Code, null, SchemaPath, Message);
}
