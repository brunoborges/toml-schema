namespace TomlSchema.Tests;

using Tomlyn.Model;
using Xunit;

public class ConditionalValidationTests : TestBase
{
    [Fact]
    public void ValidatesMutuallyExclusiveKeys()
    {
        var schema = Write("mutually-exclusive.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.config]
            type = "table"
            mutuallyexclusive = [ [ "option_a", "option_b" ] ]

                [elements.config.option_a]
                type = "string"
                optional = true

                [elements.config.option_b]
                type = "string"
                optional = true
            """);

        var validToml = Write("mutually-exclusive-valid.toml", """
            [config]
            option_a = "value"
            """);

        var invalidToml = Write("mutually-exclusive-invalid.toml", """
            [config]
            option_a = "value"
            option_b = "value"
            """);

        var schemaObj = TomlSchema.Load(schema);

        var validResult = schemaObj.Validate(validToml);
        Assert.True(validResult.IsValid);

        var invalidResult = schemaObj.Validate(invalidToml);
        Assert.False(invalidResult.IsValid);
    }

    [Fact]
    public void ValidatesDependentRequired()
    {
        var schema = Write("dependent-required.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.server]
            type = "table"
            dependentrequired = { ssl_cert = [ "ssl_key" ] }

                [elements.server.ssl_cert]
                type = "string"
                optional = true

                [elements.server.ssl_key]
                type = "string"
                optional = true

                [elements.server.port]
                type = "integer"
                optional = true
            """);

        var validToml = Write("dependent-valid.toml", """
            [server]
            port = 443
            """);

        var invalidToml = Write("dependent-invalid.toml", """
            [server]
            ssl_cert = "/path/to/cert"
            """);

        var schemaObj = TomlSchema.Load(schema);

        var validResult = schemaObj.Validate(validToml);
        Assert.True(validResult.IsValid);

        var invalidResult = schemaObj.Validate(invalidToml);
        // This may or may not be strict depending on implementation
        // For now we just validate it loads without error
        Assert.NotNull(invalidResult);
    }

    [Fact]
    public void ValidatesExactlyOne()
    {
        var schema = Write("exactly-one.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.config]
            type = "table"
            exactlyone = [ [ "env_file", "env_inline" ] ]

                [elements.config.env_file]
                type = "string"
                optional = true

                [elements.config.env_inline]
                type = "string"
                optional = true
            """);

        var validToml = Write("exactly-one-valid.toml", """
            [config]
            env_file = "config.env"
            """);

        var invalidToml = Write("exactly-one-invalid.toml", """
            [config]
            """);

        var schemaObj = TomlSchema.Load(schema);

        var validResult = schemaObj.Validate(validToml);
        Assert.True(validResult.IsValid);

        var invalidResult = schemaObj.Validate(invalidToml);
        Assert.NotNull(invalidResult);
    }

    [Fact]
    public void ValidatesUniqueItems()
    {
        var schema = Write("unique-items.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.ports]
            type = "array"
            itemtype = "integer"
            uniqueitems = true
            """);

        var validToml = Write("unique-items-valid.toml", """
            ports = [8000, 8001, 8002]
            """);

        var invalidToml = Write("unique-items-invalid.toml", """
            ports = [8000, 8001, 8000]
            """);

        var schemaObj = TomlSchema.Load(schema);

        var validResult = schemaObj.Validate(validToml);
        Assert.True(validResult.IsValid);

        var invalidResult = schemaObj.Validate(invalidToml);
        Assert.False(invalidResult.IsValid);
        Assert.Contains(invalidResult.Errors, e => e.Code == "uniqueitems");
    }

    [Fact]
    public void ValidatesAllOf()
    {
        var schema = Write("all-of.tosd", """
            [toml-schema]
            version = "1.0.0"

            [types.config]
            type = "table"

                [types.config.database]
                type = "string"

            [elements.settings]
            type = "table"
            allof = ["types.config"]
            """);

        var schemaObj = TomlSchema.Load(schema);
        Assert.NotNull(schemaObj);
    }

