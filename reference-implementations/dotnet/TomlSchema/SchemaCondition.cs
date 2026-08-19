namespace TomlSchema;

/// <summary>
/// Represents a schema conditional validation rule (if/then/else).
/// </summary>
public record SchemaCondition
{
    /// <summary>The key to test in the conditional</summary>
    public required string IfKey { get; init; }

    /// <summary>The value to match for equality test</summary>
    public object? IfEquals { get; init; }

    /// <summary>The array of values to test for membership</summary>
    public List<object?>? IfIn { get; init; }

    /// <summary>Type to apply when condition is true</summary>
    public string? ThenType { get; init; }

    /// <summary>Type to apply when condition is false</summary>
    public string? ElseType { get; init; }
}
