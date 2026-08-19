namespace TomlSchema;

using Tomlyn;
using Tomlyn.Model;
using System.Text.RegularExpressions;

/// <summary>
/// Validates TOML documents against a schema.
/// </summary>
internal class SchemaValidator
{
    private readonly TomlSchema _schema;
    private readonly List<ValidationError> _errors = new();
    private readonly List<ValidationWarning> _warnings = new();
    private List<ValidationWarning> _nodeWarnings;

    public SchemaValidator(TomlSchema schema)
    {
        _schema = schema ?? throw new ArgumentNullException(nameof(schema));
        _nodeWarnings = _warnings;
    }

    public ValidationResult Validate(TomlTable document)
    {
        ValidateFixedChildren("$", document, _schema.Elements);

        foreach (var key in document.Keys)
        {
            if (!_schema.Elements.ContainsKey(key) && key != "toml-schema")
                Add("unexpected-key", AppendPath("$", key), "unexpected key");
        }

        return Result();
    }

    private ValidationResult Result() => new(_errors.AsReadOnly(), _warnings.AsReadOnly());

    private void ValidateFixedChildren(
        string path,
        TomlTable table,
        IReadOnlyDictionary<string, SchemaDefinition> definitions)
    {
        foreach (var (key, definition) in definitions)
        {
            var childPath = AppendPath(path, key);
            if (!table.TryGetValue(key, out var value) || value == null)
            {
                if (!IsOptional(definition, new HashSet<string>()))
                    Add("required", childPath, "required value is missing");
            }
            else
            {
                ValidateNode(childPath, value, definition);
            }
        }
    }

    private void ValidateNode(string path, object? value, SchemaDefinition definition)
    {
        ValidateComposedNode(
            path,
            value,
            definition,
            new HashSet<string>(),
            CollectFixedChildren(definition, new HashSet<string>()),
            !ResolvesToUnionSelector(definition, new HashSet<string>()),
            _warnings);
    }

    /// <summary>
    /// Validates every contributor of one composed node. Warnings raised for the node itself are
    /// buffered and only committed when the node contributed no error.
    /// </summary>
    private void ValidateComposedNode(
        string path,
        object? value,
        SchemaDefinition definition,
        HashSet<string> externalChildren,
        HashSet<string> closure,
        bool enforceClosure,
        List<ValidationWarning> nodeSink)
    {
        var enclosingWarnings = _nodeWarnings;
        var scopedWarnings = new List<ValidationWarning>();
        _nodeWarnings = scopedWarnings;
        var errorsBefore = _errors.Count;
        try
        {
            ValidateContributor(path, value, definition, externalChildren, new HashSet<string>());

            if (enforceClosure
                && EffectiveKind(definition, new HashSet<string>()) == SchemaType.Table
                && value is TomlTable table
                && closure.Count > 0)
            {
                foreach (var key in table.Keys)
                {
                    if (!closure.Contains(key))
                        Add("unexpected-key", AppendPath(path, key), "unexpected key");
                }
            }

            if (IsDeprecated(definition, new HashSet<string>()))
                _nodeWarnings.Add(new ValidationWarning(path, "value is deprecated", "deprecated"));
        }
        finally
        {
            _nodeWarnings = enclosingWarnings;
        }

        if (_errors.Count == errorsBefore)
            nodeSink.AddRange(scopedWarnings);
    }

