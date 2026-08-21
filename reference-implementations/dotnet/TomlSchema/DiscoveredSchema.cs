namespace TomlSchema;

using Tomlyn.Model;

/// <summary>
/// The outcome of discovering a schema from a TOML document via its reserved
/// <c>[toml-schema].location</c>, as described in SPEC.md's
/// "TOML Reference of a TOML Schema" section.
/// </summary>
/// <param name="Schema">The discovered and loaded schema.</param>
/// <param name="Document">The parsed TOML document that referenced the schema.</param>
/// <param name="Warnings">
/// Non-fatal version-compatibility warnings produced while comparing the document's
/// expected TOML Schema version against the resolved schema's declared version; empty
/// when the document omits <c>[toml-schema].version</c> or the versions match exactly.
/// </param>
public sealed record DiscoveredSchema(
    TomlSchema Schema,
    TomlTable Document,
    IReadOnlyList<ValidationDiagnostic> Warnings)
{
    /// <summary>
    /// Validates the discovered document against the discovered schema, including any
    /// version-compatibility warnings produced during discovery.
    /// </summary>
    public ValidationResult Validate()
    {
        var result = Schema.Validate(Document);
        if (Warnings.Count == 0)
            return result;

        var combined = new List<ValidationDiagnostic>(Warnings);
        combined.AddRange(result.Warnings);
        return new ValidationResult(result.Errors, combined);
    }
}