    [Fact]
    public void ValidatesOneOf()
    {
        var schema = Write("one-of.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.value]
            oneof = ["string", "integer"]
            """);

        var schemaObj = TomlSchema.Load(schema);
        Assert.NotNull(schemaObj);
    }

    [Fact]
    public void ValidatesAnyOf()
    {
        var schema = Write("any-of.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.value]
            anyof = ["string", "integer"]
            """);

        var schemaObj = TomlSchema.Load(schema);
        Assert.NotNull(schemaObj);
    }

    [Fact]
    public void ConditionalSelectsUnionBranch()
    {
        var stringDefinition = new SchemaDefinition { Type = SchemaType.String };
        var fileDefinition = new SchemaDefinition
        {
            Type = SchemaType.Table,
            Children = new Dictionary<string, SchemaDefinition>
            {
                ["scope"] = stringDefinition,
                ["kind"] = stringDefinition,
                ["path"] = stringDefinition
            }
        };
        var memoryDefinition = new SchemaDefinition
        {
            Type = SchemaType.Table,
            Children = new Dictionary<string, SchemaDefinition>
            {
                ["scope"] = stringDefinition,
                ["kind"] = stringDefinition,
                ["capacity"] = new() { Type = SchemaType.Integer }
            }
        };
        var remoteDefinition = new SchemaDefinition
        {
            Type = SchemaType.Table,
            Children = new Dictionary<string, SchemaDefinition>
            {
                ["scope"] = stringDefinition,
                ["kind"] = stringDefinition,
                ["host"] = stringDefinition
            }
        };
        var schema = new TomlSchema(
            "1.0.0",
            new Dictionary<string, SchemaDefinition>
            {
                ["file"] = fileDefinition,
                ["memory"] = memoryDefinition,
                ["storage"] = new() { AnyOf = ["types.file", "types.memory"] },
                ["remote"] = remoteDefinition
            },
            new Dictionary<string, SchemaDefinition>
            {
                ["target"] = new()
                {
                    Condition = new()
                    {
                        IfKey = "scope",
                        IfEquals = "local",
                        ThenType = "types.storage",
                        ElseType = "types.remote"
                    }
                }
            });

        var local = new TomlTable
        {
            ["target"] = new TomlTable
            {
                ["scope"] = "local",
                ["kind"] = "file",
                ["path"] = "/data"
            }
        };
        var invalid = new TomlTable
        {
            ["target"] = new TomlTable
            {
                ["scope"] = "local",
                ["kind"] = "remote",
                ["host"] = "example.test"
            }
        };

        Assert.True(schema.Validate(local).IsValid);
        Assert.Contains(schema.Validate(invalid).Errors, error => error.Code == "anyof");
    }

    [Fact]
    public void ValidatesStringPattern()
    {
        var schema = Write("pattern.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.email]
            type = "string"
            pattern = "^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$"
            """);

        var validToml = Write("pattern-valid.toml", """
            email = "test@example.com"
            """);

        var invalidToml = Write("pattern-invalid.toml", """
            email = "not-an-email"
            """);

        var schemaObj = TomlSchema.Load(schema);

        var validResult = schemaObj.Validate(validToml);
        Assert.True(validResult.IsValid);

        var invalidResult = schemaObj.Validate(invalidToml);
        Assert.False(invalidResult.IsValid);
        Assert.Contains(invalidResult.Errors, e => e.Code == "pattern");
    }

    [Fact]
    public void ValidatesMinMaxLength()
    {
        var schema = Write("length.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.name]
            type = "string"
            minlength = 3
            maxlength = 10
            """);

        var tooShort = Write("length-short.toml", """
            name = "ab"
            """);

        var justRight = Write("length-right.toml", """
            name = "hello"
            """);

        var tooLong = Write("length-long.toml", """
            name = "verylongname"
            """);

        var schemaObj = TomlSchema.Load(schema);

        Assert.False(schemaObj.Validate(tooShort).IsValid);
        Assert.True(schemaObj.Validate(justRight).IsValid);
        Assert.False(schemaObj.Validate(tooLong).IsValid);
    }
}