    private void ValidateContributor(
        string path,
        object? value,
        SchemaDefinition definition,
        HashSet<string> externalChildren,
        HashSet<string> visiting)
    {
        if (definition.Reference != null)
        {
            var referenceExternal = SiblingChildren(definition, externalChildren, true, null, visiting);
            var referenceScope = new HashSet<string>(visiting);
            ValidateContributor(path, value, Reference(definition.Reference, referenceScope),
                referenceExternal, referenceScope);
            ValidateNodeRules(path, value, definition);
        }
        else if (definition.Condition != null)
        {
            ValidateConditional(path, value, definition,
                SiblingChildren(definition, externalChildren, true, null, visiting));
        }
        else if (Alternatives(definition) is { Count: > 0 })
        {
            ValidateUnion(path, value, definition,
                SiblingChildren(definition, externalChildren, true, null, visiting));
            ValidateNodeRules(path, value, definition);
        }
        else
        {
            var type = definition.Type ?? SchemaType.Any;
            if (!IsType(value, type))
            {
                Add("type-mismatch", path, $"expected {type.ToSchemaName()} but found {TypeName(value)}");
            }
            else
            {
                ValidateCommonConstraints(path, value, definition);
                switch (type)
                {
                    case SchemaType.Table:
                        ValidateTableContributor(path, (TomlTable)value!, definition);
                        break;
                    case SchemaType.Collection:
                        ValidateCollectionContributor(path, (TomlTable)value!, definition,
                            NodeChildren(definition, externalChildren, visiting));
                        break;
                    case SchemaType.Array:
                        ValidateArray(path, AsArray(value)!, definition);
                        break;
                }
            }
        }

        foreach (var component in definition.AllOf ?? new List<string>())
        {
            var componentScope = new HashSet<string>(visiting);
            var componentExternal = SiblingChildren(definition, externalChildren, false, component, visiting);
            ValidateContributor(path, value, Reference(component, componentScope),
                componentExternal, componentScope);
        }
    }

    private void ValidateNodeRules(string path, object? value, SchemaDefinition definition)
    {
        if (value is TomlTable table)
            ValidatePresenceRules(path, table, definition);

        if (definition.UniqueItems == true && AsArray(value) is { } array)
            ValidateUniqueItems(path, array);
    }

    private HashSet<string> SiblingChildren(
        SchemaDefinition definition,
        HashSet<string> externalChildren,
        bool excludePrimary,
        string? excludedComponent,
        HashSet<string> visiting)
    {
        var result = new HashSet<string>(externalChildren);
        result.UnionWith(definition.Children.Keys);
        if (!excludePrimary)
            result.UnionWith(PrimaryChildren(definition, visiting));

        foreach (var component in definition.AllOf ?? new List<string>())
        {
            if (component == excludedComponent)
                continue;
            var scope = new HashSet<string>(visiting);
            result.UnionWith(CollectFixedChildren(Reference(component, scope), scope));
        }

        return result;
    }

    private HashSet<string> PrimaryChildren(SchemaDefinition definition, HashSet<string> visiting)
    {
        if (definition.Reference != null)
        {
            var scope = new HashSet<string>(visiting);
            return CollectFixedChildren(Reference(definition.Reference, scope), scope);
        }

        var result = new HashSet<string>();
        if (definition.Condition != null)
        {
            foreach (var branch in ConditionBranches(definition.Condition))
            {
                var scope = new HashSet<string>(visiting);
                result.UnionWith(CollectFixedChildren(Reference(branch, scope), scope));
            }
        }

        foreach (var alternative in Alternatives(definition))
        {
            var scope = new HashSet<string>(visiting);
            result.UnionWith(CollectFixedChildren(Reference(alternative, scope), scope));
        }

        return result;
    }

    private HashSet<string> NodeChildren(
        SchemaDefinition definition,
        HashSet<string> externalChildren,
        HashSet<string> visiting)
    {
        var result = new HashSet<string>(externalChildren);
        result.UnionWith(CollectFixedChildren(definition, new HashSet<string>(visiting)));
        return result;
    }

    private static List<string> Alternatives(SchemaDefinition definition) =>
        definition.OneOf ?? definition.AnyOf ?? new List<string>();

    private static List<string> ConditionBranches(SchemaCondition condition)
    {
        var branches = new List<string>();
        if (condition.ThenType != null)
            branches.Add(condition.ThenType);
        if (condition.ElseType != null)
            branches.Add(condition.ElseType);
        return branches;
    }

