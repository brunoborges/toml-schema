namespace TomlSchema;

/// <summary>
/// Built-in types supported by TOML Schema.
/// </summary>
public enum SchemaType
{
    Any,
    String,
    Integer,
    Float,
    Boolean,
    OffsetDateTime,
    LocalDateTime,
    LocalDate,
    LocalTime,
    Array,
    Table,
    Collection
}

public static class SchemaTypeExtensions
{
    private static readonly Dictionary<SchemaType, string> TypeNames = new()
    {
        { SchemaType.Any, "any" },
        { SchemaType.String, "string" },
        { SchemaType.Integer, "integer" },
        { SchemaType.Float, "float" },
        { SchemaType.Boolean, "boolean" },
        { SchemaType.OffsetDateTime, "offset-date-time" },
        { SchemaType.LocalDateTime, "local-date-time" },
        { SchemaType.LocalDate, "local-date" },
        { SchemaType.LocalTime, "local-time" },
        { SchemaType.Array, "array" },
        { SchemaType.Table, "table" },
        { SchemaType.Collection, "collection" }
    };

    private static readonly Dictionary<string, SchemaType> NameTypes = new()
    {
        { "any", SchemaType.Any },
        { "string", SchemaType.String },
        { "integer", SchemaType.Integer },
        { "float", SchemaType.Float },
        { "boolean", SchemaType.Boolean },
        { "offset-date-time", SchemaType.OffsetDateTime },
        { "local-date-time", SchemaType.LocalDateTime },
        { "local-date", SchemaType.LocalDate },
        { "local-time", SchemaType.LocalTime },
        { "array", SchemaType.Array },
        { "table", SchemaType.Table },
        { "collection", SchemaType.Collection }
    };

    public static string ToSchemaName(this SchemaType type) => TypeNames[type];

    public static SchemaType FromSchemaName(string name) =>
        NameTypes.TryGetValue(name, out var type) 
            ? type 
            : throw new ArgumentException($"Unknown type: {name}", nameof(name));

    public static IEnumerable<string> AllTypeNames => NameTypes.Keys;
}
