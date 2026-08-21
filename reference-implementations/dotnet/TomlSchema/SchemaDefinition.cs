namespace TomlSchema;

/// <summary>
/// Represents a schema definition (type, element, or union).
/// </summary>
public record SchemaDefinition
{
    internal string? Name { get; init; }

    /// <summary>The type of this definition (e.g., "string", "table")</summary>
    public SchemaType? Type { get; init; }

    /// <summary>Reference to a named type in [types] section</summary>
    public string? Reference { get; init; }

    /// <summary>Human-readable description</summary>
    public string? Description { get; init; }

    /// <summary>Item type for arrays (e.g., "string")</summary>
    public string? ItemType { get; init; }

    /// <summary>Positional array item types</summary>
    public List<string>? Items { get; init; }

    /// <summary>Allowed values for this element</summary>
    public List<object?>? AllowedValues { get; init; }

    /// <summary>Regex pattern for string validation</summary>
    public string? Pattern { get; init; }

    /// <summary>Well-known format for string validation</summary>
    public string? Format { get; init; }

    /// <summary>Regex pattern for collection dynamic key validation</summary>
    public string? KeyPattern { get; init; }

    /// <summary>Whether this element is optional</summary>
    public bool Optional { get; init; }

    /// <summary>Inclusive minimum value for a comparable scalar or array item</summary>
    public object? Min { get; init; }

    /// <summary>Inclusive maximum value for a comparable scalar or array item</summary>
    public object? Max { get; init; }

    /// <summary>Minimum string length (Unicode scalars)</summary>
    public long? MinLength { get; init; }

    /// <summary>Maximum string length (Unicode scalars)</summary>
    public long? MaxLength { get; init; }

    /// <summary>Whether array items must be unique</summary>
    public bool? UniqueItems { get; init; }

    /// <summary>Union: exactly one matching type</summary>
    public List<string>? OneOf { get; init; }

    /// <summary>Union: at least one matching type</summary>
    public List<string>? AnyOf { get; init; }

    /// <summary>Composition: apply all referenced types conjunctively</summary>
    public List<string>? AllOf { get; init; }

    /// <summary>Default value (read-only annotation)</summary>
    public object? Default { get; init; }

    /// <summary>Deprecation flag</summary>
    public bool Deprecated { get; init; }

    /// <summary>Conditional validation (if/then/else)</summary>
    public SchemaCondition? Condition { get; init; }

    /// <summary>Nested child definitions</summary>
    public Dictionary<string, SchemaDefinition> Children { get; init; } = new();

    /// <summary>Dependent required sibling rules mapping each trigger key to its required siblings</summary>
    public Dictionary<string, List<string>>? DependentRequiredMap { get; init; }

    /// <summary>Mutually exclusive sibling groups</summary>
    public List<List<string>>? MutuallyExclusive { get; init; }

    /// <summary>Exactly one required sibling groups</summary>
    public List<List<string>>? ExactlyOne { get; init; }
}
