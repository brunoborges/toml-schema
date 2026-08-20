namespace TomlSchema.Tests;

using Xunit;

public class ResolvedDuplicateReferencesTests : TestBase
{
    [Theory]
    [InlineData("oneof")]
    [InlineData("anyof")]
    [InlineData("allof")]
    public void RejectsDuplicateCompositionReferencesByResolvedIdentity(string property)
    {
        var localType = property == "allof" ? "type = \"string\"\n" : "";
        var schemaPath = Write($"duplicate-{property}-{Guid.NewGuid():N}.tosd", $$"""
            [toml-schema]
            version = "1.0.0"

            [types.foo]
            type = "string"

            [elements.value]
            {{localType}}{{property}} = ["types.foo", "foo"]
            """);

        var error = Assert.Throws<InvalidOperationException>(() => TomlSchema.Load(schemaPath));
        Assert.Equal(
            $"[elements].value {property} contains duplicate type references \"types.foo\" and \"foo\"; both resolve to foo",
            error.Message);
    }

    [Fact]
    public void AllowsRepeatedTupleItemReferences()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var schemaPath = Write($"tuple-{suffix}.tosd", """
            [toml-schema]
            version = "1.0.0"

            [types.coordinate]
            type = "float"

            [elements.point]
            type = "array"
            items = ["types.coordinate", "types.coordinate"]
            """);
        var documentPath = Write($"tuple-{suffix}.toml", "point = [1.0, 2.0]\n");

        var result = TomlSchema.Load(schemaPath).Validate(documentPath);
        Assert.True(result.IsValid);
    }
}
