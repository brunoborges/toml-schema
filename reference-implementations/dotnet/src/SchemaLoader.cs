namespace TomlSchema;

using Tomlyn.Model;

/// <summary>
/// Loads and parses TOML Schema documents (.tosd files).
/// </summary>
internal class SchemaLoader
{
    public static readonly HashSet<string> DefinitionKeys = new()
    {
        "type", "description", "itemtype", "items", "allowedvalues", "pattern", "keypattern",
        "optional", "min", "max", "minlength", "maxlength", "oneof", "anyof", "allof",
        "dependentrequired", "mutuallyexclusive", "exactlyone", "uniqueitems", "default",
        "deprecated", "if", "then", "else"
    };

    public static TomlSchema Load(string schemaPath)
    {
        var loader = new SchemaLoader();
        return loader.LoadSchema(schemaPath);
    }

    public static TomlTable ParseToml(string content)
    {
        // Use reflection to access Tomlyn's Parse method since it's not directly exposed
        var assembly = typeof(TomlTable).Assembly;
        var tomlType = assembly.GetType("Tomlyn.Toml");
        if (tomlType == null)
        {
            throw new InvalidOperationException("Cannot find Tomlyn.Toml class");
        }

        var parseMethod = tomlType.GetMethod("Parse", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static, null, new[] { typeof(string) }, null);
        if (parseMethod == null)
        {
            throw new InvalidOperationException("Cannot find Tomlyn.Toml.Parse method");
        }

        var result = parseMethod.Invoke(null, new object[] { content });
        return (TomlTable)result!;
    }

    private TomlSchema LoadSchema(string schemaPath)
    {
        if (!File.Exists(schemaPath))
            throw new FileNotFoundException($"Schema file not found: {schemaPath}");

        var content = File.ReadAllText(schemaPath);
        var schemaDoc = ParseToml(content);

        // Read [toml-schema] metadata
        if (!schemaDoc.TryGetValue("toml-schema", out var tomlSchemaObj) || tomlSchemaObj is not TomlTable tomlSchema)
            throw new InvalidOperationException("Schema must have [toml-schema] metadata section");

        if (!tomlSchema.TryGetValue("version", out var versionObj) || versionObj is not string version)
            throw new InvalidOperationException("[toml-schema].version must be a string");

        // Parse types and elements
        var types = new Dictionary<string, SchemaDefinition>();
        if (schemaDoc.TryGetValue("types", out var typesObj) && typesObj is TomlTable typesTable)
        {
            foreach (var (typeName, typeValue) in typesTable)
            {
                if (typeValue is TomlTable typeTable)
                {
                    types[typeName] = ParseDefinition(typeTable, schemaDoc);
                }
            }
        }

        var elements = new Dictionary<string, SchemaDefinition>();
        if (schemaDoc.TryGetValue("elements", out var elementsObj) && elementsObj is TomlTable elementsTable)
        {
            foreach (var (elemName, elemValue) in elementsTable)
            {
                if (elemValue is TomlTable elemTable)
                {
                    elements[elemName] = ParseDefinition(elemTable, schemaDoc);
                }
            }
        }

        return new TomlSchema(version, types, elements);
    }

