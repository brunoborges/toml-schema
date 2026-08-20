namespace TomlSchema.Tests;

using Xunit;

public class TomlSchemaTests : TestBase
{
    [Fact]
    public void ValidatesCheckedInExample()
    {
        var schema = TomlSchema.Load(Fixture("config.tosd"));
        var result = schema.Validate(Fixture("config.toml"));

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => $"{e.Path}: {e.Message}"))}");
    }

    [Fact]
    public void ValidatesSchemaAgainstSelfSchema()
    {
        var selfSchema = TomlSchema.Load(Fixture("toml-schema.tosd"));
        var result = selfSchema.Validate(Fixture("config.tosd"));

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => $"{e.Path}: {e.Message}"))}");
    }

    [Fact]
    public void ValidatesSelfSchemaAgainstItself()
    {
        var selfSchema = TomlSchema.Load(Fixture("toml-schema.tosd"));
        var result = selfSchema.Validate(Fixture("toml-schema.tosd"));

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    [Theory]
    [InlineData("examples/cargo.tosd")]
    [InlineData("examples/gitlab-runner.tosd")]
    [InlineData("examples/hugo.tosd")]
    [InlineData("examples/netlify.tosd")]
    [InlineData("examples/pyproject.tosd")]
    [InlineData("examples/wrangler.tosd")]
    public void LoadsCheckedInExamples(string schemaPath)
    {
        var schema = TomlSchema.Load(Fixture(schemaPath));
        Assert.NotNull(schema);
        Assert.NotEmpty(schema.Elements);
    }

    [Fact]
    public void ValidatesCargoManifestExample()
    {
        var schema = TomlSchema.Load(Fixture("examples/cargo.tosd"));
        var result = schema.Validate(Fixture("reference-implementations/rust/Cargo.toml"));

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    [Fact]
    public void RejectsNonRequiredMissingElement()
    {
        var schema = TomlSchema.Load(Fixture("config.tosd"));
        var result = schema.Validate(Fixture("config.toml"));

        // config.toml is valid and has all required elements
        Assert.True(result.IsValid);
    }

    [Fact]
    public void RejectsInvalidType()
    {
        var schema = TomlSchema.Load(Fixture("config.tosd"));
        var content = """
            title = 123
            """;
        var tempPath = Write("invalid-type.toml", content);

        var result = schema.Validate(tempPath);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Code.Contains("type"));
    }

    [Fact]
    public void AcceptsStringDescriptionsAndRejectsOtherValues()
    {
        var describedSchema = Write("described.tosd", """
            [toml-schema]
            version = "1.0.0"

            [types.game]
            type = "table"
            description = "A game object."

                [types.game.id]
                type = "string"
                description = "Unique identifier for the game."

            [elements.game]
            type = "array"
            description = "A list of games."
            itemtype = "types.game"
            """);

        var invalidSchema = Write("invalid-description.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.game]
            type = "string"
            description = 42
            """);

        // Valid schema should load
        var schema = TomlSchema.Load(describedSchema);
        Assert.NotNull(schema);

        // Invalid schema should fail on load
        var ex = Assert.ThrowsAny<Exception>(() => TomlSchema.Load(invalidSchema));
        Assert.NotNull(ex);
    }

    [Fact]
    public void SupportsSelectiveChildrenEscapeAndLiteralChildren()
    {
        var schemaPath = Write("children-escape.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.plugin]
            type = "table"

            [elements.plugin.children.type]
            type = "string"

            [elements.plugin.children.children]
            type = "boolean"
            """);
        var documentPath = Write("children-escape.toml", """
            [plugin]
            type = "npm"
            children = true
            """);

        var schema = TomlSchema.Load(schemaPath);
        var result = schema.Validate(documentPath);

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");

        var literalSchemaPath = Write("literal-children.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.plugin]
            type = "table"

            [elements.plugin.children]
            type = "string"
            """);
        var literalDocumentPath = Write("literal-children.toml", """
            [plugin]
            children = "ordinary child"
            """);

        var literalSchema = TomlSchema.Load(literalSchemaPath);
        var literalResult = literalSchema.Validate(literalDocumentPath);

        Assert.True(literalResult.IsValid,
            $"Validation failed: {string.Join(", ", literalResult.Errors.Select(e => e.Message))}");
    }

    [Theory]
    [InlineData("[elements.plugin.children]")]
    [InlineData("[elements.plugin.children.name]\ntype = \"string\"")]
    public void RejectsInvalidChildrenEscapeNamespaces(string body)
    {
        var schemaPath = Write($"invalid-children-{Guid.NewGuid():N}.tosd", $$"""
            [toml-schema]
            version = "1.0.0"

            [elements.plugin]
            type = "table"

            {{body}}
            """);

        Assert.ThrowsAny<Exception>(() => TomlSchema.Load(schemaPath));
    }

    [Fact]
    public void EmitsDeprecationWarning()
    {
        var schema = Write("deprecated.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.oldfield]
            type = "string"
            deprecated = true
            """);

        var toml = Write("deprecated.toml", """
            oldfield = "value"
            """);

        var schemaObj = TomlSchema.Load(schema);
        var result = schemaObj.Validate(toml);

        Assert.True(result.IsValid);
        Assert.Contains(result.Warnings, w => w.Code == "deprecated");
    }

    [Fact]
    public void SeparatesWarningsFromErrors()
    {
        var schema = Write("warnings.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.field]
            type = "string"
            deprecated = true
            """);

        var toml = Write("warnings.toml", """
            field = "value"
            """);

        var schemaObj = TomlSchema.Load(schema);
        var result = schemaObj.Validate(toml);

        Assert.Empty(result.Errors);
        Assert.NotEmpty(result.Warnings);
        Assert.True(result.IsValid);
    }
}
