namespace TomlSchema;

using Tomlyn;
using Tomlyn.Model;
using System.Text.RegularExpressions;
using System.Globalization;

/// <summary>
/// Validates TOML documents against a schema.
/// </summary>
internal class SchemaValidator
{
    private readonly TomlSchema _schema;
    private readonly List<ValidationError> _errors = new();
    private readonly List<ValidationWarning> _warnings = new();

    public SchemaValidator(TomlSchema schema)
    {
        _schema = schema ?? throw new ArgumentNullException(nameof(schema));
    }

    public ValidationResult Validate(TomlTable document)
    {
        // Remove [toml-schema] metadata for validation
        var workDoc = new TomlTable();
        foreach (var kvp in document.Where(x => x.Key != "toml-schema"))
        {
            workDoc[kvp.Key] = kvp.Value;
        }
        
        foreach (var (key, schemaElem) in _schema.Elements)
        {
            if (workDoc.TryGetValue(key, out var value))
            {
                ValidateElement(key, value, schemaElem, "(root)");
            }
            else if (!schemaElem.Optional)
            {
                _errors.Add(new ValidationError($"(root).{key}", $"Missing required element: {key}", "missing-element"));
            }
        }

        return new ValidationResult(_errors.AsReadOnly(), _warnings.AsReadOnly());
    }

    private void ValidateElement(string name, object? value, SchemaDefinition schema, string path)
    {
        string elemPath = path == "(root)" ? $"{path}.{name}" : $"{path}.{name}";

        // Handle conditionals
        if (schema.Condition != null)
        {
            if (MatchesCondition(value, schema.Condition.If))
            {
                if (schema.Condition.Then != null)
                {
                    ValidateType(value, schema.Condition.Then, elemPath);
                }
            }
            else if (schema.Condition.Else != null)
            {
                ValidateType(value, schema.Condition.Else, elemPath);
            }
            return;
        }

        ValidateType(value, schema, elemPath);
    }

    private void ValidateType(object? value, SchemaDefinition schema, string path)
    {
        // Check null/missing
        if (value == null)
        {
            if (!schema.Optional)
                _errors.Add(new ValidationError(path, "Value is required", "required"));
            return;
        }

        // Emit deprecation warning
        if (schema.Deprecated)
        {
            _warnings.Add(new ValidationWarning(path, "Element is deprecated", "deprecated"));
        }

        var actualType = GetValueType(value);

        // Handle unions
        if (schema.OneOf != null && schema.OneOf.Count > 0)
        {
            if (!ValidateOneOf(value, schema.OneOf, path))
                _errors.Add(new ValidationError(path, $"Value does not match any of the allowed types", "oneof-mismatch"));
            return;
        }

        if (schema.AnyOf != null && schema.AnyOf.Count > 0)
        {
            if (!ValidateAnyOf(value, schema.AnyOf, path))
                _errors.Add(new ValidationError(path, $"Value does not match any of the allowed types", "anyof-mismatch"));
            return;
        }

        // Type validation
        if (!TypeMatches(actualType, schema.Type))
        {
            _errors.Add(new ValidationError(path, $"Expected {schema.Type}, got {actualType}", "type-mismatch"));
            return;
        }

        // Allowed values
        if (schema.AllowedValues != null && schema.AllowedValues.Count > 0)
        {
            if (!schema.AllowedValues.Any(av => ValueEquals(av, value)))
            {
                _errors.Add(new ValidationError(path, $"Value not in allowed values", "invalid-value"));
                return;
            }
        }

        // String constraints
        if (schema.Type == SchemaType.String && value is string strVal)
        {
            if (schema.MinLength.HasValue && strVal.Length < schema.MinLength)
                _errors.Add(new ValidationError(path, $"String too short (min {schema.MinLength})", "min-length"));

            if (schema.MaxLength.HasValue && strVal.Length > schema.MaxLength)
                _errors.Add(new ValidationError(path, $"String too long (max {schema.MaxLength})", "max-length"));

            if (!string.IsNullOrEmpty(schema.Pattern))
            {
                try
                {
                    if (!Regex.IsMatch(strVal, schema.Pattern))
                        _errors.Add(new ValidationError(path, $"String does not match pattern", "pattern-mismatch"));
                }
                catch (RegexParseException ex)
                {
                    _errors.Add(new ValidationError(path, $"Invalid regex pattern: {ex.Message}", "pattern-error"));
                }
            }

            if (schema.Format != null && !StringFormatValidator.IsValid(schema.Format, strVal))
                _errors.Add(new ValidationError(path,
                    $"String is not a valid {schema.Format}", "format"));
        }

        // Numeric constraints
        if ((schema.Type == SchemaType.Integer || schema.Type == SchemaType.Float) && value is IComparable)
        {
            if (schema.Min.HasValue && (long)value < schema.Min)
                _errors.Add(new ValidationError(path, $"Value below minimum ({schema.Min})", "min-value"));

            if (schema.Max.HasValue && (long)value > schema.Max)
                _errors.Add(new ValidationError(path, $"Value above maximum ({schema.Max})", "max-value"));
        }

        // Table validation
        if (schema.Type == SchemaType.Table && value is TomlTable table)
        {
            ValidateTable(table, schema, path);
        }

        // Array validation
        if (schema.Type == SchemaType.Array && value is TomlArray array)
        {
            ValidateArray(array, schema, path);
        }

        // Collection validation
        if (schema.Type == SchemaType.Collection && value is TomlTable collTable)
        {
            ValidateCollection(collTable, schema, path);
        }
    }

