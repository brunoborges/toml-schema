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
    private readonly List<ValidationDiagnostic> _errors = new();
    private readonly List<ValidationDiagnostic> _warnings = new();

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
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.MissingRequired, PathEncoding.AppendKey("$", key),
                    schemaElem.SchemaPath, "required value is missing"));
            }
        }

        // Validate top-level unexpected keys
        foreach (var key in workDoc.Keys)
        {
            if (!_schema.Elements.ContainsKey(key))
            {
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.UnknownKey, PathEncoding.AppendKey("$", key),
                    "$.elements", "unexpected key"));
            }
        }

        return new ValidationResult(Dedup(_errors), Dedup(_warnings));
    }

    private static IReadOnlyList<ValidationDiagnostic> Dedup(IEnumerable<ValidationDiagnostic> diagnostics)
    {
        var seen = new HashSet<(string, string?, string?)>();
        var result = new List<ValidationDiagnostic>();
        foreach (var diagnostic in diagnostics)
        {
            if (seen.Add((diagnostic.Code, diagnostic.InstancePath, diagnostic.SchemaPath)))
                result.Add(diagnostic);
        }
        return result;
    }

    /// <summary>
    /// Validates a declared <c>default</c> annotation as a present value against
    /// its definition. Used at schema-load time; deprecation is not emitted here.
    /// </summary>
    internal IReadOnlyList<ValidationDiagnostic> ValidateDefaultAnnotation(
        object value, SchemaDefinition definition)
    {
        ValidateType(value, definition, "$default", suppressDeprecation: true);
        return _errors;
    }

    private void ValidateElement(string name, object? value, SchemaDefinition schema, string path)
    {
        string elemPath = PathEncoding.AppendKey(path, name);

        // Handle null values
        if (value == null)
        {
            if (!schema.Optional)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.MissingRequired, elemPath, schema.SchemaPath,
                    "required value is missing"));
            return;
        }

        ValidateType(value, schema, elemPath);
    }

    private void ValidateType(
        object? value,
        SchemaDefinition schema,
        string path,
        IReadOnlySet<string>? externalClosure = null,
        bool enforceClosure = true,
        bool suppressDeprecation = false)
    {
        // Handle null
        if (value == null)
        {
            if (!schema.Optional)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.MissingRequired, path, schema.SchemaPath,
                    "required value is missing"));
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

        // Node-level deprecation. A use-site `deprecated` paths to the use site; a
        // deprecation declared on a referenced definition paths to that definition.
        if (!suppressDeprecation)
        {
            var deprecatedSchema = schema.Deprecated ? schema
                : effectiveSchema.Deprecated ? effectiveSchema : null;
            if (deprecatedSchema != null)
                _warnings.Add(ValidationDiagnostic.Warning(
                    DiagnosticCodes.Deprecated, path, Sp(deprecatedSchema, "deprecated"),
                    "value is deprecated"));
        }

        var determinateClosure = new HashSet<string>(externalClosure ?? new HashSet<string>());
        determinateClosure.UnionWith(CollectDeterminateFixedChildKeys(
            effectiveSchema, new HashSet<string>()));

        if (effectiveSchema.AllOf != null)
        {
            foreach (var typeRef in effectiveSchema.AllOf)
            {
                var allOfSchema = _schema.ResolveType(typeRef)
                    ?? throw new InvalidOperationException($"Undefined type in allof: {typeRef}");
                ValidateType(value, allOfSchema, path, determinateClosure, enforceClosure: false,
                    suppressDeprecation: suppressDeprecation);
            }
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
            ValidateType(value, condSchema, path, determinateClosure, enforceClosure,
                suppressDeprecation: suppressDeprecation);
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
                    testValidator.ValidateType(value, unionSchema, "$.test", determinateClosure);
                    if (testValidator._errors.Count == 0)
                        matchCount++;
                }
            }
            if (matchCount != 1)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.OneOf, path, Sp(effectiveSchema, "oneof"),
                    $"expected exactly one matching type from oneof but found {matchCount}"));
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
                    testValidator.ValidateType(value, unionSchema, "$.test", determinateClosure);
                    if (testValidator._errors.Count == 0)
                        matchCount++;
                }
            }
            if (matchCount == 0)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.AnyOf, path, Sp(effectiveSchema, "anyof"),
                    "expected at least one matching type from anyof"));
            return;
        }

        // Type validation
        var actualType = GetValueType(value);
        if (effectiveSchema.Type.HasValue && !TypeMatches(actualType, effectiveSchema.Type.Value))
        {
            _errors.Add(ValidationDiagnostic.Error(
                DiagnosticCodes.TypeMismatch, path, Sp(effectiveSchema, "type"), "type mismatch"));
            return;
        }

        // Allowed values
        if (effectiveSchema.Type is not (SchemaType.Array or SchemaType.Collection)
            && effectiveSchema.AllowedValues != null && effectiveSchema.AllowedValues.Count > 0)
        {
            if (!effectiveSchema.AllowedValues.Any(av => ValueEquals(av, value)))
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.AllowedValues, path, Sp(effectiveSchema, "allowedvalues"),
                    "value not in allowed values"));
        }

        // String constraints
        if (effectiveSchema.Type == SchemaType.String && value is string strVal)
        {
            var length = CountUnicodeScalars(strVal);

            if (effectiveSchema.MinLength.HasValue && length < effectiveSchema.MinLength)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.MinLength, path, Sp(effectiveSchema, "minlength"), "string too short"));

            if (effectiveSchema.MaxLength.HasValue && length > effectiveSchema.MaxLength)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.MaxLength, path, Sp(effectiveSchema, "maxlength"), "string too long"));

            if (!string.IsNullOrEmpty(effectiveSchema.Pattern))
            {
                if (!Regex.IsMatch(strVal, effectiveSchema.Pattern))
                    _errors.Add(ValidationDiagnostic.Error(
                        DiagnosticCodes.Pattern, path, Sp(effectiveSchema, "pattern"),
                        "string does not match pattern"));
            }

            if (effectiveSchema.Format != null && !StringFormatValidator.IsValid(effectiveSchema.Format, strVal))
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.Format, path, Sp(effectiveSchema, "format"),
                    $"string is not a valid {effectiveSchema.Format}"));
        }

        // Range constraints
        if (effectiveSchema.Min != null
            && ValueSemantics.MatchesComparableKind(value, effectiveSchema.Type))
        {
            if (ValueSemantics.Compare(value, effectiveSchema.Min) < 0)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.Min, path, Sp(effectiveSchema, "min"), "value below minimum"));
        }
        if (effectiveSchema.Max != null
            && ValueSemantics.MatchesComparableKind(value, effectiveSchema.Type))
        {
            if (ValueSemantics.Compare(value, effectiveSchema.Max) > 0)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.Max, path, Sp(effectiveSchema, "max"), "value above maximum"));
        }

        // Table validation
        if (effectiveSchema.Type == SchemaType.Table && value is TomlTable tableValue)
            ValidateTable(tableValue, effectiveSchema, path, externalClosure, enforceClosure);

        // Array validation
        if (effectiveSchema.Type == SchemaType.Array && value is TomlArray array)
            ValidateArray(array, effectiveSchema, path);

        // Collection validation
        if (effectiveSchema.Type == SchemaType.Collection && value is TomlTable collTable)
            ValidateCollection(collTable, effectiveSchema, path);
    }

    private void ValidateTable(
        TomlTable table,
        SchemaDefinition schema,
        string path,
        IReadOnlySet<string>? externalClosure = null,
        bool enforceClosure = true)
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
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.MissingRequired, PathEncoding.AppendKey(path, key),
                    childSchema.SchemaPath, "required value is missing"));
            }
        }

        // Validate unexpected keys (nested). A table with a non-empty fixed-child
        // set is closed: every key that is not a fixed child is an error. A table
        // with no fixed children is open and accepts any keys.
        if (enforceClosure)
        {
            var knownKeys = CollectEffectiveClosureKeys(schema, table, new HashSet<string>());
            if (externalClosure != null)
                knownKeys.UnionWith(externalClosure);
            if (knownKeys.Count > 0)
            {
                foreach (var key in table.Keys)
                {
                    if (!knownKeys.Contains(key))
                        _errors.Add(ValidationDiagnostic.Error(
                            DiagnosticCodes.UnknownKey, PathEncoding.AppendKey(path, key),
                            schema.SchemaPath, "unexpected key"));
                }
            }
        }

        // Sibling rules
        ValidatePresenceRules(table, schema, path);
    }

    /// <summary>
    /// Collects the fixed-child key set contributed by a definition, following
    /// named references and <c>allof</c> composition so that a composed table is
    /// closed over the union of every contributor's children.
    /// </summary>
    private HashSet<string> CollectDeterminateFixedChildKeys(
        SchemaDefinition schema,
        HashSet<string> visited)
    {
        var keys = new HashSet<string>(schema.Children.Keys);

        if (!string.IsNullOrEmpty(schema.Reference) && visited.Add(schema.Reference))
        {
            var referenced = _schema.ResolveType(schema.Reference);
            if (referenced != null)
                keys.UnionWith(CollectDeterminateFixedChildKeys(referenced, visited));
        }

        if (schema.AllOf != null)
        {
            foreach (var typeRef in schema.AllOf)
            {
                if (!visited.Add(typeRef))
                    continue;

                var component = _schema.ResolveType(typeRef);
                if (component != null)
                    keys.UnionWith(CollectDeterminateFixedChildKeys(component, visited));
            }
        }

        return keys;
    }

    private HashSet<string> CollectEffectiveClosureKeys(
        SchemaDefinition schema,
        object? value,
        HashSet<string> visited)
    {
        var keys = CollectDeterminateFixedChildKeys(schema, new HashSet<string>(visited));

        void MergeReference(string? reference)
        {
            if (string.IsNullOrEmpty(reference) || SchemaTypeExtensions.AllTypeNames.Contains(reference))
                return;
            if (!visited.Add(reference))
                throw new InvalidOperationException($"Cyclic schema reference: {reference}");
            try
            {
                var target = _schema.ResolveType(reference)
                    ?? throw new InvalidOperationException($"Undefined type reference: {reference}");
                keys.UnionWith(CollectEffectiveClosureKeys(target, value, visited));
            }
            finally
            {
                visited.Remove(reference);
            }
        }

        MergeReference(schema.Reference);
        foreach (var component in schema.AllOf ?? [])
            MergeReference(component);
        foreach (var alternative in schema.OneOf ?? [])
            MergeReference(alternative);
        foreach (var alternative in schema.AnyOf ?? [])
            MergeReference(alternative);
        if (schema.Condition != null)
        {
            var matches = value is TomlTable table
                && table.TryGetValue(schema.Condition.IfKey, out var testValue)
                && (schema.Condition.IfEquals != null
                    ? ValueEquals(testValue, schema.Condition.IfEquals)
                    : schema.Condition.IfIn?.Any(candidate => ValueEquals(testValue, candidate)) == true);
            MergeReference(matches
                ? schema.Condition.ThenType
                : schema.Condition.ElseType);
        }
        return keys;
    }

    private void ValidatePresenceRules(TomlTable table, SchemaDefinition schema, string path)
    {
        // dependentrequired
        if (schema.DependentRequiredMap != null)
        {
            foreach (var (trigger, dependents) in schema.DependentRequiredMap)
            {
                if (!table.ContainsKey(trigger))
                    continue;
                foreach (var required in dependents)
                {
                    if (!table.ContainsKey(required))
                        _errors.Add(ValidationDiagnostic.Error(
                            DiagnosticCodes.DependentRequired, PathEncoding.AppendKey(path, required),
                            Sp(schema, "dependentrequired"),
                            $"required because sibling {trigger} is present"));
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
                    _errors.Add(ValidationDiagnostic.Error(
                        DiagnosticCodes.MutuallyExclusive, path, Sp(schema, "mutuallyexclusive"),
                        "mutually exclusive keys present"));
            }
        }

        // exactlyone
        if (schema.ExactlyOne != null)
        {
            foreach (var group in schema.ExactlyOne)
            {
                var present = table.Keys.Where(k => group.Contains(k)).ToList();
                if (present.Count != 1)
                    _errors.Add(ValidationDiagnostic.Error(
                        DiagnosticCodes.ExactlyOne, path, Sp(schema, "exactlyone"),
                        "exactly one key must be present"));
            }
        }
    }

    private void ValidateArray(TomlArray array, SchemaDefinition schema, string path)
    {
        // Tuple / positional array validation
        if (schema.Items is { Count: > 0 })
        {
            if (array.Count != schema.Items.Count)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.TupleLength, path, Sp(schema, "items"),
                    $"expected array length {schema.Items.Count} but found {array.Count}"));
            var bound = Math.Min(array.Count, schema.Items.Count);
            for (int i = 0; i < bound; i++)
            {
                var itemSchema = ResolveItemType(schema.Items[i])
                    ?? throw new InvalidOperationException($"Undefined item type: {schema.Items[i]}");
                ValidateType(array[i], itemSchema, PathEncoding.AppendIndex(path, i));
            }
            return;
        }

        // Unique items
        if (schema.UniqueItems == true)
            ValidateUniqueItems(array, path, Sp(schema, "uniqueitems"));

        if (schema.MinLength.HasValue && array.Count < schema.MinLength)
            _errors.Add(ValidationDiagnostic.Error(
                DiagnosticCodes.MinLength, path, Sp(schema, "minlength"), "array too short"));
        if (schema.MaxLength.HasValue && array.Count > schema.MaxLength)
            _errors.Add(ValidationDiagnostic.Error(
                DiagnosticCodes.MaxLength, path, Sp(schema, "maxlength"), "array too long"));

        // Item type validation
        if (!string.IsNullOrEmpty(schema.ItemType))
        {
            var itemSchema = ResolveItemType(schema.ItemType)
                ?? throw new InvalidOperationException($"Undefined item type: {schema.ItemType}");
            for (int i = 0; i < array.Count; i++)
            {
                ValidateType(array[i], itemSchema, PathEncoding.AppendIndex(path, i));
                ValidateMemberValueConstraints(array[i], schema, PathEncoding.AppendIndex(path, i));
            }
        }
        else
        {
            for (int i = 0; i < array.Count; i++)
                ValidateMemberValueConstraints(array[i], schema, PathEncoding.AppendIndex(path, i));
        }
    }

    /// <summary>
    /// Emits a <c>uniqueitems</c> error at each duplicate element, pathed to the later
    /// occurrence, so the reported instance path identifies the offending element.
    /// </summary>
    private void ValidateUniqueItems(TomlArray array, string path, string? schemaPath)
    {
        for (int i = 0; i < array.Count; i++)
        {
            for (int j = 0; j < i; j++)
            {
                if (ValueSemantics.ValuesEqual(array[j], array[i]))
                {
                    _errors.Add(ValidationDiagnostic.Error(
                        DiagnosticCodes.UniqueItems, PathEncoding.AppendIndex(path, i), schemaPath,
                        "array contains duplicate items"));
                    break;
                }
            }
        }
    }

    private void ValidateCollection(TomlTable table, SchemaDefinition schema, string path)
    {
        var keyPattern = schema.KeyPattern;
        var valueSchema = !string.IsNullOrEmpty(schema.ItemType)
            ? ResolveItemType(schema.ItemType)
                ?? throw new InvalidOperationException($"Undefined item type: {schema.ItemType}")
            : null;

        foreach (var (key, childSchema) in schema.Children)
        {
            if (table.TryGetValue(key, out var childValue))
                ValidateElement(key, childValue, childSchema, path);
            else if (!childSchema.Optional)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.MissingRequired, PathEncoding.AppendKey(path, key),
                    childSchema.SchemaPath, "required value is missing"));
        }

        ValidatePresenceRules(table, schema, path);

        foreach (var (key, value) in table)
        {
            if (schema.Children.ContainsKey(key))
                continue;

            var keyPath = PathEncoding.AppendKey(path, key);

            // Validate key pattern
            if (!string.IsNullOrEmpty(keyPattern))
            {
                if (!Regex.IsMatch(key, keyPattern))
                    _errors.Add(ValidationDiagnostic.Error(
                        DiagnosticCodes.KeyPattern, keyPath, Sp(schema, "keypattern"),
                        "key does not match keypattern"));
            }

            // Validate value type
            if (valueSchema != null)
                ValidateType(value, valueSchema, keyPath);
            ValidateMemberValueConstraints(value, schema, keyPath);
        }
    }

    private void ValidateMemberValueConstraints(object? value, SchemaDefinition schema, string path)
    {
        if (schema.AllowedValues?.Count > 0
            && !schema.AllowedValues.Any(allowed => ValueEquals(allowed, value)))
            _errors.Add(ValidationDiagnostic.Error(
                DiagnosticCodes.AllowedValues, path, Sp(schema, "allowedvalues"),
                "value not in allowed values"));
        if ((schema.AllowedValues?.Count ?? 0) == 0 && value != null)
        {
            if (schema.Min != null && ValueSemantics.AreComparable(value, schema.Min)
                && ValueSemantics.Compare(value, schema.Min) < 0)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.Min, path, Sp(schema, "min"), "value below minimum"));
            if (schema.Max != null && ValueSemantics.AreComparable(value, schema.Max)
                && ValueSemantics.Compare(value, schema.Max) > 0)
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.Max, path, Sp(schema, "max"), "value above maximum"));
        }
        if (value is string text)
        {
            if (schema.Pattern != null && !Regex.IsMatch(text, schema.Pattern))
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.Pattern, path, Sp(schema, "pattern"),
                    "string does not match pattern"));
            if (schema.Format != null && !StringFormatValidator.IsValid(schema.Format, text))
                _errors.Add(ValidationDiagnostic.Error(
                    DiagnosticCodes.Format, path, Sp(schema, "format"),
                    $"string is not a valid {schema.Format}"));
        }
    }

    private SchemaDefinition? ResolveItemType(string itemType) => _schema.ResolveType(itemType);

    private static string? Sp(SchemaDefinition definition, string property) =>
        definition.SchemaPath == null ? null : definition.SchemaPath + "." + property;

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
}