    private void ValidateConditional(
        string path,
        object? value,
        SchemaDefinition definition,
        HashSet<string> sharedChildren)
    {
        var condition = definition.Condition!;
        if (value is not TomlTable table)
        {
            var kind = EffectiveKind(definition, new HashSet<string>());
            Add("type-mismatch", path, $"expected {kind.ToSchemaName()} but found {TypeName(value)}");
            return;
        }

        var matches = table.TryGetValue(condition.IfKey, out var discriminator)
            && discriminator != null
            && (condition.IfIn != null
                ? condition.IfIn.Any(candidate => ValuesEqual(discriminator, candidate))
                : ValuesEqual(discriminator, condition.IfEquals));

        var selected = matches ? condition.ThenType : condition.ElseType;
        if (selected == null)
            throw new InvalidOperationException($"Conditional at {path} does not define a branch");

        var branch = new SchemaValidator(_schema);
        var selectedDefinition = branch.Reference(selected, new HashSet<string>());
        var branchClosure = branch.CollectFixedChildren(selectedDefinition, new HashSet<string>());
        branchClosure.UnionWith(sharedChildren);
        var branchNodeWarnings = new List<ValidationWarning>();
        branch.ValidateComposedNode(path, value, selectedDefinition,
            sharedChildren, branchClosure, true, branchNodeWarnings);

        var branchResult = branch.Result();
        _errors.AddRange(branchResult.Errors);
        _warnings.AddRange(branchResult.Warnings);
        _nodeWarnings.AddRange(branchNodeWarnings);
    }

    private void ValidateUnion(
        string path,
        object? value,
        SchemaDefinition definition,
        HashSet<string> sharedChildren)
    {
        var successful = new List<(ValidationResult Result, List<ValidationWarning> NodeWarnings)>();
        foreach (var alternative in Alternatives(definition))
        {
            var branch = new SchemaValidator(_schema);
            var alternativeDefinition = branch.Reference(alternative, new HashSet<string>());
            var branchClosure = branch.CollectFixedChildren(alternativeDefinition, new HashSet<string>());
            branchClosure.UnionWith(sharedChildren);
            var branchNodeWarnings = new List<ValidationWarning>();
            branch.ValidateComposedNode(path, value, alternativeDefinition,
                sharedChildren, branchClosure, true, branchNodeWarnings);

            var branchResult = branch.Result();
            if (branchResult.IsValid)
                successful.Add((branchResult, branchNodeWarnings));
        }

        if (definition.OneOf != null && successful.Count != 1)
        {
            Add("oneof", path,
                $"expected exactly one matching type from oneof but found {successful.Count}");
            return;
        }

        if (definition.OneOf == null && definition.AnyOf != null && successful.Count == 0)
        {
            Add("anyof", path, "expected at least one matching type from anyof");
            return;
        }

        foreach (var (result, nodeWarnings) in successful)
        {
            _warnings.AddRange(result.Warnings);
            _nodeWarnings.AddRange(nodeWarnings);
        }
    }

    private void ValidateTableContributor(string path, TomlTable table, SchemaDefinition definition)
    {
        ValidateFixedChildren(path, table, definition.Children);
        ValidatePresenceRules(path, table, definition);
    }

    private void ValidateCollectionContributor(
        string path,
        TomlTable table,
        SchemaDefinition definition,
        HashSet<string> fixedChildren)
    {
        ValidateFixedChildren(path, table, definition.Children);
        ValidatePresenceRules(path, table, definition);

        var dynamicEntries = 0;
        foreach (var (key, value) in table)
        {
            if (fixedChildren.Contains(key))
                continue;

            dynamicEntries++;
            var childPath = AppendPath(path, key);
            if (definition.KeyPattern != null && !Regex.IsMatch(key, definition.KeyPattern))
                Add("keypattern", childPath, $"key does not match keypattern {definition.KeyPattern}");

            if (definition.ItemType != null)
                ValidateNode(childPath, value, Reference(definition.ItemType, new HashSet<string>()));
        }

        ValidateLength(path, dynamicEntries, definition);
    }