    private SchemaDefinition ParseDefinition(TomlTable table, TomlTable rootDoc)
    {
        var def = new SchemaDefinition();

        // Type
        if (table.TryGetValue("type", out var typeValue))
        {
            var typeName = typeValue?.ToString() ?? "any";
            def.Type = SchemaTypeExtensions.FromSchemaName(typeName);
        }

        // Basic properties
        if (table.TryGetValue("description", out var desc) && desc is string descStr)
            def.Description = descStr;

        if (table.TryGetValue("optional", out var opt) && opt is bool optBool)
            def.Optional = optBool;

        if (table.TryGetValue("default", out var defaultVal))
            def.DefaultValue = defaultVal;

        if (table.TryGetValue("deprecated", out var depr) && depr is bool deprBool)
            def.Deprecated = deprBool;

        // Validation constraints
        if (table.TryGetValue("pattern", out var pat) && pat is string patStr)
            def.Pattern = patStr;

        if (table.TryGetValue("keypattern", out var keyPat) && keyPat is string keyPatStr)
            def.KeyPattern = keyPatStr;

        if (table.TryGetValue("min", out var minVal) && minVal is long minLong)
            def.Min = minLong;

        if (table.TryGetValue("max", out var maxVal) && maxVal is long maxLong)
            def.Max = maxLong;

        if (table.TryGetValue("minlength", out var minLen) && minLen is long minLenLong)
            def.MinLength = minLenLong;

        if (table.TryGetValue("maxlength", out var maxLen) && maxLen is long maxLenLong)
            def.MaxLength = maxLenLong;

        if (table.TryGetValue("uniqueitems", out var unique) && unique is bool uniqueBool)
            def.UniqueItems = uniqueBool;

        if (table.TryGetValue("itemtype", out var itemType) && itemType is string itemTypeStr)
            def.ItemType = itemTypeStr;

        // Allowed values
        if (table.TryGetValue("allowedvalues", out var allowedVals) && allowedVals is TomlArray allowedArray)
        {
            def.AllowedValues = new List<object>(allowedArray.Cast<object>().Where(x => x != null));
        }

        // Union/composition
        if (table.TryGetValue("oneof", out var oneOf) && oneOf is TomlArray oneOfArray)
            def.OneOf = oneOfArray.Select(x => x?.ToString() ?? "").Where(s => !string.IsNullOrEmpty(s)).ToList();

        if (table.TryGetValue("anyof", out var anyOf) && anyOf is TomlArray anyOfArray)
            def.AnyOf = anyOfArray.Select(x => x?.ToString() ?? "").Where(s => !string.IsNullOrEmpty(s)).ToList();

        if (table.TryGetValue("allof", out var allOf) && allOf is TomlArray allOfArray)
            def.AllOf = allOfArray.Select(x => x?.ToString() ?? "").Where(s => !string.IsNullOrEmpty(s)).ToList();

        // Sibling rules
        if (table.TryGetValue("dependentrequired", out var depReq) && depReq is TomlArray depReqArray)
            def.DependentRequired = depReqArray.Select(x => x?.ToString() ?? "").Where(s => !string.IsNullOrEmpty(s)).ToList();

        if (table.TryGetValue("mutuallyexclusive", out var mutExcl) && mutExcl is TomlArray mutExclArray)
            def.MutuallyExclusive = mutExclArray.Select(x => x?.ToString() ?? "").Where(s => !string.IsNullOrEmpty(s)).ToList();

        if (table.TryGetValue("exactlyone", out var exactOne) && exactOne is TomlArray exactOneArray)
            def.ExactlyOne = exactOneArray.Select(x => x?.ToString() ?? "").Where(s => !string.IsNullOrEmpty(s)).ToList();

        // Tuple validation (items)
        if (table.TryGetValue("items", out var itemsVal) && itemsVal is TomlArray itemsArray)
        {
            var items = new List<(string key, List<object> values)>();
            foreach (var item in itemsArray)
            {
                if (item is TomlTable itemTable && itemTable.TryGetValue("type", out var itemTypeVal))
                {
                    // Store positional item types
                    items.Add(("index", new List<object> { itemTypeVal }));
                }
            }
            if (items.Count > 0)
                def.Items = items;
        }

        // Conditional (if/then/else)
        if (table.TryGetValue("if", out var ifVal) && ifVal is TomlTable ifTable)
        {
            SchemaDefinition? thenDef = null;
            if (table.TryGetValue("then", out var thenVal) && thenVal is TomlTable thenTable)
                thenDef = ParseDefinition(thenTable, rootDoc);

            SchemaDefinition? elseDef = null;
            if (table.TryGetValue("else", out var elseVal) && elseVal is TomlTable elseTable)
                elseDef = ParseDefinition(elseTable, rootDoc);

            def.Condition = new SchemaCondition(
                new Dictionary<string, object>(ifTable.Where(x => !DefinitionKeys.Contains(x.Key)).ToDictionary(x => x.Key, x => x.Value!)),
                thenDef,
                elseDef
            );
        }

        // Child elements/properties
        foreach (var (key, value) in table)
        {
            if (!DefinitionKeys.Contains(key) && value is TomlTable childTable)
            {
                def.Children[key] = ParseDefinition(childTable, rootDoc);
            }
        }

        return def;
    }
}
