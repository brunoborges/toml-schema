namespace TomlSchema.Tests;

using Tomlyn;
using Tomlyn.Model;
using Xunit;

public class SchemaExtractionTests
{
    [Fact]
    public void GeneratesDeterministicSchemaWithQuotedKeys()
    {
        var document = TomlSerializer.Deserialize<TomlTable>("""
            zebra = "last"
            alpha = 1
            ratio = 1.5
            flag = true
            numbers = [1, 2]
            mixed = [1, "two"]
            [nested]
            "google.com" = "value"
            [toml-schema]
            location = "ignored.tosd"
            """)!;

        var schema = TomlSchema.GenerateSchema(document);

        Assert.Contains("[elements.alpha]\ntype = \"integer\"", schema);
        Assert.Contains("[elements.numbers]\ntype = \"array\"\nitemtype = \"integer\"", schema);
        Assert.Contains("[elements.mixed]\ntype = \"array\"\nitemtype = \"any\"", schema);
        Assert.Contains("[elements.nested.\"google.com\"]\ntype = \"string\"", schema);
        Assert.DoesNotContain("[elements.toml-schema]", schema);
        Assert.DoesNotContain("default =", schema);
        Assert.True(schema.IndexOf("[elements.alpha]", StringComparison.Ordinal)
            < schema.IndexOf("[elements.zebra]", StringComparison.Ordinal));
    }

    [Fact]
    public void ExtractsReloadableSchemaWithAllTemporalTypes()
    {
        var directory = Path.Combine(Path.GetTempPath(), "toml-schema-extraction-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var documentPath = Path.Combine(directory, "source.toml");
        File.WriteAllText(documentPath, """
            title = "Example"
            offset = 1979-05-27T07:32:00-08:00
            local_datetime = 1979-05-27T07:32:00
            local_date = 1979-05-27
            local_time = 07:32:00
            ports = [8080, 8081]
            [owner]
            name = "Ada"
            [toml-schema]
            location = "ignored.tosd"
            """);
        var schemaPath = Path.Combine(directory, "generated.tosd");

        TomlSchema.ExtractSchemaFile(documentPath, schemaPath);

        var schema = File.ReadAllText(schemaPath);
        Assert.Contains("type = \"offset-date-time\"", schema);
        Assert.Contains("type = \"local-date-time\"", schema);
        Assert.Contains("type = \"local-date\"", schema);
        Assert.Contains("type = \"local-time\"", schema);
        var result = TomlSchema.Load(schemaPath).Validate(documentPath);
        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(error => error.Message))}");
    }
}