    private void ValidatePresenceRules(string path, TomlTable table, SchemaDefinition definition)
    {
        foreach (var (trigger, dependencies) in definition.DependentRequired
            ?? new Dictionary<string, List<string>>())
        {
            if (!table.ContainsKey(trigger))
                continue;

            foreach (var required in dependencies)
            {
                if (!table.ContainsKey(required))
                    Add("dependentrequired", AppendPath(path, required),
                        $"{required} is required when {trigger} is present");
            }
        }

        foreach (var group in definition.MutuallyExclusive ?? new List<List<string>>())
        {
            if (group.Count(table.ContainsKey) > 1)
                Add("mutuallyexclusive", path,
                    $"at most one of [{string.Join(", ", group)}] may be present");
        }

        foreach (var group in definition.ExactlyOne ?? new List<List<string>>())
        {
            if (group.Count(table.ContainsKey) != 1)
                Add("exactlyone", path,
                    $"exactly one of [{string.Join(", ", group)}] must be present");
        }
    }

    private void ValidateArray(string path, IReadOnlyList<object?> array, SchemaDefinition definition)
    {
        ValidateLength(path, array.Count, definition);

        if (definition.UniqueItems == true)
            ValidateUniqueItems(path, array);

        if (definition.Items is { Count: > 0 } items)
        {
            if (array.Count != items.Count)
                Add("tuple-length", path, $"expected array length {items.Count} but found {array.Count}");

            var upperBound = Math.Min(array.Count, items.Count);
            for (var i = 0; i < upperBound; i++)
                ValidateNode($"{path}[{i}]", array[i], Reference(items[i], new HashSet<string>()));

            return;
        }

        for (var i = 0; i < array.Count; i++)
        {
            var item = array[i];
            var itemPath = $"{path}[{i}]";
            if (definition.ItemType != null)
                ValidateNode(itemPath, item, Reference(definition.ItemType, new HashSet<string>()));

            if (definition.AllowedValues != null)
                ValidateAllowedValues(itemPath, item, definition);

            if ((definition.Min != null || definition.Max != null) && BoundariesAreComparableWith(item, definition))
                ValidateRange(itemPath, item, definition);
        }
    }

    private void ValidateUniqueItems(string path, IReadOnlyList<object?> array)
    {
        for (var i = 0; i < array.Count; i++)
        {
            for (var j = 0; j < i; j++)
            {
                if (ValuesEqual(array[i], array[j]))
                {
                    Add("uniqueitems", $"{path}[{i}]", $"array item duplicates item at index {j}");
                    break;
                }
            }
        }
    }

    private void ValidateCommonConstraints(string path, object? value, SchemaDefinition definition)
    {
        if (IsArray(value))
            return;

        ValidateAllowedValues(path, value, definition);
        if (definition.AllowedValues == null)
            ValidateRange(path, value, definition);

        if (value is string text)
        {
            ValidateLength(path, CountUnicodeScalars(text), definition);
            if (definition.Pattern != null && !Regex.IsMatch(text, definition.Pattern))
                Add("pattern", path, $"does not match pattern {definition.Pattern}");
        }
    }

    private void ValidateAllowedValues(string path, object? value, SchemaDefinition definition)
    {
        if (definition.AllowedValues is { Count: > 0 } allowedValues
            && !allowedValues.Any(allowed => ValuesEqual(allowed, value)))
            Add("allowedvalues", path, "value is not in allowedvalues");
    }

    private void ValidateRange(string path, object? value, SchemaDefinition definition)
    {
        if (definition.Min != null && Compare(value, definition.Min) is { } minComparison && minComparison < 0)
            Add("min", path, "value is less than min");

        if (definition.Max != null && Compare(value, definition.Max) is { } maxComparison && maxComparison > 0)
            Add("max", path, "value is greater than max");
    }

    private void ValidateLength(string path, long length, SchemaDefinition definition)
    {
        if (definition.MinLength != null && length < definition.MinLength)
            Add("minlength", path, "length is less than minlength");

        if (definition.MaxLength != null && length > definition.MaxLength)
            Add("maxlength", path, "length is greater than maxlength");
    }

    private static bool BoundariesAreComparableWith(object? value, SchemaDefinition definition) =>
        BoundaryIsComparableWith(value, definition.Min) && BoundaryIsComparableWith(value, definition.Max);

