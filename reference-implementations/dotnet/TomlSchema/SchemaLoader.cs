namespace TomlSchema;

using Tomlyn;
using Tomlyn.Model;
using System.Text.RegularExpressions;

/// <summary>
/// Loads and parses TOML Schema documents (.tosd files).
/// </summary>
public class SchemaLoader
{
    /// <summary>All allowed schema property keys</summary>
    public static readonly HashSet<string> DefinitionKeys = new()
    {
        "type", "description", "itemtype", "items", "allowedvalues", "pattern", "format", "keypattern",
        "optional", "min", "max", "minlength", "maxlength", "oneof", "anyof", "allof",
        "dependentrequired", "mutuallyexclusive", "exactlyone", "uniqueitems", "default",
        "deprecated", "if", "then", "else"
    };

    /// <summary>Keys allowed in named type references (reusable [types] definitions)</summary>
    private static readonly HashSet<string> NamedReferenceKeys = new()
    {
        "type", "description", "optional", "allof", "default", "deprecated"
    };

    /// <summary>Keys allowed in oneof/anyof unions</summary>
    private static readonly HashSet<string> UnionKeys = new()
    {
        "oneof", "anyof", "description", "optional", "allof", "default", "deprecated"
    };

    /// <summary>Keys allowed in if/then/else conditionals</summary>
    private static readonly HashSet<string> ConditionalKeys = new()
    {
        "if", "then", "else", "description", "optional", "allof", "default", "deprecated"
    };

    /// <summary>Valid schema version range (semantic versioning)</summary>
    private static readonly Regex SemVerPattern = new(
        @"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
        + @"(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
        + @"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
        + @"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
        RegexOptions.Compiled
    );

    /// <summary>
    /// Loads a TOML Schema document from a file.
    /// </summary>
    /// <param name="schemaPath">The path to the schema document.</param>
    /// <returns>The loaded schema.</returns>
    public static TomlSchema Load(string schemaPath)
    {
        var loader = new SchemaLoader();
        return loader.LoadSchema(schemaPath);
    }

    /// <summary>
    /// Parses TOML content into a table.
    /// </summary>
    /// <param name="content">The TOML text to parse.</param>
    /// <returns>The parsed TOML table.</returns>
    public static TomlTable ParseToml(string content)
    {
        return TomlSerializer.Deserialize<TomlTable>(content) 
            ?? throw new InvalidOperationException("Failed to parse TOML content");
    }

    private TomlSchema LoadSchema(string schemaPath)
    {
        if (!File.Exists(schemaPath))
            throw new FileNotFoundException($"Schema file not found: {schemaPath}");

        var content = File.ReadAllText(schemaPath);
        var schemaDoc = ParseToml(content);

        // Validate top-level keys
        foreach (var key in schemaDoc.Keys)
        {
            if (key != "toml-schema" && key != "types" && key != "elements")
                throw new InvalidOperationException($"Unexpected top-level key: {key}");
        }

        // Read [toml-schema] metadata
        if (!schemaDoc.TryGetValue("toml-schema", out var tomlSchemaObj) || tomlSchemaObj is not TomlTable tomlSchema)
            throw new InvalidOperationException("Schema must have [toml-schema] metadata section");

        if (!tomlSchema.TryGetValue("version", out var versionObj) || versionObj is not string version)
            throw new InvalidOperationException("[toml-schema].version must be a string");

        // Validate SemVer format
        if (!SemVerPattern.IsMatch(version))
            throw new InvalidOperationException($"[toml-schema].version must be valid SemVer 2.0.0: {version}");

        // Enforce supported version (1.x.x)
        var parts = version.Split('.');
        if (parts[0] != "1")
            throw new InvalidOperationException($"Unsupported schema version: {version} (requires 1.x.x)");

        // Parse types and elements
        var types = new Dictionary<string, SchemaDefinition>();
        if (schemaDoc.TryGetValue("types", out var typesObj) && typesObj is TomlTable typesDef)
        {
            foreach (var (typeName, typeValue) in typesDef)
            {
                if (typeValue is not TomlTable typeTable)
                    throw new InvalidOperationException($"[types.{typeName}] must be a table");

                types[typeName] = ParseDefinition($"[types].{typeName}", typeTable);
            }
        }

        var elements = new Dictionary<string, SchemaDefinition>();
        if (schemaDoc.TryGetValue("elements", out var elementsObj) && elementsObj is TomlTable elementsDef)
        {
            foreach (var (elemName, elemValue) in elementsDef)
            {
                if (elemValue is not TomlTable elemTable)
                    throw new InvalidOperationException($"[elements.{elemName}] must be a table");

                elements[elemName] = ParseDefinition($"[elements].{elemName}", elemTable);
            }
        }

        return new TomlSchema(version, types, elements);
    }