    private void ValidateTable(TomlTable table, SchemaDefinition schema, string path)
    {
        // Sibling rules
        if (schema.DependentRequired != null && schema.DependentRequired.Count > 0)
        {
            foreach (var dep in schema.DependentRequired)
            {
                if (table.ContainsKey(dep) && !table.Keys.Any(k => schema.Children.ContainsKey(k)))
                {
                    _errors.Add(new ValidationError(path, $"Missing dependent required key: {dep}", "dependent-required"));
                }
            }
        }

        if (schema.MutuallyExclusive != null && schema.MutuallyExclusive.Count > 0)
        {
            var present = table.Keys.Where(k => schema.MutuallyExclusive.Contains(k)).ToList();
            if (present.Count > 1)
            {
                _errors.Add(new ValidationError(path, $"Mutually exclusive keys present: {string.Join(", ", present)}", "mutually-exclusive"));
            }
        }

        if (schema.ExactlyOne != null && schema.ExactlyOne.Count > 0)
        {
            var present = table.Keys.Where(k => schema.ExactlyOne.Contains(k)).ToList();
            if (present.Count != 1)
            {
                _errors.Add(new ValidationError(path, $"Exactly one of these keys must be present", "exactly-one"));
            }
        }

        // Validate child elements
        foreach (var (key, childSchema) in schema.Children)
        {
            if (table.TryGetValue(key, out var childValue))
            {
                ValidateElement(key, childValue, childSchema, path);
            }
            else if (!childSchema.Optional)
            {
                _errors.Add(new ValidationError($"{path}.{key}", "Missing required element", "missing-element"));
            }
        }
    }

    private void ValidateArray(TomlArray array, SchemaDefinition schema, string path)
    {
        if (schema.UniqueItems == true)
        {
            var seen = new HashSet<string>();
            foreach (var item in array)
            {
                var itemStr = item?.ToString() ?? "null";
                if (!seen.Add(itemStr))
                {
                    _errors.Add(new ValidationError(path, "Array contains duplicate items", "duplicate-items"));
                    break;
                }
            }
        }

        if (schema.Min.HasValue && array.Count < schema.Min)
            _errors.Add(new ValidationError(path, $"Array too short (min {schema.Min})", "min-items"));

        if (schema.Max.HasValue && array.Count > schema.Max)
            _errors.Add(new ValidationError(path, $"Array too long (max {schema.Max})", "max-items"));

        // Item type validation
        if (!string.IsNullOrEmpty(schema.ItemType))
        {
            for (int i = 0; i < array.Count; i++)
            {
                ValidateArrayItem(array[i], schema, path, i);
            }
        }
    }