    private static bool BoundaryIsComparableWith(object? value, object? boundary)
    {
        if (boundary == null)
            return true;

        return Compare(value, boundary) != null;
    }

    private HashSet<string> CollectFixedChildren(SchemaDefinition definition, HashSet<string> visiting)
    {
        var result = new HashSet<string>(definition.Children.Keys);

        if (definition.Reference != null)
        {
            result.UnionWith(CollectFixedChildren(
                Reference(definition.Reference, visiting), new HashSet<string>(visiting)));
        }

        if (definition.Condition != null)
        {
            foreach (var branch in ConditionBranches(definition.Condition))
            {
                var scope = new HashSet<string>(visiting);
                result.UnionWith(CollectFixedChildren(Reference(branch, scope), scope));
            }
        }

        foreach (var alternative in Alternatives(definition))
        {
            result.UnionWith(CollectFixedChildren(
                Reference(alternative, visiting), new HashSet<string>(visiting)));
        }

        foreach (var component in definition.AllOf ?? new List<string>())
        {
            result.UnionWith(CollectFixedChildren(
                Reference(component, visiting), new HashSet<string>(visiting)));
        }

        return result;
    }

    private SchemaType EffectiveKind(SchemaDefinition definition, HashSet<string> visiting)
    {
        if (definition.Reference != null)
            return EffectiveKind(Reference(definition.Reference, visiting), new HashSet<string>(visiting));

        if (definition.Condition?.ThenType != null)
        {
            return EffectiveKind(
                Reference(definition.Condition.ThenType, visiting), new HashSet<string>(visiting));
        }

        var alternatives = Alternatives(definition);
        if (alternatives.Count > 0)
        {
            SchemaType? kind = null;
            foreach (var alternative in alternatives)
            {
                var candidate = EffectiveKind(
                    Reference(alternative, visiting), new HashSet<string>(visiting));
                if (kind == null)
                    kind = candidate;
                else if (kind != candidate)
                    return SchemaType.Any;
            }

            return kind ?? SchemaType.Any;
        }

        return definition.Type ?? SchemaType.Any;
    }

    private bool ResolvesToUnionSelector(SchemaDefinition definition, HashSet<string> visiting)
    {
        if (definition.Condition != null || Alternatives(definition).Count > 0)
            return true;

        return definition.Reference != null
            && ResolvesToUnionSelector(
                Reference(definition.Reference, visiting), new HashSet<string>(visiting));
    }

    private bool IsOptional(SchemaDefinition definition, HashSet<string> visiting)
    {
        if (definition.Optional)
            return true;

        return definition.Reference != null
            && IsOptional(Reference(definition.Reference, visiting), new HashSet<string>(visiting));
    }

    private bool IsDeprecated(SchemaDefinition definition, HashSet<string> visiting)
    {
        if (definition.Deprecated)
            return true;

        if (definition.Reference != null
            && IsDeprecated(Reference(definition.Reference, visiting), new HashSet<string>(visiting)))
            return true;

        foreach (var component in definition.AllOf ?? new List<string>())
        {
            if (IsDeprecated(Reference(component, visiting), new HashSet<string>(visiting)))
                return true;
        }

        return false;
    }

    private SchemaDefinition Reference(string reference, HashSet<string> visiting)
    {
        var normalized = SchemaLoader.NormalizeReference(reference);
        if (SchemaTypeExtensions.TryFromSchemaName(normalized, out var builtIn))
            return new SchemaDefinition { Type = builtIn };

        if (!visiting.Add(normalized))
            throw new InvalidOperationException($"Cyclic schema reference involving types.{normalized}");

        return _schema.Types.TryGetValue(normalized, out var definition)
            ? definition
            : throw new InvalidOperationException($"Unknown schema type reference: types.{normalized}");
    }

