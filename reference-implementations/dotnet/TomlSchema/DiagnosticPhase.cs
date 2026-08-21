namespace TomlSchema;

/// <summary>
/// The phase of processing that produced a diagnostic, as defined by SPEC.md's
/// <c>### Phases</c> section. Every diagnostic belongs to exactly one phase.
/// </summary>
public enum DiagnosticPhase
{
    /// <summary>Resolving a schema from a document's <c>[toml-schema]</c> table.</summary>
    Discovery,

    /// <summary>Parsing a schema document and applying every schema-load rule.</summary>
    SchemaLoad,

    /// <summary>Applying a successfully loaded schema to a TOML document.</summary>
    Validation
}

/// <summary>Wire-spelling helpers for <see cref="DiagnosticPhase"/>.</summary>
public static class DiagnosticPhaseExtensions
{
    /// <summary>
    /// Returns the normative wire spelling of a phase (<c>discovery</c>,
    /// <c>schema-load</c>, or <c>validation</c>) used for conformance comparison.
    /// </summary>
    public static string WireName(this DiagnosticPhase phase) => phase switch
    {
        DiagnosticPhase.Discovery => "discovery",
        DiagnosticPhase.SchemaLoad => "schema-load",
        DiagnosticPhase.Validation => "validation",
        _ => throw new ArgumentOutOfRangeException(nameof(phase))
    };
}
