namespace TomlSchema;

/// <summary>
/// The errors and warnings produced by a validation attempt. SPEC.md requires that
/// implementations "provide separate access to errors and warnings"; both are the same
/// <see cref="ValidationDiagnostic"/> record, partitioned here by severity.
/// </summary>
public record ValidationResult(
    IReadOnlyList<ValidationDiagnostic> Errors,
    IReadOnlyList<ValidationDiagnostic> Warnings)
{
    /// <summary>Creates a result with errors and no warnings.</summary>
    public ValidationResult(IReadOnlyList<ValidationDiagnostic> errors)
        : this(errors, Array.Empty<ValidationDiagnostic>()) { }

    /// <summary>Gets whether validation produced no errors.</summary>
    public bool IsValid => Errors.Count == 0;

    /// <summary>Gets errors and warnings in diagnostic order.</summary>
    public IEnumerable<ValidationDiagnostic> Diagnostics => Errors.Concat(Warnings);
}
