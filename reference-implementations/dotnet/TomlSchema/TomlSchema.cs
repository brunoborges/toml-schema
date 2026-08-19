namespace TomlSchema;

using Tomlyn.Model;

/// <summary>
/// Main entry point for TOML Schema loading and validation.
/// </summary>
public class TomlSchema
{
    private readonly Dictionary<string, SchemaDefinition> _types;
    private readonly Dictionary<string, SchemaDefinition> _elements;
    private readonly string _version;

    /// <summary>
    /// Initializes a schema from its version, reusable types, and root elements.
    /// </summary>
    public TomlSchema(string version, Dictionary<string, SchemaDefinition> types, Dictionary<string, SchemaDefinition> elements)
    {
        _version = version ?? throw new ArgumentNullException(nameof(version));
        _types = new Dictionary<string, SchemaDefinition>(types ?? new());
        _elements = new Dictionary<string, SchemaDefinition>(elements ?? new());
    }

    /// <summary>
    /// Loads a schema from a .tosd file.
    /// </summary>
    public static TomlSchema Load(string schemaPath) => SchemaLoader.Load(schemaPath);

    /// <summary>
    /// Validates a TOML document against this schema.
    /// </summary>
    public ValidationResult Validate(string tomlPath)
    {
        try
        {
            var content = File.ReadAllText(tomlPath);
            var doc = SchemaLoader.ParseToml(content);
            return Validate(doc);
        }
        catch (Exception ex)
        {
            return new ValidationResult(new[]
            {
                new ValidationError("$", $"TOML parse error: {ex.Message}", "parse-error")
            }.ToList());
        }
    }

    /// <summary>
    /// Validates a parsed TOML table against this schema.
    /// </summary>
    public ValidationResult Validate(TomlTable document)
    {
        var validator = new SchemaValidator(this);
        return validator.Validate(document);
    }

    /// <summary>
    /// Discovers and loads the schema referenced by a TOML document's reserved
    /// <c>[toml-schema].location</c>, following the resolution and version-compatibility
    /// rules of SPEC.md's "TOML Reference of a TOML Schema" section.
    /// </summary>
    /// <remarks>
    /// A relative <c>location</c> is resolved against <paramref name="documentPath"/>'s
    /// parent, not the current working directory. An absolute local path or a
    /// <c>file</c> URI with a hierarchical, local path is also supported. Unsupported URI
    /// schemes, opaque <c>file</c> URIs, non-local hosts, query/fragment components, and
    /// encoded path separators are rejected. When the document declares an optional
    /// <c>[toml-schema].version</c>, a major-version mismatch against the resolved schema
    /// fails discovery, while any other version difference is reported as a warning on the
    /// returned <see cref="DiscoveredSchema"/>.
    /// </remarks>
    /// <param name="documentPath">The TOML document whose schema-reference metadata is discovered.</param>
    /// <returns>The discovered schema, the parsed document, and any version-compatibility warnings.</returns>
    public static DiscoveredSchema Discover(string documentPath) => SchemaDiscovery.Discover(documentPath);

    /// <summary>
    /// Discovers the schema referenced by a TOML document and validates that same document
    /// against it in one step, without parsing the document twice.
    /// </summary>
    /// <param name="documentPath">The TOML document to discover a schema for and validate.</param>
    /// <returns>The validation result, including any discovery version-compatibility warnings.</returns>
    public static ValidationResult ValidateDocument(string documentPath) => Discover(documentPath).Validate();

    /// <summary>Gets the schema language version.</summary>
    public string Version => _version;

    /// <summary>Gets the reusable type definitions keyed by name.</summary>
    public IReadOnlyDictionary<string, SchemaDefinition> Types => _types;

    /// <summary>Gets the root element definitions keyed by name.</summary>
    public IReadOnlyDictionary<string, SchemaDefinition> Elements => _elements;

    internal SchemaDefinition? ResolveType(string? typeRef)
    {
        if (string.IsNullOrEmpty(typeRef))
            return null;

        if (typeRef.StartsWith("types."))
        {
            var typeName = typeRef.Substring(6);
            return _types.TryGetValue(typeName, out var type) ? type : null;
        }

        return SchemaTypeExtensions.AllTypeNames.Contains(typeRef)
            ? new SchemaDefinition { Type = SchemaTypeExtensions.FromSchemaName(typeRef) }
            : null;
    }

    /// <summary>
    /// Gets the effective default value for an element or type.
    /// </summary>
    public object? DefaultValue(params string[] elementPath)
    {
        if (elementPath.Length == 0)
            throw new ArgumentException("Element path must not be empty", nameof(elementPath));

        if (!_elements.TryGetValue(elementPath[0], out var definition))
            return null;

        for (int i = 1; definition != null && i < elementPath.Length; i++)
        {
            if (!definition.Children.TryGetValue(elementPath[i], out definition))
                return null;
        }

        return definition?.Default;
    }

    /// <summary>Returns a concise description of this schema.</summary>
    public override string ToString() => $"TomlSchema(version={_version}, elements={_elements.Count})";
}
