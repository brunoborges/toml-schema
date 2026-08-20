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
        var workDoc = new TomlTable();
        foreach (var kvp in document.Where(x => x.Key != "toml-schema" || _schema.Elements.ContainsKey("toml-schema")))
            workDoc[kvp.Key] = kvp.Value;

        // Validate top-level expected keys
        foreach (var (key, schemaElem) in _schema.Elements)
        {
            if (workDoc.TryGetValue(key, out var value))
            {
                ValidateElement(key, value, schemaElem, "$");
            }
            else if (!schemaElem.Optional)
            {
                _errors.Add(new ValidationError(AppendPath("$", key), $"required value is missing", "required"));
            }
        }

        // Validate top-level unexpected keys
        foreach (var key in workDoc.Keys)
        {
            if (!_schema.Elements.ContainsKey(key))
            {
                _errors.Add(new ValidationError(AppendPath("$", key), "unexpected key", "unexpected-key"));
            }
        }

        return new ValidationResult(_errors.AsReadOnly(), _warnings.AsReadOnly());
    }

    private void ValidateElement(string name, object? value, SchemaDefinition schema, string path)
    {
        string elemPath = AppendPath(path, name);

        // Handle null values
        if (value == null)
        {
            if (!schema.Optional)
                _errors.Add(new ValidationError(elemPath, "required value is missing", "required"));
            return;
        }

        // Emit deprecation warning
        if (schema.Deprecated)
            _warnings.Add(new ValidationWarning(elemPath, "Element is deprecated", "deprecated"));

        ValidateType(value, schema, elemPath);
    }

    private void ValidateType(object? value, SchemaDefinition schema, string path)
    {
        // Handle null
        if (value == null)
        {
            if (!schema.Optional)
                _errors.Add(new ValidationError(path, "required value is missing", "required"));
            return;
        }

        // Resolve reference
        SchemaDefinition effectiveSchema = schema;
        if (!string.IsNullOrEmpty(schema.Reference))
        {
            var refSchema = _schema.ResolveType(schema.Reference);
            if (refSchema == null)
                throw new InvalidOperationException($"Undefined type reference: {schema.Reference}");
            effectiveSchema = refSchema;
        }

        // Handle conditionals
        if (effectiveSchema.Condition != null)
        {
            bool matches = false;
            if (value is TomlTable condTable
                && condTable.TryGetValue(effectiveSchema.Condition.IfKey, out var testValue))
            {

                if (effectiveSchema.Condition.IfEquals != null)
                    matches = ValueEquals(testValue, effectiveSchema.Condition.IfEquals);
                else if (effectiveSchema.Condition.IfIn != null)
                    matches = effectiveSchema.Condition.IfIn.Any(v => ValueEquals(testValue, v));

            }
            string? selectedType = matches ? effectiveSchema.Condition.ThenType : effectiveSchema.Condition.ElseType;
            var condSchema = _schema.ResolveType(selectedType)
                ?? throw new InvalidOperationException($"Undefined type in conditional: {selectedType}");
            ValidateType(value, condSchema, path);
            return;
        }

        // Handle unions (oneof: exactly one)
        if (effectiveSchema.OneOf != null && effectiveSchema.OneOf.Count > 0)
        {
            int matchCount = 0;
            foreach (var typeRef in effectiveSchema.OneOf)
            {
                var unionSchema = _schema.ResolveType(typeRef);
                if (unionSchema != null)
                {
                    var testValidator = new SchemaValidator(_schema);
                    testValidator.ValidateType(value, unionSchema, "$.test");
                    if (testValidator._errors.Count == 0)
                        matchCount++;
                }
            }
            if (matchCount != 1)
                _errors.Add(new ValidationError(path, $"expected exactly one matching type from oneof", "oneof"));
            return;
        }

        // Handle unions (anyof: at least one)
        if (effectiveSchema.AnyOf != null && effectiveSchema.AnyOf.Count > 0)
        {
            int matchCount = 0;
            foreach (var typeRef in effectiveSchema.AnyOf)
            {
                var unionSchema = _schema.ResolveType(typeRef);
                if (unionSchema != null)
                {
                    var testValidator = new SchemaValidator(_schema);
                    testValidator.ValidateType(value, unionSchema, "$.test");
                    if (testValidator._errors.Count == 0)
                        matchCount++;
                }
            }
            if (matchCount == 0)
                _errors.Add(new ValidationError(path, "expected at least one matching type from anyof", "anyof"));
            return;
        }

        if (effectiveSchema.AllOf != null)
        {
            foreach (var typeRef in effectiveSchema.AllOf)
            {
                var allOfSchema = _schema.ResolveType(typeRef)
                    ?? throw new InvalidOperationException($"Undefined type in allof: {typeRef}");
                ValidateType(value, allOfSchema, path);
            }
        }

        // Type validation
        var actualType = GetValueType(value);
        if (effectiveSchema.Type.HasValue && !TypeMatches(actualType, effectiveSchema.Type.Value))
        {
            _errors.Add(new ValidationError(path, $"type mismatch", "type-mismatch"));
            return;
        }

        // Allowed values
        if (effectiveSchema.AllowedValues != null && effectiveSchema.AllowedValues.Count > 0)
        {
            if (!effectiveSchema.AllowedValues.Any(av => ValueEquals(av, value)))
                _errors.Add(new ValidationError(path, "value not in allowed values", "invalid-value"));
        }

        // String constraints
        if (effectiveSchema.Type == SchemaType.String && value is string strVal)
        {
            var length = CountUnicodeScalars(strVal);

            if (effectiveSchema.MinLength.HasValue && length < effectiveSchema.MinLength)
                _errors.Add(new ValidationError(path, $"string too short", "minlength"));

            if (effectiveSchema.MaxLength.HasValue && length > effectiveSchema.MaxLength)
                _errors.Add(new ValidationError(path, $"string too long", "maxlength"));

            if (!string.IsNullOrEmpty(effectiveSchema.Pattern))
            {
                try
                {
                    if (!Regex.IsMatch(strVal, effectiveSchema.Pattern))
                        _errors.Add(new ValidationError(path, "string does not match pattern", "pattern-mismatch"));
                }
                catch (RegexParseException)
                {
                    _errors.Add(new ValidationError(path, $"invalid regex pattern", "pattern"));
                }
            }

            if (effectiveSchema.Format != null && !StringFormatValidator.IsValid(effectiveSchema.Format, strVal))
                _errors.Add(new ValidationError(path,
                    $"string is not a valid {effectiveSchema.Format}", "format"));
        }

        // Numeric constraints
        if ((effectiveSchema.Type == SchemaType.Integer || effectiveSchema.Type == SchemaType.Float) && value is IComparable)
        {
            double numValue = value is long l ? (double)l : value is double d ? d : 0;

            if (effectiveSchema.Min.HasValue && numValue < effectiveSchema.Min.Value)
                _errors.Add(new ValidationError(path, $"value below minimum", "min"));

            if (effectiveSchema.Max.HasValue && numValue > effectiveSchema.Max.Value)
                _errors.Add(new ValidationError(path, $"value above maximum", "max"));
        }

        // Table validation
        if (effectiveSchema.Type == SchemaType.Table && value is TomlTable tableValue)
            ValidateTable(tableValue, effectiveSchema, path);

        // Array validation
        if (effectiveSchema.Type == SchemaType.Array && value is TomlArray array)
            ValidateArray(array, effectiveSchema, path);

        // Collection validation
        if (effectiveSchema.Type == SchemaType.Collection && value is TomlTable collTable)
            ValidateCollection(collTable, effectiveSchema, path);
    }

    private void ValidateTable(TomlTable table, SchemaDefinition schema, string path)
    {
        // Validate fixed children
        foreach (var (key, childSchema) in schema.Children)
        {
            if (table.TryGetValue(key, out var childValue))
            {
                ValidateElement(key, childValue, childSchema, path);
            }
            else if (!childSchema.Optional)
            {
                _errors.Add(new ValidationError(AppendPath(path, key), "required value is missing", "required"));
            }
        }

        // Validate unexpected keys (nested)
        // Sibling rules
        ValidatePresenceRules(table, schema, path);
    }

    private void ValidatePresenceRules(TomlTable table, SchemaDefinition schema, string path)
    {
        // dependentrequired
        if (schema.DependentRequired != null)
        {
            foreach (var dep in schema.DependentRequired)
            {
                if (table.ContainsKey(dep))
                {
                    foreach (var required in schema.Children.Keys)
                    {
                        if (!table.ContainsKey(required))
                            _errors.Add(new ValidationError(AppendPath(path, required), 
                                $"required by presence of {dep}", "dependentrequired"));
                    }
                }
            }
        }

        // mutuallyexclusive
        if (schema.MutuallyExclusive != null)
        {
            foreach (var group in schema.MutuallyExclusive)
            {
                var present = table.Keys.Where(k => group.Contains(k)).ToList();
                if (present.Count > 1)
                    _errors.Add(new ValidationError(path, "mutually exclusive keys present", "mutuallyexclusive"));
            }
        }

        // exactlyone
        if (schema.ExactlyOne != null)
        {
            foreach (var group in schema.ExactlyOne)
            {
                var present = table.Keys.Where(k => group.Contains(k)).ToList();
                if (present.Count != 1)
                    _errors.Add(new ValidationError(path, "exactly one key must be present", "exactlyone"));
            }
        }
    }

    private void ValidateArray(TomlArray array, SchemaDefinition schema, string path)
    {
        // Unique items
        if (schema.UniqueItems == true)
        {
            var seen = new HashSet<string>();
            foreach (var item in array)
            {
                var itemStr = NormalizeValue(item);
                if (!seen.Add(itemStr))
                    _errors.Add(new ValidationError(path, "array contains duplicate items", "duplicate-items"));
            }
        }

        // Array length
        if (schema.Min.HasValue && array.Count < schema.Min)
            _errors.Add(new ValidationError(path, "array too short", "min"));

        if (schema.Max.HasValue && array.Count > schema.Max)
            _errors.Add(new ValidationError(path, "array too long", "max"));

        // Item type validation
        if (!string.IsNullOrEmpty(schema.ItemType))
        {
            var itemSchema = ResolveItemType(schema.ItemType)
                ?? throw new InvalidOperationException($"Undefined item type: {schema.ItemType}");
            for (int i = 0; i < array.Count; i++)
            {
                ValidateType(array[i], itemSchema, $"{path}[{i}]");
            }
        }
    }

    private void ValidateCollection(TomlTable table, SchemaDefinition schema, string path)
    {
        // Collections allow any string keys matching keypattern
        var keyPattern = schema.KeyPattern;
        var valueSchema = !string.IsNullOrEmpty(schema.ItemType)
            ? ResolveItemType(schema.ItemType)
                ?? throw new InvalidOperationException($"Undefined item type: {schema.ItemType}")
            : null;

        foreach (var (key, value) in table)
        {
            var keyPath = AppendPath(path, key);

            // Validate key pattern
            if (!string.IsNullOrEmpty(keyPattern))
            {
                try
                {
                    if (!Regex.IsMatch(key, keyPattern))
                        _errors.Add(new ValidationError(keyPath, "key does not match keypattern", "keypattern"));
                }
                catch (RegexParseException)
                {
                    _errors.Add(new ValidationError(keyPath, "invalid keypattern regex", "keypattern"));
                }
            }

            // Validate value type
            if (valueSchema != null)
                ValidateType(value, valueSchema, keyPath);
        }
    }

    private SchemaDefinition? ResolveItemType(string itemType) => _schema.ResolveType(itemType);

    private SchemaType GetValueType(object value) => value switch
    {
        string => SchemaType.String,
        long => SchemaType.Integer,
        double => SchemaType.Float,
        bool => SchemaType.Boolean,
        DateTime dt when dt.Kind == DateTimeKind.Utc => SchemaType.OffsetDateTime,
        DateTime => SchemaType.LocalDateTime,
        DateOnly => SchemaType.LocalDate,
        TimeOnly => SchemaType.LocalTime,
        TomlDateTime { Kind: TomlDateTimeKind.OffsetDateTimeByZ or TomlDateTimeKind.OffsetDateTimeByNumber } => SchemaType.OffsetDateTime,
        TomlDateTime { Kind: TomlDateTimeKind.LocalDateTime } => SchemaType.LocalDateTime,
        TomlDateTime { Kind: TomlDateTimeKind.LocalDate } => SchemaType.LocalDate,
        TomlDateTime { Kind: TomlDateTimeKind.LocalTime } => SchemaType.LocalTime,
        TomlArray => SchemaType.Array,
        TomlTableArray => SchemaType.Array,
        TomlTable => SchemaType.Table,
        _ => SchemaType.Any
    };

    private bool TypeMatches(SchemaType actual, SchemaType expected) =>
        expected == SchemaType.Any || actual == expected ||
        (expected == SchemaType.Collection && actual == SchemaType.Table);

    private bool ValueEquals(object? a, object? b)
    {
        if (ReferenceEquals(a, b))
            return true;
        if (a == null || b == null)
            return false;
        return a.Equals(b);
    }

    private string NormalizeValue(object? value) => value switch
    {
        null => "null",
        string s => $"\"{s}\"",
        bool b => b ? "true" : "false",
        long l => l.ToString(),
        double d => d.ToString(CultureInfo.InvariantCulture),
        DateTime dt => dt.ToString("O"),
        DateOnly d => d.ToString("O"),
        TimeOnly t => t.ToString("O"),
        _ => value.ToString() ?? "null"
    };

    private long CountUnicodeScalars(string str)
    {
        // Count Unicode scalar values (handling surrogate pairs correctly)
        long count = 0;
        for (int i = 0; i < str.Length; i++)
        {
            char c = str[i];
            if (char.IsHighSurrogate(c))
            {
                i++; // Skip the low surrogate
            }
            count++;
        }
        return count;
    }

    private string AppendPath(string path, string key)
    {
        // Quote key if it contains special characters
        string formattedKey;
        if (Regex.IsMatch(key, "^[A-Za-z0-9_-]+$"))
        {
            formattedKey = key;
        }
        else
        {
            formattedKey = $"\"{EscapeString(key)}\"";
        }

        return $"{path}.{formattedKey}";
    }

    private string EscapeString(string s) =>
        s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