    private SchemaDefinition ParseDefinition(string location, TomlTable table)
    {
        var typeStr = GetString(table, "type");
        SchemaType? type = null;
        string? reference = null;

        if (typeStr != null)
        {
            try
            {
                type = SchemaTypeExtensions.FromSchemaName(typeStr);
            }
            catch
            {
                // Not a built-in type, treat as named reference
                reference = typeStr;
            }
        }

        var hasOneOf = table.TryGetValue("oneof", out var oneOfSelector) && oneOfSelector is not TomlTable;
        var hasAnyOf = table.TryGetValue("anyof", out var anyOfSelector) && anyOfSelector is not TomlTable;
        var hasConditional = table.TryGetValue("if", out var conditionalSelector)
            && conditionalSelector is TomlTable conditionalTable
            && IsConditionalProperty(conditionalTable);

        var format = GetString(table, "format");
        if (format != null)
        {
            if (type != SchemaType.String || reference != null)
                throw new InvalidOperationException($"{location} format is valid only with a locally selected built-in string type");
            if (!StringFormatValidator.IsSupported(format))
                throw new InvalidOperationException($"{location} contains unknown string format: {format}");
        }

        // Enforce allowed keys based on definition type
        foreach (var key in table.Keys)
        {
            if (!DefinitionKeys.Contains(key) && !IsPotentialChild(table, key))
                throw new InvalidOperationException($"{location} contains unsupported property: {key}");

            if (reference != null && !NamedReferenceKeys.Contains(key) && !IsPotentialChild(table, key))
                throw new InvalidOperationException($"{location} (named reference) cannot define {key}");

            if (hasOneOf || hasAnyOf)
            {
                if (!UnionKeys.Contains(key) && !IsPotentialChild(table, key))
                    throw new InvalidOperationException($"{location} (union) cannot define {key}");
            }

            if (hasConditional)
            {
                if (!ConditionalKeys.Contains(key) && !IsPotentialChild(table, key))
                    throw new InvalidOperationException($"{location} (conditional) cannot define {key}");
            }
        }

        var children = new Dictionary<string, SchemaDefinition>();
        var hasEscapeNamespace = table.TryGetValue("children", out var escapedValue)
            && escapedValue is TomlTable escapedChildren
            && !HasSelectorMarker(escapedChildren);
        if (hasEscapeNamespace)
        {
            var escapeTable = (TomlTable)escapedValue!;
            if (escapeTable.Count == 0)
                throw new InvalidOperationException($"{location} children escape namespace must not be empty");

            foreach (var (key, value) in escapeTable)
            {
                if (!DefinitionKeys.Contains(key) && key != "children")
                    throw new InvalidOperationException(
                        $"{location} children escape namespace contains non-conflicting child: {key}");
                if (value is not TomlTable childTable)
                    throw new InvalidOperationException(
                        $"{location}.children.{key} must be a child definition table");

                children[key] = ParseDefinition($"{location}.{key}", childTable);
            }
        }

        foreach (var (key, value) in table)
        {
            if (key == "children" && hasEscapeNamespace)
                continue;
            if (DefinitionKeys.Contains(key)
                && (value is not TomlTable definitionTable
                    || IsTableValuedProperty(key, definitionTable)))
                continue;

            if (value is TomlTable childTable)
            {
                if (children.ContainsKey(key))
                    throw new InvalidOperationException($"{location} defines child {key} more than once");
                children[key] = ParseDefinition($"{location}.{key}", childTable);
            }
        }

        var oneOf = table.TryGetValue("oneof", out var oneOfValue) && oneOfValue is TomlArray oneOfArray
            ? oneOfArray.Cast<string>().ToList()
            : null;

        var anyOf = table.TryGetValue("anyof", out var anyOfValue) && anyOfValue is TomlArray anyOfArray
            ? anyOfArray.Cast<string>().ToList()
            : null;

        var allOf = table.TryGetValue("allof", out var allOfValue) && allOfValue is TomlArray allOfArray
            ? allOfArray.Cast<string>().ToList()
            : null;

        var condition = ParseCondition(location, table);

        var allowedValues = table.TryGetValue("allowedvalues", out var avValue) && avValue is TomlArray avArray
            ? avArray.Cast<object?>().ToList()
            : null;
        var defaultValue = GetValue(table, "default");

        if (format != null)
        {
            if (allowedValues != null)
            {
                foreach (var allowedValue in allowedValues)
                {
                    if (allowedValue is not string text || !StringFormatValidator.IsValid(format, text))
                        throw new InvalidOperationException(
                            $"{location}.allowedvalues contains a value that does not satisfy format {format}");
                }
            }
            if (table.ContainsKey("default")
                && (defaultValue is not string defaultText
                    || !StringFormatValidator.IsValid(format, defaultText)))
                throw new InvalidOperationException(
                    $"{location}.default does not satisfy format {format}");
            if (defaultValue is string formattedDefault
                && allowedValues != null
                && !allowedValues.OfType<string>().Contains(formattedDefault, StringComparer.Ordinal))
                throw new InvalidOperationException(
                    $"{location}.default is not included in allowedvalues");
        }

        var mutuallyExclusive = table.TryGetValue("mutuallyexclusive", out var meValue) && meValue is TomlArray meArray
            ? ParseNameGroups(meArray)
            : null;

        var exactlyOne = table.TryGetValue("exactlyone", out var eoValue) && eoValue is TomlArray eoArray
            ? ParseNameGroups(eoArray)
            : null;

        return new SchemaDefinition
        {
            Type = type,
            Reference = reference,
            Description = GetString(table, "description"),
            ItemType = GetString(table, "itemtype"),
            Items = GetStringArray(table, "items"),
            AllowedValues = allowedValues,
            Pattern = GetString(table, "pattern"),
            Format = format,
            KeyPattern = GetString(table, "keypattern"),
            Optional = GetBool(table, "optional") ?? false,
            Min = GetNumber(table, "min"),
            Max = GetNumber(table, "max"),
            MinLength = GetInt(table, "minlength"),
            MaxLength = GetInt(table, "maxlength"),
            UniqueItems = GetBool(table, "uniqueitems"),
            OneOf = oneOf,
            AnyOf = anyOf,
            AllOf = allOf,
            Default = defaultValue,
            Deprecated = GetBool(table, "deprecated") ?? false,
            Condition = condition,
            Children = children,
            DependentRequired = GetStringArray(table, "dependentrequired"),
            MutuallyExclusive = mutuallyExclusive,
            ExactlyOne = exactlyOne
        };
    }

