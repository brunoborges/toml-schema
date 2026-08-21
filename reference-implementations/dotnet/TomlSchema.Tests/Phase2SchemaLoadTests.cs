namespace TomlSchema.Tests;

using Xunit;

public class Phase2SchemaLoadTests : TestBase
{
    private static string Schema(string name, string definition) =>
        Write(name, "[toml-schema]\nversion = \"1.0.0\"\n" + definition + "\n");

    [Fact]
    public void NormalizesPrefixedBuiltinsBeforeSelectorClassification()
    {
        TomlSchema.Load(Schema("phase2-prefixed.tosd", """
            [elements.port]
            type = "types.integer"
            min = 1
            max = 65535
            """));

        Assert.ThrowsAny<Exception>(() => TomlSchema.Load(
            Schema("phase2-types-any.tosd", """
                [elements.value]
                oneof = ["types.any"]
                """)));
    }

    [Fact]
    public void RejectsInvalidAndNonPortablePatternsAtSchemaLoad()
    {
        var cases = new[]
        {
            ("invalid", "type = \"string\"\npattern = \"[\"", "invalid-pattern"),
            ("shorthand", """
                type = "string"
                pattern = "\\d+"
                """, "unsupported-pattern"),
            ("lookaround-key", """
                type = "collection"
                itemtype = "string"
                keypattern = "(?=x)"
                """, "unsupported-pattern")
        };
        foreach (var (name, body, expected) in cases)
        {
            var error = Assert.ThrowsAny<Exception>(() => TomlSchema.Load(
                Schema($"phase2-{name}.tosd", "[elements.value]\n" + body)));
            Assert.Contains(expected, error.Message);
        }
    }

    [Fact]
    public void LoadsPortableCharacterEscapesAndEscapedMetacharacters()
    {
        TomlSchema.Load(Schema("phase2-portable-escapes.tosd", """
            [elements.whitespace]
            type = "string"
            pattern = '[ \t]'
            [elements.controls]
            type = "string"
            pattern = '\t\n\r\f\v\a'
            [elements.dot]
            type = "string"
            pattern = '\.'
            """));
    }

    [Fact]
    public void RejectsClosedConditionalBranchesOmittingDiscriminator()
    {
        foreach (var missing in new[] { "then", "else" })
        {
            var thenChild = missing == "then" ? "value" : "engine";
            var elseChild = missing == "else" ? "value" : "engine";
            Assert.ThrowsAny<Exception>(() => TomlSchema.Load(
                Schema($"phase2-{missing}.tosd", $$"""
                    [types.selected]
                    type = "table"
                    [types.selected.{{thenChild}}]
                    type = "string"
                    [types.fallback]
                    type = "table"
                    [types.fallback.{{elseChild}}]
                    type = "string"
                    [elements.item]
                    if = { key = "engine", equals = "sqlite" }
                    then = "types.selected"
                    else = "types.fallback"
                    """)));
        }
    }

    [Fact]
    public void RejectsNonTableConditionalDefaultAtSchemaLoad()
    {
        Assert.ThrowsAny<Exception>(() => TomlSchema.Load(
            Schema("phase2-default.tosd", """
                [types.selected]
                type = "table"
                [types.fallback]
                type = "table"
                [elements.item]
                if = { key = "engine", equals = "sqlite" }
                then = "types.selected"
                else = "types.fallback"
                default = "sqlite"
                """)));
    }
}
