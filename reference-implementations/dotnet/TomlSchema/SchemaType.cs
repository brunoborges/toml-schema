namespace TomlSchema;

/// <summary>
/// Built-in types supported by TOML Schema.
/// </summary>
public enum SchemaType
{
    /// <summary>Any TOML value.</summary>
    Any,
    /// <summary>A TOML string.</summary>
    String,
    /// <summary>A TOML integer.</summary>
    Integer,
    /// <summary>A TOML floating-point number.</summary>
    Float,
    /// <summary>A TOML boolean.</summary>
    Boolean,
    /// <summary>A TOML offset date-time.</summary>
    OffsetDateTime,
    /// <summary>A TOML local date-time.</summary>
    LocalDateTime,
    /// <summary>A TOML local date.</summary>
    LocalDate,
    /// <summary>A TOML local time.</summary>
    LocalTime,
    /// <summary>A TOML array.</summary>
    Array,
    /// <summary>A TOML table.</summary>
    Table,
    /// <summary>A TOML table with dynamic keys.</summary>
    Collection
}

/// <summary>
/// Conversion helpers for TOML Schema built-in type names.
/// </summary>
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

    /// <summary>Returns the schema-language name for a built-in type.</summary>
    public static string ToSchemaName(this SchemaType type) => TypeNames[type];

    /// <summary>Converts a schema-language built-in type name to its enum value.</summary>
    public static SchemaType FromSchemaName(string name) =>
        NameTypes.TryGetValue(name, out var type) 
            ? type 
            : throw new ArgumentException($"Unknown type: {name}", nameof(name));

    /// <summary>Tries to convert a schema-language built-in type name to its enum value.</summary>
    public static bool TryFromSchemaName(string name, out SchemaType type) =>
        NameTypes.TryGetValue(name, out type);

    /// <summary>Gets all supported schema-language built-in type names.</summary>
    public static IEnumerable<string> AllTypeNames => NameTypes.Keys;
}
