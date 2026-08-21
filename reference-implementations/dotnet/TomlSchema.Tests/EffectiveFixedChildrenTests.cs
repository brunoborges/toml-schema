namespace TomlSchema.Tests;

using Xunit;

public class EffectiveFixedChildrenTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());

    public EffectiveFixedChildrenTests() => Directory.CreateDirectory(_tempDir);

    [Fact]
    public void SiblingRulesUseOnlyDeterminateEffectiveFixedChildren()
    {
        var rejected = Write("union-operands.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.left]
            type = "table"
            [types.left.first]
            type = "string"
            optional = true
            [types.right]
            type = "table"
            [types.right.second]
            type = "string"
            optional = true
            [types.choice]
            oneof = ["types.left", "types.right"]
            [elements.value]
            type = "table"
            allof = ["types.choice"]
            exactlyone = [["first", "second"]]
            """);
        var error = Assert.Throws<SchemaException>(() => global::TomlSchema.TomlSchema.Load(rejected));
        Assert.Contains("unknown fixed child", error.Message);

        var accepted = Write("type-selected-operands.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.base]
            type = "table"
            [types.base.first]
            type = "string"
            optional = true
            [types.base.second]
            type = "string"
            optional = true
            [types.indirect]
            type = "types.base"
            [elements.value]
            type = "table"
            allof = ["types.indirect"]
            exactlyone = [["first", "second"]]
            """);
        global::TomlSchema.TomlSchema.Load(accepted);
    }

    [Fact]
    public void AllOfUsesSelectedUnionAlternativeClosure()
    {
        var schema = global::TomlSchema.TomlSchema.Load(Write("union-closure.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.base]
            type = "table"
            [types.base.id]
            type = "integer"
            [types.named]
            type = "table"
            [types.named.name]
            type = "string"
            [types.labelled]
            type = "table"
            [types.labelled.label]
            type = "string"
            [types.identity]
            oneof = ["types.named", "types.labelled"]
            [elements.item]
            type = "table"
            allof = ["types.base", "types.identity"]
            [elements.item.enabled]
            type = "boolean"
            optional = true
            """));
        foreach (var (name, body) in new[]
        {
            ("named", "[item]\nid = 1\nname = \"a\"\n"),
            ("labelled", "[item]\nid = 1\nlabel = \"a\"\n"),
            ("enabled", "[item]\nid = 1\nname = \"a\"\nenabled = true\n")
        })
        {
            var result = schema.Validate(Write(name + ".toml", body));
            Assert.True(result.IsValid, string.Join(", ", result.Errors));
        }
        foreach (var (name, body) in new[]
        {
            ("both", "[item]\nid = 1\nname = \"a\"\nlabel = \"a\"\n"),
            ("neither", "[item]\nid = 1\n")
        })
        {
            var result = schema.Validate(Write(name + ".toml", body));
            Assert.False(result.IsValid);
            Assert.Contains(result.Errors, error =>
                error.Path == "$.item" && error.Message.Contains("found 0"));
        }
        var unexpected = schema.Validate(Write(
            "bogus.toml", "[item]\nid = 1\nname = \"a\"\nbogus = true\n"));
        Assert.Contains(unexpected.Errors, error => error.Path == "$.item.bogus");
        var missing = schema.Validate(Write("missing.toml", "[item]\nname = \"a\"\n"));
        Assert.Contains(missing.Errors, error => error.Path == "$.item.id");
    }

    [Fact]
    public void ConditionalAllOfUsesSelectedBranchClosure()
    {
        var schema = global::TomlSchema.TomlSchema.Load(Write("conditional-closure.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.common]
            type = "table"
            [types.common.id]
            type = "integer"
            [types.sqlite]
            type = "table"
            [types.sqlite.engine]
            type = "string"
            [types.sqlite.file]
            type = "string"
            [types.server]
            type = "table"
            [types.server.engine]
            type = "string"
            [types.server.host]
            type = "string"
            [types.database]
            if = { key = "engine", equals = "sqlite" }
            then = "types.sqlite"
            else = "types.server"
            allof = ["types.common"]
            [elements.composed]
            type = "table"
            allof = ["types.database"]
            """));
        var result = schema.Validate(Write(
            "conditional.toml",
            "[composed]\nid = 2\nengine = \"postgresql\"\nhost = \"db.internal\"\n"));
        Assert.True(result.IsValid, string.Join(", ", result.Errors));
    }

    [Fact]
    public void OpenAlternativeDoesNotReopenComposedTable()
    {
        var schema = global::TomlSchema.TomlSchema.Load(Write("open-union.tosd", """
            [toml-schema]
            version = "1.0.0"
            [types.base]
            type = "table"
            [types.base.name]
            type = "string"
            [types.open]
            type = "table"
            [types.closed]
            type = "table"
            [types.closed.known]
            type = "string"
            [types.identity]
            oneof = ["types.open", "types.closed"]
            [elements.item]
            type = "table"
            allof = ["types.base", "types.identity"]
            """));
        var valid = schema.Validate(Write("known.toml", "[item]\nname = \"a\"\nknown = \"x\"\n"));
        Assert.True(valid.IsValid, string.Join(", ", valid.Errors));
        var invalid = schema.Validate(Write("arbitrary.toml", "[item]\nname = \"a\"\narbitrary = true\n"));
        Assert.Contains(invalid.Errors, error =>
            error.Path == "$.item" && error.Message.Contains("found 0"));
    }

    private string Write(string name, string content)
    {
        var path = Path.Combine(_tempDir, name);
        File.WriteAllText(path, content);
        return path;
    }

    public void Dispose() => Directory.Delete(_tempDir, true);
}
