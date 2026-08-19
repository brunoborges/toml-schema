namespace TomlSchema;

/// <summary>
/// Represents a schema definition node (element or type).
/// </summary>
public class SchemaDefinition
{
    public SchemaType Type { get; set; }
    public string? ItemType { get; set; }
    public string? Description { get; set; }
    public bool Optional { get; set; }
    public object? DefaultValue { get; set; }
    public bool Deprecated { get; set; }
    public string? Pattern { get; set; }
    public string? KeyPattern { get; set; }
    public long? Min { get; set; }
    public long? Max { get; set; }
    public long? MinLength { get; set; }
    public long? MaxLength { get; set; }
    public bool? UniqueItems { get; set; }
    public List<object>? AllowedValues { get; set; }
    public List<string>? OneOf { get; set; }
    public List<string>? AnyOf { get; set; }
    public List<string>? AllOf { get; set; }
    public Dictionary<string, SchemaDefinition> Children { get; } = new();
    public List<string>? DependentRequired { get; set; }
    public List<string>? MutuallyExclusive { get; set; }
    public List<string>? ExactlyOne { get; set; }
    public SchemaCondition? Condition { get; set; }
    public List<(string key, List<object> values)>? Items { get; set; }

    public override string ToString() => $"SchemaDefinition({Type})";
}

/// <summary>
/// Represents a conditional schema structure (if/then/else).
/// </summary>
public record SchemaCondition(
    Dictionary<string, object> If,
    SchemaDefinition? Then,
    SchemaDefinition? Else);
