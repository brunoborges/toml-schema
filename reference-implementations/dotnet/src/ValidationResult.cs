namespace TomlSchema;

/// <summary>
/// Result of validating a TOML document against a schema.
/// Separates errors from warnings; validation is valid if no errors exist.
/// </summary>
public record ValidationResult(
    IReadOnlyList<ValidationError> Errors,
    IReadOnlyList<ValidationWarning> Warnings)
{
    public ValidationResult(IReadOnlyList<ValidationError> errors) 
        : this(errors, Array.Empty<ValidationWarning>()) { }

    public bool IsValid => Errors.Count == 0;

    public IEnumerable<ValidationDiagnostic> Diagnostics => 
        Errors.Cast<ValidationDiagnostic>()
            .Concat(Warnings.Cast<ValidationDiagnostic>());
}
