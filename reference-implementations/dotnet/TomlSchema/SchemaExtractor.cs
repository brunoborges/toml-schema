namespace TomlSchema;

using System.Text;
using Tomlyn;
using Tomlyn.Model;

internal static class SchemaExtractor
{
    private const string CurrentSchemaVersion = "1.0.0";

    public static string Generate(TomlTable document)
    {
        var schema = new StringBuilder()
            .Append("[toml-schema]\n")
            .Append($"version = \"{CurrentSchemaVersion}\"\n\n")
            .Append("[elements]\n");
        foreach (var key in document.Keys.Order(StringComparer.Ordinal))
        {
            if (key != "toml-schema")
                AppendDefinition(schema, ["elements", key], document[key]);
        }
        return schema.ToString();
    }

    public static void ExtractFile(string documentPath, string schemaPath)
    {
        var document = TomlSerializer.Deserialize<TomlTable>(File.ReadAllText(documentPath))
            ?? throw new InvalidOperationException($"Failed to parse document: {documentPath}");
        File.WriteAllText(schemaPath, Generate(document), new UTF8Encoding(false));
    }

    private static void AppendDefinition(StringBuilder schema, IReadOnlyList<string> path, object? value)
    {
        schema.Append('\n').Append('[')
            .Append(string.Join(".", path.Select(EncodeKey)))
            .Append("]\n");
        var type = SchemaTypeOf(value);
        schema.Append("type = \"").Append(type).Append("\"\n");
        if (value is TomlArray array)
            schema.Append("itemtype = \"").Append(InferItemType(array.Cast<object?>())).Append("\"\n");
        else if (value is TomlTableArray tableArray)
            schema.Append("itemtype = \"").Append(InferItemType(tableArray.Cast<object?>())).Append("\"\n");
        if (value is TomlTable table)
        {
            foreach (var key in table.Keys.Order(StringComparer.Ordinal))
                AppendDefinition(schema, [.. path, key], table[key]);
        }
    }

    private static string InferItemType(IEnumerable<object?> items)
    {
        using var enumerator = items.GetEnumerator();
        if (!enumerator.MoveNext())
            return "any";
        var first = SchemaTypeOf(enumerator.Current);
        while (enumerator.MoveNext())
        {
            if (SchemaTypeOf(enumerator.Current) != first)
                return "any";
        }
        return first;
    }

    private static string SchemaTypeOf(object? value) => value switch
    {
        string => "string",
        long => "integer",
        double => "float",
        bool => "boolean",
        DateTime dt when dt.Kind == DateTimeKind.Utc => "offset-date-time",
        DateTime => "local-date-time",
        DateOnly => "local-date",
        TimeOnly => "local-time",
        TomlDateTime { Kind: TomlDateTimeKind.OffsetDateTimeByZ or TomlDateTimeKind.OffsetDateTimeByNumber } => "offset-date-time",
        TomlDateTime { Kind: TomlDateTimeKind.LocalDateTime } => "local-date-time",
        TomlDateTime { Kind: TomlDateTimeKind.LocalDate } => "local-date",
        TomlDateTime { Kind: TomlDateTimeKind.LocalTime } => "local-time",
        TomlArray or TomlTableArray => "array",
        TomlTable => "table",
        _ => "any"
    };

    private static string EncodeKey(string key)
    {
        if (key.Length > 0 && key.All(character =>
                character is >= 'A' and <= 'Z'
                    or >= 'a' and <= 'z'
                    or >= '0' and <= '9'
                    or '_' or '-'))
            return key;

        var encoded = new StringBuilder("\"");
        foreach (var character in key)
        {
            switch (character)
            {
                case '\\': encoded.Append("\\\\"); break;
                case '"': encoded.Append("\\\""); break;
                case '\b': encoded.Append("\\b"); break;
                case '\t': encoded.Append("\\t"); break;
                case '\n': encoded.Append("\\n"); break;
                case '\f': encoded.Append("\\f"); break;
                case '\r': encoded.Append("\\r"); break;
                default:
                    if (character < 0x20 || character == 0x7f)
                        encoded.Append($"\\u{(int)character:X4}");
                    else
                        encoded.Append(character);
                    break;
            }
        }
        return encoded.Append('"').ToString();
    }
}
