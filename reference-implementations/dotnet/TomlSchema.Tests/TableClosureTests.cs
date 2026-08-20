namespace TomlSchema.Tests;

using Xunit;

/// <summary>
/// Covers closed-table semantics: a table with a non-empty fixed-child set
/// rejects undeclared keys, while a table with no declared children is open.
/// Mirrors the behavioral cases covered by the Go and Rust reference
/// implementations.
/// </summary>
public class TableClosureTests : TestBase
{
    [Fact]
    public void RejectsUnexpectedKeyInNestedClosedTable()
    {
        var schema = TomlSchema.Load(Write("closure-nested.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.parent]
            type = "table"

                [elements.parent.known]
                type = "string"
            """));

        var result = schema.Validate(Write("closure-nested.toml", """
            [parent]
            known = "a"
            bogus = "b"
            """));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Code == "unexpected-key" && e.Path == "$.parent.bogus");
    }

    [Fact]
    public void RejectsUnexpectedKeyInDeeplyNestedClosedTable()
    {
        var schema = TomlSchema.Load(Write("closure-deep.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.outer]
            type = "table"

                [elements.outer.inner]
                type = "table"

                    [elements.outer.inner.known]
                    type = "string"
            """));

        var result = schema.Validate(Write("closure-deep.toml", """
            [outer.inner]
            known = "a"
            bogus = "b"
            """));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Code == "unexpected-key" && e.Path == "$.outer.inner.bogus");
    }

    [Fact]
    public void AcceptsAnyKeyInOpenTable()
    {
        var schema = TomlSchema.Load(Write("closure-open.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.parent]
            type = "table"
            """));

        var result = schema.Validate(Write("closure-open.toml", """
            [parent]
            anything = "a"
            goes = "b"
            """));

        Assert.True(result.IsValid,
            string.Join(", ", result.Errors.Select(e => $"{e.Path}: {e.Message}")));
    }

    [Fact]
    public void ClosesTableOverReferencedTypeChildren()
    {
        var schema = TomlSchema.Load(Write("closure-ref.tosd", """
            [toml-schema]
            version = "1.0.0"

            [types.entry]
            type = "table"

                [types.entry.known]
                type = "string"

            [elements.parent]
            type = "types.entry"
            """));

        var result = schema.Validate(Write("closure-ref.toml", """
            [parent]
            known = "a"
            bogus = "b"
            """));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Code == "unexpected-key" && e.Path == "$.parent.bogus");
    }

    [Fact]
    public void ClosesComposedTableOverUnionOfAllOfChildren()
    {
        var schema = TomlSchema.Load(Write("closure-allof.tosd", """
            [toml-schema]
            version = "1.0.0"

            [types.base]
            type = "table"

                [types.base.name]
                type = "string"

            [elements.settings]
            type = "table"
            allof = ["types.base"]

                [elements.settings.extra]
                type = "string"
            """));

        var valid = schema.Validate(Write("closure-allof-valid.toml", """
            [settings]
            name = "a"
            extra = "b"
            """));
        Assert.True(valid.IsValid,
            string.Join(", ", valid.Errors.Select(e => $"{e.Path}: {e.Message}")));

        var invalid = schema.Validate(Write("closure-allof-invalid.toml", """
            [settings]
            name = "a"
            extra = "b"
            bogus = "c"
            """));
        Assert.False(invalid.IsValid);
        Assert.Contains(invalid.Errors, e => e.Code == "unexpected-key" && e.Path == "$.settings.bogus");
    }

    [Fact]
    public void AcceptsDynamicKeysInCollection()
    {
        var schema = TomlSchema.Load(Write("closure-collection.tosd", """
            [toml-schema]
            version = "1.0.0"

            [types.entry]
            type = "table"

                [types.entry.value]
                type = "string"

            [elements.registry]
            type = "collection"
            itemtype = "types.entry"
            """));

        var result = schema.Validate(Write("closure-collection.toml", """
            [registry.alpha]
            value = "a"

            [registry.beta]
            value = "b"
            """));

        Assert.True(result.IsValid,
            string.Join(", ", result.Errors.Select(e => $"{e.Path}: {e.Message}")));
    }
}