    private static bool IsType(object? value, SchemaType type) => type switch
    {
        SchemaType.Any => true,
        SchemaType.String => value is string,
        SchemaType.Integer => value is long,
        SchemaType.Float => value is double,
        SchemaType.Boolean => value is bool,
        SchemaType.OffsetDateTime => IsDateTimeKind(value, TomlDateTimeKind.OffsetDateTimeByZ,
            TomlDateTimeKind.OffsetDateTimeByNumber),
        SchemaType.LocalDateTime => IsDateTimeKind(value, TomlDateTimeKind.LocalDateTime),
        SchemaType.LocalDate => IsDateTimeKind(value, TomlDateTimeKind.LocalDate),
        SchemaType.LocalTime => IsDateTimeKind(value, TomlDateTimeKind.LocalTime),
        SchemaType.Array => IsArray(value),
        SchemaType.Table or SchemaType.Collection => value is TomlTable,
        _ => false
    };

    private static bool IsDateTimeKind(object? value, params TomlDateTimeKind[] kinds) =>
        value is TomlDateTime dateTime && kinds.Contains(dateTime.Kind);

    private static string TypeName(object? value) => value switch
    {
        null => "null",
        string => "string",
        long => "integer",
        double => "float",
        bool => "boolean",
        TomlDateTime dateTime => dateTime.Kind switch
        {
            TomlDateTimeKind.LocalDateTime => "local-date-time",
            TomlDateTimeKind.LocalDate => "local-date",
            TomlDateTimeKind.LocalTime => "local-time",
            _ => "offset-date-time"
        },
        TomlTable => "table",
        _ => IsArray(value) ? "array" : value.GetType().Name
    };

    private static bool IsArray(object? value) => value is TomlArray or TomlTableArray;

    private static IReadOnlyList<object?>? AsArray(object? value) => value switch
    {
        TomlArray array => array.Cast<object?>().ToList(),
        TomlTableArray tableArray => tableArray.Cast<object?>().ToList(),
        _ => null
    };

    private static bool ValuesEqual(object? left, object? right)
    {
        if (ReferenceEquals(left, right))
            return true;
        if (left == null || right == null)
            return false;

        if (left is TomlDateTime leftDateTime && right is TomlDateTime rightDateTime)
        {
            return leftDateTime.Kind == rightDateTime.Kind
                && leftDateTime.DateTime.Equals(rightDateTime.DateTime);
        }

        if (IsArray(left) && IsArray(right) && AsArray(left) is { } leftArray && AsArray(right) is { } rightArray)
        {
            if (leftArray.Count != rightArray.Count)
                return false;

            for (var i = 0; i < leftArray.Count; i++)
            {
                if (!ValuesEqual(leftArray[i], rightArray[i]))
                    return false;
            }

            return true;
        }

        if (left is TomlTable leftTable && right is TomlTable rightTable)
        {
            if (leftTable.Count != rightTable.Count)
                return false;

            foreach (var (key, leftValue) in leftTable)
            {
                if (!rightTable.TryGetValue(key, out var rightValue) || !ValuesEqual(leftValue, rightValue))
                    return false;
            }

            return true;
        }

        if (IsNumber(left) && IsNumber(right))
            return Convert.ToDouble(left).Equals(Convert.ToDouble(right));

        return left.Equals(right);
    }

    private static bool IsNumber(object value) => value is long or double;

    private static int? Compare(object? value, object? boundary)
    {
        if (value == null || boundary == null)
            return null;

        if (IsNumber(value) && IsNumber(boundary))
            return Convert.ToDouble(value).CompareTo(Convert.ToDouble(boundary));

        if (value is TomlDateTime valueDateTime && boundary is TomlDateTime boundaryDateTime)
            return valueDateTime.DateTime.CompareTo(boundaryDateTime.DateTime);

        return null;
    }

    private static long CountUnicodeScalars(string text)
    {
        long count = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
                i++;
            count++;
        }

        return count;
    }

    private static string AppendPath(string path, string key) => $"{path}.{FormatKey(key)}";

    private static string FormatKey(string key) =>
        Regex.IsMatch(key, "^[A-Za-z0-9_-]+$")
            ? key
            : $"\"{key.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";

    private void Add(string code, string path, string message) =>
        _errors.Add(new ValidationError(path, message, code));
}