    private void ValidateArrayItem(object? item, SchemaDefinition schema, string path, int index)
    {
        string itemPath = $"{path}[{index}]";

        if (string.IsNullOrEmpty(schema.ItemType))
            return;

        SchemaDefinition? itemSchema = null;

        // Reference to named type
        if (schema.ItemType.StartsWith("types."))
        {
            itemSchema = _schema.ResolveType(schema.ItemType);
        }

        if (itemSchema == null)
        {
            // Try built-in type
            try
            {
                var itemType = SchemaTypeExtensions.FromSchemaName(schema.ItemType);
                itemSchema = new SchemaDefinition { Type = itemType };
            }
            catch
            {
                _errors.Add(new ValidationError(itemPath, $"Unknown item type: {schema.ItemType}", "unknown-type"));
                return;
            }
        }

        ValidateType(item, itemSchema, itemPath);
    }

    private void ValidateCollection(TomlTable table, SchemaDefinition schema, string path)
    {
        // Collections allow dynamic keys, validate structure based on defined children
        if (schema.Children.Count > 0)
        {
            foreach (var (key, value) in table)
            {
                // If we have a schema for this key, use it
                if (schema.Children.TryGetValue(key, out var childSchema))
                {
                    ValidateType(value, childSchema, $"{path}.{key}");
                }
                // Otherwise allow any value for dynamic keys
            }
        }
    }

    private bool ValidateOneOf(object? value, List<string> types, string path)
    {
        int matches = 0;
        foreach (var typeName in types)
        {
            if (MatchesType(value, typeName))
                matches++;
        }
        return matches == 1;
    }

    private bool ValidateAnyOf(object? value, List<string> types, string path)
    {
        foreach (var typeName in types)
        {
            if (MatchesType(value, typeName))
                return true;
        }
        return false;
    }

    private bool MatchesType(object? value, string typeName)
    {
        if (value == null)
            return false;

        try
        {
            var schemaType = SchemaTypeExtensions.FromSchemaName(typeName);
            return TypeMatches(GetValueType(value), schemaType);
        }
        catch
        {
            return false;
        }
    }

    private bool MatchesCondition(object? value, Dictionary<string, object> condition)
    {
        // Simple condition matching - check if value satisfies if condition
        if (value is not TomlTable table)
            return false;

        foreach (var (key, expectedValue) in condition)
        {
            if (!table.TryGetValue(key, out var actualValue))
                return false;

            if (!ValueEquals(expectedValue, actualValue))
                return false;
        }

        return true;
    }

    private SchemaType GetValueType(object? value) => value switch
    {
        string => SchemaType.String,
        long or int => SchemaType.Integer,
        double or float => SchemaType.Float,
        bool => SchemaType.Boolean,
        DateTime dt => dt.Kind == DateTimeKind.Unspecified ? SchemaType.LocalDateTime :
                       (dt.Kind == DateTimeKind.Local ? SchemaType.LocalDateTime : SchemaType.OffsetDateTime),
        DateOnly => SchemaType.LocalDate,
        TimeOnly => SchemaType.LocalTime,
        TomlArray => SchemaType.Array,
        TomlTable => SchemaType.Table,
        _ => SchemaType.Any
    };

    private bool TypeMatches(SchemaType actualType, SchemaType expectedType)
    {
        if (expectedType == SchemaType.Any)
            return true;
        return actualType == expectedType;
    }

    private bool ValueEquals(object? a, object? b)
    {
        if (a == null && b == null)
            return true;
        if (a == null || b == null)
            return false;
        return a.Equals(b);
    }
}