    private SchemaCondition? ParseCondition(string location, TomlTable table)
    {
        if (!table.TryGetValue("if", out var ifValue)
            || ifValue is not TomlTable ifTable
            || !IsConditionalProperty(ifTable))
            return null;

        var key = GetString(ifTable, "key");
        if (string.IsNullOrEmpty(key))
            throw new InvalidOperationException($"{location} conditional if clause must have 'key'");

        var hasEquals = ifTable.ContainsKey("equals");
        var hasIn = ifTable.ContainsKey("in");
        if (!hasEquals && !hasIn)
            throw new InvalidOperationException($"{location} conditional if clause must have 'equals' or 'in'");

        var equalsValue = hasEquals ? GetValue(ifTable, "equals") : null;
        var inValues = hasIn && ifTable.TryGetValue("in", out var inValue) && inValue is TomlArray inArray
            ? inArray.Cast<object>().ToList()
            : null;

        var thenType = GetString(table, "then");
        var elseType = GetString(table, "else");

        return new SchemaCondition
        {
            IfKey = key,
            IfEquals = equalsValue,
            IfIn = inValues,
            ThenType = thenType,
            ElseType = elseType
        };
    }

    private bool IsPotentialChild(TomlTable table, string key)
    {
        return table.TryGetValue(key, out var value) && value is TomlTable;
    }

    private static bool HasSelectorMarker(TomlTable table) =>
        table.TryGetValue("type", out var type) && type is not TomlTable
        || table.TryGetValue("oneof", out var oneOf) && oneOf is not TomlTable
        || table.TryGetValue("anyof", out var anyOf) && anyOf is not TomlTable
        || table.TryGetValue("if", out var condition) && condition is TomlTable conditionTable
            && IsConditionalProperty(conditionTable);

    private static bool IsConditionalProperty(TomlTable table) =>
        table.ContainsKey("key")
        && (table.ContainsKey("equals") || table.ContainsKey("in"));

    private static bool IsTableValuedProperty(string key, TomlTable table) =>
        key switch
        {
            "if" => IsConditionalProperty(table),
            "default" or "dependentrequired" => !HasSelectorMarker(table),
            _ => false
        };

    private static List<List<string>> ParseNameGroups(TomlArray values) =>
        values.All(value => value is string)
            ? [values.Cast<string>().ToList()]
            : values.Cast<object>().OfType<TomlArray>().Select(group => group.Cast<string>().ToList()).ToList();

    private string? GetString(TomlTable table, string key)
    {
        if (!table.TryGetValue(key, out var value))
            return null;

        if (value is TomlTable)
            return null;

        return value as string ?? throw new InvalidOperationException($"{key} must be a string");
    }

    private bool? GetBool(TomlTable table, string key) =>
        table.TryGetValue(key, out var value) && value is bool b ? b : null;

    private long? GetInt(TomlTable table, string key) =>
        table.TryGetValue(key, out var value) && value is long l ? l : null;

    private double? GetNumber(TomlTable table, string key)
    {
        if (!table.TryGetValue(key, out var value))
            return null;

        return value is long l ? (double)l : value is double d ? d : null;
    }

    private object? GetValue(TomlTable table, string key) =>
        table.TryGetValue(key, out var value) ? value : null;

    private List<string>? GetStringArray(TomlTable table, string key)
    {
        if (!table.TryGetValue(key, out var value) || value is not TomlArray arr)
            return null;

        return arr.Cast<string>().ToList();
    }
}
