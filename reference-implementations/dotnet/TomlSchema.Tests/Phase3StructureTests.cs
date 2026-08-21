namespace TomlSchema.Tests;

using Xunit;

public class Phase3StructureTests : TestBase
{
    [Fact]
    public void LoadsPureAllOfMixin()
    {
        var schema = global::TomlSchema.TomlSchema.Load(Write("phase3-pure-allof.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.named]
            type = "table"
            [types.named.name]
            type = "string"
            [types.packageBase]
            type = "table"
            [types.packageBase.version]
            type = "string"
            [types.package]
            allof = ["types.packageBase", "types.named"]
            dependentrequired = { name = ["version"] }
            [types.positive]
            type = "integer"
            min = 1
            [types.small]
            type = "integer"
            max = 10
            [types.count]
            allof = ["types.positive", "types.small"]
            [elements.pkg]
            type = "types.package"
            [elements.count]
            type = "types.count"
            """));
        Assert.True(schema.Validate(Write("phase3-pure-allof.toml",
            "pkg = { name = \"x\", version = \"1\" }\ncount = 5\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-pure-allof-invalid.toml",
            "pkg = { name = \"x\", version = \"1\" }\ncount = 0\n")).IsValid);
    }

    [Fact]
    public void RejectsMixedKindPureAllOfAtLoad()
    {
        var path = Write("phase3-mixed-allof.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.aTable]
            type = "table"
            [types.aTable.x]
            type = "string"
            [types.anArray]
            type = "array"
            itemtype = "string"
            [types.bad]
            allof = ["types.aTable", "types.anArray"]
            [elements.value]
            type = "types.bad"
            """);
        Assert.ThrowsAny<Exception>(() => global::TomlSchema.TomlSchema.Load(path));
    }

    [Fact]
    public void ValidatesInlineArrayPattern()
    {
        var schema = global::TomlSchema.TomlSchema.Load(Write("phase3-array-pattern.tosd", """
            [toml-schema]
            version = "1.0.0"
            [elements.tags]
            type = "array"
            itemtype = "string"
            pattern = '^[a-z]+$'
            """));
        Assert.True(schema.Validate(Write("phase3-array-pattern-valid.toml",
            "tags = [\"alpha\", \"beta\"]\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-array-pattern-invalid.toml",
            "tags = [\"alpha\", \"Beta\"]\n")).IsValid);
    }

    [Fact]
    public void ValidatesInlineCollectionMemberConstraints()
    {
        var schema = global::TomlSchema.TomlSchema.Load(Write("phase3-collection-constraints.tosd", """
            [toml-schema]
            version = "1.0.0"
            [elements.ports]
            type = "collection"
            itemtype = "integer"
            min = 1
            max = 65535
            [elements.roles]
            type = "collection"
            itemtype = "string"
            allowedvalues = ["admin", "reader"]
            [elements.tags]
            type = "collection"
            itemtype = "string"
            pattern = '^[a-z]+@example\.com$'
            [elements.emails]
            type = "collection"
            itemtype = "string"
            format = "email"
            """));
        Assert.True(schema.Validate(Write("phase3-collection-valid.toml",
            "[ports]\nhttp = 80\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-collection-min-invalid.toml",
            "[ports]\nhttp = 0\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-collection-max-invalid.toml",
            "[ports]\nhttp = 70000\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-collection-allowed-invalid.toml",
            "[ports]\nhttp = 80\n[roles]\nowner = \"root\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-collection-pattern-invalid.toml",
            "[ports]\nhttp = 80\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"Stable\"\n[emails]\nowner = \"admin@example.com\"\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-collection-format-invalid.toml",
            "[ports]\nhttp = 80\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"not-an-email\"\n")).IsValid);
    }

    [Fact]
    public void RejectsDuplicateInlineAndItemTypeConstraintAtLoad()
    {
        var path = Write("phase3-duplicate-constraint.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.item]
            type = "integer"
            min = 0
            [elements.values]
            type = "array"
            itemtype = "types.item"
            min = -10
            """);
        Assert.ThrowsAny<Exception>(() => global::TomlSchema.TomlSchema.Load(path));
    }

    [Fact]
    public void AllowsInlineConstraintMatchingItemTypeAllOfConstraint()
    {
        var schema = global::TomlSchema.TomlSchema.Load(Write("phase3-inherited-constraint.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.mixin]
            type = "string"
            allowedvalues = ["a", "b"]
            [types.item]
            type = "string"
            allof = ["types.mixin"]
            [elements.values]
            type = "array"
            itemtype = "types.item"
            allowedvalues = ["b", "c"]
            """));
        Assert.True(schema.Validate(Write("phase3-intersection-valid.toml", "values = [\"b\"]\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-inline-invalid.toml", "values = [\"a\"]\n")).IsValid);
        Assert.False(schema.Validate(Write("phase3-inherited-invalid.toml", "values = [\"c\"]\n")).IsValid);
    }

    [Fact]
    public void RejectsPerMemberAllowedValuesOnContainers()
    {
        var cases = new[]
        {
            "[elements.value]\ntype = \"array\"\nitemtype = \"integer\"\nallowedvalues = [5, 50]\nmin = 10\n",
            "[elements.value]\ntype = \"collection\"\nitemtype = \"integer\"\nallowedvalues = [5, 50]\nmin = 10\n",
            "[elements.value]\ntype = \"array\"\nitemtype = \"integer\"\nallowedvalues = [2, 3]\nmax = 2\n",
            "[elements.value]\ntype = \"array\"\nitemtype = \"string\"\nallowedvalues = [\"ok@example.com\", \"nope\"]\nformat = \"email\"\n",
            "[elements.value]\ntype = \"collection\"\nitemtype = \"string\"\nallowedvalues = [\"ok@example.com\", \"nope\"]\nformat = \"email\"\n",
        };
        for (var i = 0; i < cases.Length; i++)
        {
            var path = Write($"phase3-invalid-container-{i}.tosd",
                "[toml-schema]\nversion = \"1.0.0\"\n" + cases[i]);
            Assert.ThrowsAny<Exception>(() => global::TomlSchema.TomlSchema.Load(path));
        }

        var schema = global::TomlSchema.TomlSchema.Load(Write("phase3-container-length.tosd", """
            [toml-schema]
            version = "1.0.0"
            [elements.value]
            type = "array"
            itemtype = "string"
            allowedvalues = ["aaaa", "bbbbb"]
            maxlength = 2
            """));
        Assert.True(schema.Validate(Write("phase3-container-length.toml", "value = [\"aaaa\"]\n")).IsValid);
    }
}

