namespace TomlSchema;

/// <summary>
/// Result of validating a TOML document against a schema.
/// Separates errors from warnings; validation is valid if no errors exist.
/// </summary>
public record ValidationResult(
    IReadOnlyList<ValidationError> Errors,
    IReadOnlyList<ValidationWarning> Warnings)
{
    /// <summary>Creates a result with errors and no warnings.</summary>
    public ValidationResult(IReadOnlyList<ValidationError> errors) 
        : this(errors, Array.Empty<ValidationWarning>()) { }

    /// <summary>Gets whether validation produced no errors.</summary>
    public bool IsValid => Errors.Count == 0;

    /// <summary>Gets errors and warnings in diagnostic order.</summary>
    public IEnumerable<ValidationDiagnostic> Diagnostics => 
        Errors.Cast<ValidationDiagnostic>()
            .Concat(Warnings.Cast<ValidationDiagnostic>());
}
