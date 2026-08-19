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
        "type", "description", "itemtype", "items", "allowedvalues", "pattern", "keypattern",
        "optional", "min", "max", "minlength", "maxlength", "oneof", "anyof", "allof",
        "dependentrequired", "mutuallyexclusive", "exactlyone", "uniqueitems", "default",
        "deprecated", "if", "then", "else"
    };

    /// <summary>Schema properties whose value is a table rather than a child definition</summary>
    private static readonly HashSet<string> TableValuedKeys = new()
    {
        "if", "dependentrequired", "default"
    };

    /// <summary>Keys allowed on a definition whose type selects a named type reference</summary>
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

    /// <summary>
    /// Normalizes a type reference by stripping the reserved <c>types.</c> prefix.
    /// </summary>
    internal static string NormalizeReference(string reference) =>
        reference.StartsWith("types.", StringComparison.Ordinal) ? reference["types.".Length..] : reference;

    private TomlSchema LoadSchema(string schemaPath)
    {
        if (!File.Exists(schemaPath))
            throw new FileNotFoundException($"Schema file not found: {schemaPath}");

        var content = File.ReadAllText(schemaPath);
        var schemaDoc = ParseToml(content);

        var version = ValidateTopLevel(schemaDoc);

        var types = ParseDefinitions("types", schemaDoc, required: false);
        var elements = ParseDefinitions("elements", schemaDoc, required: true);

        return new TomlSchema(version, types, elements);
    }

    private string ValidateTopLevel(TomlTable schemaDoc)
    {
        foreach (var key in schemaDoc.Keys)
        {
            if (key != "toml-schema" && key != "types" && key != "elements")
                throw new InvalidOperationException($"Unsupported top-level schema key: {key}");
        }

        if (!schemaDoc.TryGetValue("toml-schema", out var metadataValue) || metadataValue is not TomlTable metadata)
            throw new InvalidOperationException("Schema must contain a [toml-schema] table");

        foreach (var key in metadata.Keys)
        {
            if (key != "version" && key != "meta")
                throw new InvalidOperationException($"Unsupported [toml-schema] key: {key}");
        }

        if (!metadata.TryGetValue("version", out var versionValue) || versionValue is not string version)
            throw new InvalidOperationException("[toml-schema].version must be a string");

        if (!SemVerPattern.IsMatch(version))
            throw new InvalidOperationException($"[toml-schema].version must be valid SemVer 2.0.0: {version}");

        if (!version.StartsWith("1.", StringComparison.Ordinal))
            throw new InvalidOperationException($"Unsupported schema version: {version} (requires 1.x.x)");

        return version;
    }

    private Dictionary<string, SchemaDefinition> ParseDefinitions(string prefix, TomlTable schemaDoc, bool required)
    {
        if (!schemaDoc.TryGetValue(prefix, out var value) || value is not TomlTable table)
        {
            if (required)
                throw new InvalidOperationException($"Missing required [{prefix}] table");
            return new Dictionary<string, SchemaDefinition>();
        }

        var definitions = new Dictionary<string, SchemaDefinition>();
        foreach (var (key, definitionValue) in table)
        {
            if (prefix == "types")
            {
                if (SchemaTypeExtensions.TryFromSchemaName(key, out _))
                    throw new InvalidOperationException($"[types.{key}] uses a reserved built-in type name");
                if (key.StartsWith("types.", StringComparison.Ordinal))
                    throw new InvalidOperationException($"[types.{key}] uses the reserved type-reference prefix");
            }

            if (definitionValue is not TomlTable definitionTable)
                throw new InvalidOperationException($"[{prefix}] entry must be a table: {key}");

            definitions[key] = ParseDefinition($"{prefix}.{key}", definitionTable);
        }

        return definitions;
    }

    private SchemaDefinition ParseDefinition(string name, TomlTable table)
    {
        var typeSelector = GetString(name, table, "type");
        SchemaType? type = null;
        string? reference = null;
        if (typeSelector != null)
        {
            if (SchemaTypeExtensions.TryFromSchemaName(typeSelector, out var builtIn))
                type = builtIn;
            else
                reference = NormalizeReference(typeSelector);
        }

        if (reference != null)
        {
            foreach (var (key, keyValue) in table)
            {
                if (IsProperty(key, keyValue) && !NamedReferenceKeys.Contains(key))
                    throw new InvalidOperationException($"{name} named type reference cannot define {key}");
            }
        }

        var description = GetString(name, table, "description");
        var itemType = GetString(name, table, "itemtype") is { } rawItemType
            ? NormalizeReference(rawItemType)
            : null;
        var items = GetStringArray(name, table, "items")?.Select(NormalizeReference).ToList();
        if (items != null && items.Count == 0)
            throw new InvalidOperationException($"{name} items must contain at least one type reference");

        var oneOf = GetStringArray(name, table, "oneof")?.Select(NormalizeReference).ToList();
        if (oneOf != null && oneOf.Count == 0)
            throw new InvalidOperationException($"{name} oneof must contain at least one type reference");

        var anyOf = GetStringArray(name, table, "anyof")?.Select(NormalizeReference).ToList();
        if (anyOf != null && anyOf.Count == 0)
            throw new InvalidOperationException($"{name} anyof must contain at least one type reference");

        var allOf = GetStringArray(name, table, "allof")?.Select(NormalizeReference).ToList();
        if (allOf != null && allOf.Count == 0)
            throw new InvalidOperationException($"{name} allof must contain at least one type reference");

        var allowedValues = GetArray(name, table, "allowedvalues");
        if (allowedValues != null && allowedValues.Count == 0)
            throw new InvalidOperationException($"{name} allowedvalues must contain at least one entry");

        var pattern = GetPattern(name, table, "pattern");
        var keyPattern = GetPattern(name, table, "keypattern");
        var optional = GetBool(name, table, "optional") ?? false;
        var deprecated = GetBool(name, table, "deprecated") ?? false;
        var uniqueItems = GetBool(name, table, "uniqueitems");
        var minLength = GetInt(name, table, "minlength");
        var maxLength = GetInt(name, table, "maxlength");
        var min = GetValue(table, "min");
        var max = GetValue(table, "max");
        var condition = ParseCondition(name, table);
        var dependentRequired = GetDependentRequired(name, table);
        var mutuallyExclusive = GetNameGroups(name, table, "mutuallyexclusive");
        var exactlyOne = GetNameGroups(name, table, "exactlyone");

        var children = new Dictionary<string, SchemaDefinition>();
        foreach (var (key, value) in table)
        {
            if (IsProperty(key, value))
                continue;

            if (value is TomlTable childTable)
                children[key] = ParseDefinition($"{name}.{key}", childTable);
            else
                throw new InvalidOperationException($"{name} contains unsupported property: {key}");
        }

        var hasUnion = oneOf != null || anyOf != null;
        if (hasUnion)
        {
            foreach (var (key, keyValue) in table)
            {
                if (IsProperty(key, keyValue) && !UnionKeys.Contains(key))
                    throw new InvalidOperationException($"{name} union cannot define {key}");
            }
        }

        if (condition != null)
        {
            foreach (var (key, keyValue) in table)
            {
                if (IsProperty(key, keyValue) && !ConditionalKeys.Contains(key))
                    throw new InvalidOperationException($"{name} conditional cannot define {key}");
            }
        }

        var typeSelectors = (typeSelector == null ? 0 : 1)
            + (oneOf == null ? 0 : 1)
            + (anyOf == null ? 0 : 1)
            + (condition == null ? 0 : 1);
        if (typeSelectors > 1)
            throw new InvalidOperationException(
                $"{name} cannot define more than one of type, oneof, anyof, and if/then/else");

        if (type == null && reference == null && !hasUnion && condition == null)
        {
            if (children.Count == 0)
                throw new InvalidOperationException(
                    $"{name} must define type, oneof, anyof, if/then/else, or child definitions");
            type = SchemaType.Table;
        }

        if (children.Count > 0 && type != SchemaType.Table && type != SchemaType.Collection)
            throw new InvalidOperationException($"{name} can only define children when type is table or collection");

        if (itemType != null && type != SchemaType.Array && type != SchemaType.Collection)
            throw new InvalidOperationException($"{name} can only define itemtype when type is array or collection");

        if (items != null && type != SchemaType.Array)
            throw new InvalidOperationException($"{name} can only define items when type is array");

        if (items != null && itemType != null)
            throw new InvalidOperationException($"{name} cannot define both items and itemtype");

        if (keyPattern != null && type != SchemaType.Collection)
            throw new InvalidOperationException($"{name} can only define keypattern when type is collection");

        if (pattern != null && type != SchemaType.String)
            throw new InvalidOperationException($"{name} can only define pattern when type is string");

        if ((minLength != null || maxLength != null)
            && type != SchemaType.String && type != SchemaType.Array && type != SchemaType.Collection)
            throw new InvalidOperationException(
                $"{name} can only define minlength or maxlength when type is string, array, or collection");

        if (minLength != null && maxLength != null && minLength > maxLength)
            throw new InvalidOperationException($"{name} minlength must not be greater than maxlength");

        if (type == SchemaType.Collection && itemType == null && allOf == null)
            throw new InvalidOperationException($"{name} must define itemtype when type is collection");

        return new SchemaDefinition
        {
            Type = type,
            Reference = reference,
            Description = description,
            ItemType = itemType,
            Items = items,
            AllowedValues = allowedValues,
            Pattern = pattern,
            KeyPattern = keyPattern,
            Optional = optional,
            Min = min,
            Max = max,
            MinLength = minLength,
            MaxLength = maxLength,
            UniqueItems = uniqueItems,
            OneOf = oneOf,
            AnyOf = anyOf,
            AllOf = allOf,
            Default = GetValue(table, "default"),
            Deprecated = deprecated,
            Condition = condition,
            Children = children,
            DependentRequired = dependentRequired,
            MutuallyExclusive = mutuallyExclusive,
            ExactlyOne = exactlyOne
        };
    }

    private static bool IsProperty(string key, object? value)
    {
        if (!DefinitionKeys.Contains(key))
            return false;

        // A schema key holding a table is a child definition unless the schema
        // property itself is table-valued.
        return value is not TomlTable || TableValuedKeys.Contains(key);
    }

    private SchemaCondition? ParseCondition(string name, TomlTable table)
    {
        var ifValue = GetValue(table, "if");
        var hasThen = GetValue(table, "then") != null;
        var hasElse = GetValue(table, "else") != null;
        if (ifValue == null && !hasThen && !hasElse)
            return null;

        if (ifValue is not TomlTable ifTable)
            throw new InvalidOperationException($"{name} if must be a table");

        foreach (var key in ifTable.Keys)
        {
            if (key != "key" && key != "equals" && key != "in")
                throw new InvalidOperationException($"{name} if contains unsupported property: {key}");
        }

        if (!ifTable.TryGetValue("key", out var keyValue) || keyValue is not string key0 || key0.Length == 0)
            throw new InvalidOperationException($"{name} if must define key");

        var hasEquals = ifTable.TryGetValue("equals", out var equalsValue);

        List<object?>? inValues = null;
        if (ifTable.TryGetValue("in", out var inValue))
        {
            inValues = inValue is TomlArray inArray
                ? inArray.Cast<object?>().ToList()
                : throw new InvalidOperationException($"{name} if in must be an array");
        }

        if (hasEquals == (inValues != null))
            throw new InvalidOperationException($"{name} if must define exactly one of equals and in");
        if (inValues != null && inValues.Count == 0)
            throw new InvalidOperationException($"{name} if in must contain at least one value");

        var thenType = GetString(name, table, "then");
        var elseType = GetString(name, table, "else");
        if (thenType == null || elseType == null)
            throw new InvalidOperationException($"{name} must define both then and else");

        return new SchemaCondition
        {
            IfKey = key0,
            IfEquals = hasEquals ? equalsValue : null,
            IfIn = inValues,
            ThenType = NormalizeReference(thenType),
            ElseType = NormalizeReference(elseType)
        };
    }

    private Dictionary<string, List<string>>? GetDependentRequired(string name, TomlTable table)
    {
        var value = GetValue(table, "dependentrequired");
        if (value == null)
            return null;

        if (value is not TomlTable dependencies || dependencies.Count == 0)
            throw new InvalidOperationException($"{name} dependentrequired must be a non-empty inline table");

        var result = new Dictionary<string, List<string>>();
        foreach (var (trigger, required) in dependencies)
        {
            if (required is not TomlArray requiredArray || requiredArray.Count == 0)
                throw new InvalidOperationException(
                    $"{name} dependentrequired.{trigger} must be a non-empty array of names");

            var names = new List<string>();
            foreach (var entry in requiredArray)
            {
                if (entry is not string requiredName)
                    throw new InvalidOperationException(
                        $"{name} dependentrequired.{trigger} must contain strings");
                names.Add(requiredName);
            }
            result[trigger] = names;
        }

        return result;
    }

    private List<List<string>>? GetNameGroups(string name, TomlTable table, string key)
    {
        var value = GetValue(table, key);
        if (value == null)
            return null;

        if (value is not TomlArray groups || groups.Count == 0)
            throw new InvalidOperationException($"{name} {key} must be a non-empty array of groups");

        var result = new List<List<string>>();
        foreach (var group in groups)
        {
            if (group is not TomlArray groupArray || groupArray.Count == 0)
                throw new InvalidOperationException($"{name} {key} groups must be non-empty arrays of names");

            var names = new List<string>();
            foreach (var entry in groupArray)
            {
                if (entry is not string entryName)
                    throw new InvalidOperationException($"{name} {key} groups must contain strings");
                names.Add(entryName);
            }
            result.Add(names);
        }

        return result;
    }

    private string? GetPattern(string name, TomlTable table, string key)
    {
        var pattern = GetString(name, table, key);
        if (pattern == null)
            return null;

        try
        {
            _ = new Regex(pattern);
        }
        catch (ArgumentException error)
        {
            throw new InvalidOperationException($"{name} {key} is not a valid regular expression: {error.Message}");
        }

        return pattern;
    }

    private string? GetString(string name, TomlTable table, string key)
    {
        var value = GetValue(table, key);
        if (value == null)
            return null;

        return value as string
            ?? throw new InvalidOperationException($"{name} {key} must be a string");
    }

    private bool? GetBool(string name, TomlTable table, string key)
    {
        var value = GetValue(table, key);
        if (value == null)
            return null;

        return value is bool boolean
            ? boolean
            : throw new InvalidOperationException($"{name} {key} must be a boolean");
    }

    private long? GetInt(string name, TomlTable table, string key)
    {
        var value = GetValue(table, key);
        if (value == null)
            return null;

        return value is long integer
            ? integer
            : throw new InvalidOperationException($"{name} {key} must be an integer");
    }

    private List<object?>? GetArray(string name, TomlTable table, string key)
    {
        var value = GetValue(table, key);
        if (value == null)
            return null;

        return value is TomlArray array
            ? array.Cast<object?>().ToList()
            : throw new InvalidOperationException($"{name} {key} must be an array");
    }

    private List<string>? GetStringArray(string name, TomlTable table, string key)
    {
        var array = GetArray(name, table, key);
        if (array == null)
            return null;

        var result = new List<string>();
        foreach (var entry in array)
        {
            if (entry is not string text)
                throw new InvalidOperationException($"{name} {key} must contain strings");
            result.Add(text);
        }

        return result;
    }

    private object? GetValue(TomlTable table, string key) =>
        table.TryGetValue(key, out var value) && IsProperty(key, value) ? value : null;
}
