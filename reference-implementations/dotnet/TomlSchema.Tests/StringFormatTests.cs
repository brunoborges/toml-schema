namespace TomlSchema.Tests;

using Tomlyn.Model;
using Xunit;

public class StringFormatTests : TestBase
{
    public static TheoryData<string, string, string> FormatCases => new()
    {
        { "email", "simple@example.com", "simple..dot@example.com" },
        { "uuid", "01234567-89ab-cdef-0123-456789abcdef", "{01234567-89ab-cdef-0123-456789abcdef}" },
        { "uri", "https://example.com/a%20b?x=1", "relative/path" },
        { "hostname", "www.example.com.", "-bad.example" },
        { "ipv4", "192.0.2.1", "192.168.001.1" },
        { "ipv6", "2001:db8::192.0.2.1", "2001:db8::192.168.001.1" }
    };

    [Theory]
    [MemberData(nameof(FormatCases))]
    public void ValidatesSupportedFormats(string format, string valid, string invalid)
    {
        var schema = Schema(format);

        Assert.True(Validate(schema, valid).IsValid);
        var result = Validate(schema, invalid);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Code == "format"
            && error.Message.Contains(format, StringComparison.Ordinal));
    }

    public static TheoryData<string, bool> EmailCases => new()
    {
        { "first.last+tag@example.com", true },
        { "\"quoted local\"@example.com", true },
        { "\"contains@sign\"@example.com", true },
        { "\"escaped\\\"quote\"@example.com", true },
        { "postmaster@[192.0.2.1]", true },
        { "postmaster@[IPv6:2001:db8::1]", true },
        { "postmaster@[TAG:value]", true },
        { "postmaster@[TAG-:value]", false },
        { ".leading@example.com", false },
        { "trailing.@example.com", false },
        { "two..dots@example.com", false },
        { "unquoted space@example.com", false },
        { "\"unterminated@example.com", false },
        { "nonascii-é@example.com", false },
        { "user@example..com", false },
        { "user@[IPv6:192.0.2.1]", false }
    };

    [Theory]
    [MemberData(nameof(EmailCases))]
    public void ValidatesRfc5321MailboxCases(string mailbox, bool expected) =>
        Assert.Equal(expected, Validate(Schema("email"), mailbox).IsValid);

    [Fact]
    public void EnforcesEmailOctetLimits()
    {
        Assert.True(Validate(Schema("email"), $"{new string('a', 64)}@example.com").IsValid);
        Assert.False(Validate(Schema("email"), $"{new string('a', 65)}@example.com").IsValid);

        var domain = string.Join(".", Enumerable.Repeat(new string('a', 63), 3))
            + "." + new string('b', 61);
        Assert.Equal(253, domain.Length);
        Assert.False(Validate(Schema("email"), $"a@{domain}").IsValid);
    }

    [Theory]
    [InlineData("urn:isbn:9780131103627", true)]
    [InlineData("mailto:user@example.com", true)]
    [InlineData("https://example.com/bad%2", false)]
    [InlineData("https://example.com/{bad}", false)]
    [InlineData("http://example.com/#first#second", false)]
    public void ValidatesAbsoluteRfc3986Uris(string uri, bool expected) =>
        Assert.Equal(expected, Validate(Schema("uri"), uri).IsValid);

    [Theory]
    [InlineData("integer", "email", "format is valid only")]
    [InlineData("types.text", "email", "format is valid only")]
    [InlineData("string", "date", "unknown string format")]
    public void RejectsIncompatibleOrUnknownFormatsAtSchemaLoad(
        string type, string format, string expectedMessage)
    {
        var schemaPath = Write($"invalid-format-{Guid.NewGuid():N}.tosd", $$"""
            [toml-schema]
            version = "1.0.0"

            [types.text]
            type = "string"

            [elements.value]
            type = "{{type}}"
            format = "{{format}}"
            """);

        var error = Assert.Throws<SchemaException>(() => TomlSchema.Load(schemaPath));
        Assert.Contains(expectedMessage, error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void RejectsNonStringFormatAtSchemaLoad()
    {
        var schemaPath = Write($"non-string-format-{Guid.NewGuid():N}.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.value]
            type = "string"
            format = 42
            """);

        var error = Assert.Throws<SchemaException>(() => TomlSchema.Load(schemaPath));
        Assert.Contains("format must be a string", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("allowedvalues = [\"192.168.001.1\"]")]
    [InlineData("default = \"192.168.001.1\"")]
    public void RejectsFormattedAnnotationsThatViolateTheFormat(string annotation)
    {
        var schemaPath = Write($"invalid-format-annotation-{Guid.NewGuid():N}.tosd", $$"""
            [toml-schema]
            version = "1.0.0"

            [elements.value]
            type = "string"
            format = "ipv4"
            {{annotation}}
            """);

        var error = Assert.Throws<SchemaException>(() => TomlSchema.Load(schemaPath));
        Assert.Contains("does not satisfy format ipv4", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void RejectsFormattedDefaultOutsideAllowedValues()
    {
        var schemaPath = Write($"invalid-format-default-{Guid.NewGuid():N}.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.value]
            type = "string"
            format = "ipv4"
            allowedvalues = ["192.0.2.1"]
            default = "198.51.100.1"
            """);

        var error = Assert.Throws<SchemaException>(() => TomlSchema.Load(schemaPath));
        Assert.Contains("default is not included in allowedvalues", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("scheme:")]
    [InlineData("http://[v1.fe]/")]
    public void AcceptsRfc3986UriEdgeCases(string value) =>
        Assert.True(Validate(Schema("uri"), value).IsValid);

    private static TomlSchema Schema(string format) => new(
        "1.0.0",
        new Dictionary<string, SchemaDefinition>(),
        new Dictionary<string, SchemaDefinition>
        {
            ["value"] = new() { Type = SchemaType.String, Format = format }
        });

    private static ValidationResult Validate(TomlSchema schema, string value) =>
        schema.Validate(new TomlTable { ["value"] = value });
}
