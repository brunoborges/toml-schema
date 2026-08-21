namespace TomlSchema;

/// <summary>
/// Thrown when a TOML document submitted for validation is not well-formed TOML.
/// </summary>
/// <remarks>
/// Such a document never reaches the validator, so its failure is deliberately
/// <em>not</em> a <see cref="ValidationDiagnostic"/>. SPEC.md requires that a parse
/// failure "is a parse error rather than a validation diagnostic", that it is not
/// reported under a registry or extension code, and that the document is not reported as
/// invalid. A command-line validator reports it as an unusable invocation and exits
/// <c>2</c>.
/// </remarks>
public sealed class DocumentParseException : Exception
{
    /// <summary>Creates a parse exception carrying the underlying parser message.</summary>
    public DocumentParseException(string message)
        : base(message)
    {
    }

    /// <summary>Creates a parse exception wrapping the underlying parser failure.</summary>
    public DocumentParseException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
