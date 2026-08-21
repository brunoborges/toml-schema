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

        ValidateRangeSemantics(types, elements);
        ValidateDefinitionKinds(types, types);
        ValidateDefinitionKinds(types, elements);
        ValidateMemberConstraintSemantics(types, types);
        ValidateMemberConstraintSemantics(types, elements);
        ValidateSiblingRuleSemantics(types, elements);
        ValidateConditionalSemantics(types, elements);
        return new TomlSchema(version, types, elements);
    }

    private SchemaDefinition ParseDefinition(string location, TomlTable table)
    {
        var typeStr = GetString(table, "type");
        SchemaType? type = null;
        string? reference = null;

        if (typeStr != null)
        {
            var normalizedType = NormalizeReference(typeStr);
            try
            {
                type = SchemaTypeExtensions.FromSchemaName(normalizedType);
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
            if (type is not (SchemaType.String or SchemaType.Array or SchemaType.Collection)
                || reference != null)
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

        ValidateDistinctReferences(location, "oneof", oneOf);
        ValidateDistinctReferences(location, "anyof", anyOf);
        ValidateDistinctReferences(location, "allof", allOf);
        ValidateAlternativeReferences(location, "oneof", oneOf);
        ValidateAlternativeReferences(location, "anyof", anyOf);

        var condition = ParseCondition(location, table);

        var allowedValues = table.TryGetValue("allowedvalues", out var avValue) && avValue is TomlArray avArray
            ? avArray.Cast<object?>().ToList()
            : null;
        var defaultValue = GetValue(table, "default");
        if (condition != null && table.ContainsKey("default") && defaultValue is not TomlTable)
            throw new InvalidOperationException($"{location} conditional default must be a table");

        var pattern = GetString(table, "pattern");
        var keyPattern = GetString(table, "keypattern");
        ValidatePattern(location, "pattern", pattern);
        ValidatePattern(location, "keypattern", keyPattern);

        if (format != null)
        {
            if (type == SchemaType.String && table.ContainsKey("default")
                && (defaultValue is not string defaultText
                    || !StringFormatValidator.IsValid(format, defaultText)))
                throw new InvalidOperationException(
                    $"{location}.default does not satisfy format {format}");
            if (type == SchemaType.String && defaultValue is string formattedDefault
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
        var min = GetRangeValue(table, "min");
        var max = GetRangeValue(table, "max");
        var minLength = GetInt(table, "minlength");
        var maxLength = GetInt(table, "maxlength");
        if (minLength.HasValue && maxLength.HasValue && minLength > maxLength)
            throw new InvalidOperationException(
                $"{location} minlength must not be greater than maxlength");
        ValidateAllowedValuesConstraints(
            location, type, allowedValues, pattern, format, min, max, minLength, maxLength);
        if (children.Count == 0 && type == null && reference == null
            && !hasOneOf && !hasAnyOf && !hasConditional && (allOf?.Count ?? 0) == 0)
            throw new InvalidOperationException(
                $"{location} must define type, oneof, anyof, if/then/else, or child definitions");
        if ((table.TryGetValue("items", out var tupleItems) && tupleItems is TomlArray)
            && (allowedValues != null || min != null || max != null || pattern != null || format != null))
            throw new InvalidOperationException(
                $"{location} cannot combine items with per-member constraints");

        return new SchemaDefinition
        {
            Name = location,
            Type = type,
            Reference = reference,
            Description = GetString(table, "description"),
            ItemType = GetString(table, "itemtype"),
            Items = GetStringArray(table, "items"),
            AllowedValues = allowedValues,
            Pattern = pattern,
            Format = format,
            KeyPattern = keyPattern,
            Optional = GetBool(table, "optional") ?? false,
            Min = min,
            Max = max,
            MinLength = minLength,
            MaxLength = maxLength,
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

    private object? GetValue(TomlTable table, string key) =>
        table.TryGetValue(key, out var value) ? value : null;

    private object? GetRangeValue(TomlTable table, string key) =>
        table.TryGetValue(key, out var value) && value is not TomlTable ? value : null;

    private List<string>? GetStringArray(TomlTable table, string key)
    {
        if (!table.TryGetValue(key, out var value) || value is not TomlArray arr)
            return null;

        return arr.Cast<string>().ToList();
    }

    private static void ValidateDistinctReferences(
        string location,
        string property,
        IReadOnlyList<string>? references)
    {
        if (references == null)
            return;

        var seen = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var reference in references)
        {
            var resolved = reference.StartsWith("types.", StringComparison.Ordinal)
                ? reference["types.".Length..]
                : reference;
            if (seen.TryGetValue(resolved, out var first))
                throw new InvalidOperationException(
                    $"{location} {property} contains duplicate type references \"{first}\" and \"{reference}\"; both resolve to {resolved}");
            seen[resolved] = reference;
        }
    }

    private static void ValidateAlternativeReferences(
        string location,
        string property,
        IReadOnlyList<string>? references)
    {
        foreach (var reference in references ?? [])
        {
            var normalized = NormalizeReference(reference);
            if (normalized == "any")
                throw new InvalidOperationException(
                    $"{location} cannot use any directly in {property}");
            if (normalized == "collection")
                throw new InvalidOperationException(
                    $"{location} cannot use collection as a bare {property} reference");
        }
    }

    private static void ValidatePattern(string location, string property, string? pattern)
    {
        if (pattern == null)
            return;
        var inCharacterClass = false;
        for (var index = 0; index < pattern.Length; index++)
        {
            var current = pattern[index];
            if (current == '\\' && index + 1 < pattern.Length)
            {
                var escaped = pattern[index + 1];
                if (!@"\.^$*+?()[]{}|-tnrfva".Contains(escaped))
                    throw new InvalidOperationException(
                        $"unsupported-pattern: {location} {property} uses non-portable escape \\{escaped}");
                index++;
            }
            else if (current == '[')
            {
                inCharacterClass = true;
            }
            else if (current == ']')
            {
                inCharacterClass = false;
            }
            else if (!inCharacterClass && current == '(' && index + 1 < pattern.Length
                && pattern[index + 1] == '?'
                && (index + 2 >= pattern.Length || pattern[index + 2] != ':'))
            {
                throw new InvalidOperationException(
                    $"unsupported-pattern: {location} {property} uses non-portable group syntax");
            }
            else if (!inCharacterClass && "?*+}".Contains(current) && index + 1 < pattern.Length
                && "?+".Contains(pattern[index + 1]))
            {
                throw new InvalidOperationException(
                    $"unsupported-pattern: {location} {property} uses a non-greedy or possessive quantifier");
            }
        }
        try
        {
            _ = new Regex(pattern, RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
        }
        catch (ArgumentException exception)
        {
            throw new InvalidOperationException(
                $"invalid-pattern: {location} has invalid {property}: {exception.Message}", exception);
        }
    }

    private static void ValidateSiblingRuleSemantics(
        IReadOnlyDictionary<string, SchemaDefinition> types,
        IReadOnlyDictionary<string, SchemaDefinition> elements)
    {
        foreach (var definition in types.Values.Concat(elements.Values))
            ValidateSiblingRuleDefinition(definition, types);
    }

    private static void ValidateConditionalSemantics(
        IReadOnlyDictionary<string, SchemaDefinition> types,
        IReadOnlyDictionary<string, SchemaDefinition> elements)
    {
        foreach (var definition in types.Values.Concat(elements.Values))
            ValidateConditionalDefinition(definition, types);
    }

    private static void ValidateConditionalDefinition(
        SchemaDefinition definition,
        IReadOnlyDictionary<string, SchemaDefinition> types)
    {
        if (definition.Condition != null)
        {
            foreach (var (property, reference) in new[]
            {
                ("then", definition.Condition.ThenType),
                ("else", definition.Condition.ElseType)
            })
            {
                if (string.IsNullOrWhiteSpace(reference))
                    throw new InvalidOperationException(
                        $"{definition.Name} {property} must be a named reusable type reference");
                var normalized = NormalizeReference(reference);
                if (SchemaTypeExtensions.AllTypeNames.Contains(normalized))
                    throw new InvalidOperationException(
                        $"{definition.Name} {property} must be a named reusable type reference");
                var branch = types.TryGetValue(normalized, out var target)
                    ? target
                    : throw new InvalidOperationException(
                        $"{definition.Name} contains unknown type reference: {reference}");
                if (EffectiveKind(branch, types, new HashSet<string>()) == SchemaType.Collection)
                    continue;
                var fixedChildren =
                    DeterminateFixedChildren(branch, types, new HashSet<string>());
                if (fixedChildren.Count > 0
                    && !fixedChildren.Contains(definition.Condition.IfKey))
                    throw new InvalidOperationException(
                        $"{definition.Name} {property} branch has a non-empty determinate fixed-child set that omits discriminator \"{definition.Condition.IfKey}\"");
            }
        }
        foreach (var child in definition.Children.Values)
            ValidateConditionalDefinition(child, types);
    }

    private static void ValidateRangeSemantics(
        IReadOnlyDictionary<string, SchemaDefinition> types,
        IReadOnlyDictionary<string, SchemaDefinition> elements)
    {
        foreach (var definition in types.Values.Concat(elements.Values))
            ValidateRangeDefinition(definition, types);
    }

    private static void ValidateRangeDefinition(
        SchemaDefinition definition,
        IReadOnlyDictionary<string, SchemaDefinition> types)
    {
        if (definition.Min != null || definition.Max != null)
        {
            var comparableKind = definition.Type is SchemaType.Array or SchemaType.Collection
                ? ResolveItemKind(definition.ItemType, types)
                : definition.Type;
            if (comparableKind is not (SchemaType.Integer or SchemaType.Float
                or SchemaType.OffsetDateTime or SchemaType.LocalDateTime
                or SchemaType.LocalDate or SchemaType.LocalTime))
                throw new InvalidOperationException(
                    $"{definition.Name} can only define min or max for integer, float, date/time, or compatible array types");
            ValidateBoundary(definition.Name!, definition.Min, "min", comparableKind.Value);
            ValidateBoundary(definition.Name!, definition.Max, "max", comparableKind.Value);
            if (definition.Min != null && definition.Max != null
                && ValueSemantics.Compare(definition.Min, definition.Max) > 0)
                throw new InvalidOperationException(
                    $"{definition.Name} min must not be greater than max");
        }
        foreach (var child in definition.Children.Values)
            ValidateRangeDefinition(child, types);
    }

    private static SchemaType? ResolveItemKind(
        string? reference,
        IReadOnlyDictionary<string, SchemaDefinition> types)
    {
        if (string.IsNullOrEmpty(reference))
            return null;
        if (SchemaTypeExtensions.AllTypeNames.Contains(reference))
            return SchemaTypeExtensions.FromSchemaName(reference);
        var normalized = NormalizeReference(reference);
        return types.TryGetValue(normalized, out var target)
            ? EffectiveKind(target, types, new HashSet<string>())
            : null;
    }

    private static void ValidateAllowedValuesConstraints(
        string location,
        SchemaType? type,
        List<object?>? allowedValues,
        string? pattern,
        string? format,
        object? min,
        object? max,
        long? minLength,
        long? maxLength)
    {
        if (allowedValues == null || allowedValues.Count == 0)
            return;
        var isContainer = type is SchemaType.Array or SchemaType.Collection;
        for (var index = 0; index < allowedValues.Count; index++)
        {
            var allowed = allowedValues[index];
            var entry = $"{location} allowedvalues[{index}]";
            if (pattern != null
                && (allowed is not string patternText || !Regex.IsMatch(patternText, pattern)))
                throw new InvalidOperationException($"{entry} does not satisfy pattern");
            if (format != null
                && (allowed is not string formatText || !StringFormatValidator.IsValid(format, formatText)))
                throw new InvalidOperationException($"{entry} does not satisfy format {format}");
            if ((min != null || max != null) && allowed is double nan && double.IsNaN(nan))
                throw new InvalidOperationException($"{entry} does not satisfy min or max");
            if (min != null && allowed != null && ValueSemantics.Compare(allowed, min) < 0)
                throw new InvalidOperationException($"{entry} is less than min");
            if (max != null && allowed != null && ValueSemantics.Compare(allowed, max) > 0)
                throw new InvalidOperationException($"{entry} is greater than max");
            if (!isContainer && (minLength.HasValue || maxLength.HasValue))
            {
                if (allowed is not string lengthText)
                    throw new InvalidOperationException($"{entry} does not satisfy string length constraints");
                var length = lengthText.EnumerateRunes().Count();
                if (minLength.HasValue && length < minLength)
                    throw new InvalidOperationException($"{entry} is shorter than minlength");
                if (maxLength.HasValue && length > maxLength)
                    throw new InvalidOperationException($"{entry} is longer than maxlength");
            }
        }
    }

    private static void ValidateBoundary(
        string name,
        object? boundary,
        string key,
        SchemaType comparableKind)
    {
        if (boundary == null)
            return;
        if (boundary is double value && double.IsNaN(value))
            throw new InvalidOperationException($"{name} cannot use NaN as {key}");
        if (comparableKind == SchemaType.Integer
            && boundary is double infinity && double.IsInfinity(infinity))
            throw new InvalidOperationException(
                $"{name} cannot use infinity as {key} when comparable kind is integer");
        if (!ValueSemantics.MatchesComparableKind(boundary, comparableKind))
            throw new InvalidOperationException(
                $"{name} {key} must be comparable with {comparableKind.ToString().ToLowerInvariant()}");
    }

    private static void ValidateSiblingRuleDefinition(
        SchemaDefinition definition,
        IReadOnlyDictionary<string, SchemaDefinition> types)
    {
        var hasRules = definition.DependentRequired?.Count > 0
            || definition.MutuallyExclusive?.Count > 0
            || definition.ExactlyOne?.Count > 0;
        if (hasRules)
        {
            var kind = EffectiveKind(definition, types, new HashSet<string>());
            if (kind is not SchemaType.Table and not SchemaType.Collection)
                throw new InvalidOperationException("sibling rules require an effective table or collection");

            var fixedChildren = DeterminateFixedChildren(definition, types, new HashSet<string>());
            foreach (var operand in definition.DependentRequired ?? [])
                ValidateSiblingOperand("dependentrequired", operand, fixedChildren);
            foreach (var (property, groups) in new[]
            {
                ("mutuallyexclusive", definition.MutuallyExclusive ?? []),
                ("exactlyone", definition.ExactlyOne ?? [])
            })
            {
                foreach (var operand in groups.SelectMany(group => group))
                    ValidateSiblingOperand(property, operand, fixedChildren);
            }
        }
        foreach (var child in definition.Children.Values)
            ValidateSiblingRuleDefinition(child, types);
    }

    private static void ValidateSiblingOperand(
        string property,
        string operand,
        IReadOnlySet<string> fixedChildren)
    {
        if (!fixedChildren.Contains(operand))
            throw new InvalidOperationException(
                $"{property} contains unknown fixed child \"{operand}\"");
    }

    private static HashSet<string> DeterminateFixedChildren(
        SchemaDefinition definition,
        IReadOnlyDictionary<string, SchemaDefinition> types,
        HashSet<string> visiting)
    {
        var children = new HashSet<string>(definition.Children.Keys);
        if (definition.Reference != null)
            children.UnionWith(DeterminateReferenceFixedChildren(definition.Reference, types, visiting));
        foreach (var component in definition.AllOf ?? [])
            children.UnionWith(DeterminateReferenceFixedChildren(component, types, visiting));
        return children;
    }

    private static HashSet<string> DeterminateReferenceFixedChildren(
        string reference,
        IReadOnlyDictionary<string, SchemaDefinition> types,
        HashSet<string> visiting)
    {
        if (SchemaTypeExtensions.AllTypeNames.Contains(reference))
            return [];
        var normalized = NormalizeReference(reference);
        if (!visiting.Add(normalized))
            throw new InvalidOperationException($"cyclic type reference: {normalized}");
        try
        {
            var target = types.TryGetValue(normalized, out var definition)
                ? definition
                : throw new InvalidOperationException($"unknown type reference: {reference}");
            return DeterminateFixedChildren(target, types, visiting);
        }
        finally
        {
            visiting.Remove(normalized);
        }
    }

    private static SchemaType? EffectiveKind(
        SchemaDefinition definition,
        IReadOnlyDictionary<string, SchemaDefinition> types,
        HashSet<string> visiting)
    {
        if (definition.Type != null)
            return definition.Type;
        if (definition.Reference != null)
        {
            var normalized = NormalizeReference(definition.Reference);
            if (!visiting.Add(normalized))
                throw new InvalidOperationException($"cyclic type reference: {normalized}");
            try
            {
                return types.TryGetValue(normalized, out var target)
                    ? EffectiveKind(target, types, visiting)
                    : throw new InvalidOperationException($"unknown type reference: {definition.Reference}");
            }
            finally
            {
                visiting.Remove(normalized);
            }
        }
        var references = definition.OneOf?.Count > 0
            ? definition.OneOf
            : definition.AnyOf?.Count > 0
                ? definition.AnyOf
                : definition.Condition == null
                    ? null
                    : [definition.Condition.ThenType!, definition.Condition.ElseType!];
        if (references == null)
        {
            if ((definition.AllOf?.Count ?? 0) == 0)
                return null;
            var componentKinds = definition.AllOf!.Select(reference =>
            {
                if (SchemaTypeExtensions.AllTypeNames.Contains(reference))
                    return SchemaTypeExtensions.FromSchemaName(reference);
                var normalized = NormalizeReference(reference);
                return types.TryGetValue(normalized, out var target)
                    ? EffectiveKind(target, types, new HashSet<string>(visiting))
                    : throw new InvalidOperationException($"unknown type reference: {reference}");
            }).Distinct().ToList();
            if (componentKinds.Count != 1 || componentKinds[0] is null or SchemaType.Any)
                throw new InvalidOperationException(
                    $"{definition.Name} allof components must resolve to one determinate effective kind");
            return componentKinds[0];
        }
        var kinds = references.Select(reference =>
        {
            if (SchemaTypeExtensions.AllTypeNames.Contains(reference))
                return SchemaTypeExtensions.FromSchemaName(reference);
            var normalized = NormalizeReference(reference);
            return types.TryGetValue(normalized, out var target)
                ? EffectiveKind(target, types, new HashSet<string>(visiting))
                : throw new InvalidOperationException($"unknown type reference: {reference}");
        }).Distinct().ToList();
        return kinds.Count == 1 ? kinds[0] : null;
    }

    private static void ValidateDefinitionKinds(
        IReadOnlyDictionary<string, SchemaDefinition> types,
        IReadOnlyDictionary<string, SchemaDefinition> definitions)
    {
        foreach (var definition in definitions.Values)
        {
            if ((definition.AllOf?.Count ?? 0) > 0)
            {
                var kind = EffectiveKind(definition, types, new HashSet<string>());
                foreach (var reference in definition.AllOf!)
                {
                    var component = SchemaTypeExtensions.AllTypeNames.Contains(reference)
                        ? SchemaTypeExtensions.FromSchemaName(reference)
                        : types.TryGetValue(NormalizeReference(reference), out var target)
                            ? EffectiveKind(target, types, new HashSet<string>())
                            : throw new InvalidOperationException($"unknown type reference: {reference}");
                    if (kind == null || component == null || component == SchemaType.Any || component != kind)
                        throw new InvalidOperationException(
                            $"{definition.Name} allof components must resolve to one determinate effective kind");
                }
            }
            ValidateDefinitionKinds(types, definition.Children);
        }
    }

    private static void ValidateMemberConstraintSemantics(
        IReadOnlyDictionary<string, SchemaDefinition> types,
        IReadOnlyDictionary<string, SchemaDefinition> definitions)
    {
        foreach (var definition in definitions.Values)
        {
            if (definition.Type is SchemaType.Array or SchemaType.Collection)
            {
                if (definition.Pattern != null || definition.Format != null)
                {
                    if (ResolveItemKind(definition.ItemType, types) != SchemaType.String)
                        throw new InvalidOperationException(
                            $"{definition.Name} can only define pattern or format when itemtype resolves to string");
                }
                foreach (var (property, present) in new[]
                {
                    ("allowedvalues", definition.AllowedValues?.Count > 0),
                    ("min", definition.Min != null),
                    ("max", definition.Max != null),
                    ("pattern", definition.Pattern != null),
                    ("format", definition.Format != null)
                })
                {
                    if (present && definition.ItemType != null
                        && ReferenceHasConstraint(
                            definition.ItemType, property, types, new HashSet<string>()))
                        throw new InvalidOperationException(
                            $"{definition.Name} defines {property} both inline and on its resolved itemtype");
                }
            }
            ValidateMemberConstraintSemantics(types, definition.Children);
        }
    }

    private static bool ReferenceHasConstraint(
        string reference,
        string property,
        IReadOnlyDictionary<string, SchemaDefinition> types,
        HashSet<string> visiting)
    {
        if (SchemaTypeExtensions.AllTypeNames.Contains(reference))
            return false;
        var normalized = NormalizeReference(reference);
        if (!visiting.Add(normalized))
            throw new InvalidOperationException($"cyclic type reference: {normalized}");
        try
        {
            var definition = types.TryGetValue(normalized, out var target)
                ? target
                : throw new InvalidOperationException($"unknown type reference: {reference}");
            var local = property switch
            {
                "allowedvalues" => definition.AllowedValues?.Count > 0,
                "min" => definition.Min != null,
                "max" => definition.Max != null,
                "pattern" => definition.Pattern != null,
                "format" => definition.Format != null,
                _ => false
            };
            if (local)
                return true;
            var references = new List<string>();
            if (definition.Reference != null) references.Add(definition.Reference);
            references.AddRange(definition.OneOf ?? []);
            references.AddRange(definition.AnyOf ?? []);
            if (definition.Condition != null)
            {
                references.Add(definition.Condition.ThenType!);
                references.Add(definition.Condition.ElseType!);
            }
            return references.Any(nested =>
                ReferenceHasConstraint(nested, property, types, visiting));
        }
        finally
        {
            visiting.Remove(normalized);
        }
    }

    private static string NormalizeReference(string reference) =>
        reference.StartsWith("types.", StringComparison.Ordinal)
            ? reference["types.".Length..]
            : reference;
}
