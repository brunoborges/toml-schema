namespace TomlSchema.Tests;

using Xunit;

/// <summary>
/// Tests document-driven schema discovery through <c>[toml-schema].location</c>,
/// mirroring the behavioral cases covered by the Go and Rust reference implementations.
/// </summary>
public class SchemaDiscoveryTests
{
    [Fact]
    public void DiscoversSchemaFromRelativeLocation()
    {
        var dir = CreateTestDirectory();
        Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.title]
            type = "string"
            """);
        var documentPath = Write(dir, "document.toml", """
            title = "Example"

            [toml-schema]
            version = "1.0.0"
            location = "schema.tosd"
            """);

        var discovered = TomlSchema.Discover(documentPath);
        var result = discovered.Validate();

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
        Assert.Empty(discovered.Warnings);
    }

    [Fact]
    public void ValidateDocumentDiscoversAndValidatesInOneStep()
    {
        var dir = CreateTestDirectory();
        Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.title]
            type = "string"
            """);
        var documentPath = Write(dir, "document.toml", """
            title = "Example"

            [toml-schema]
            location = "schema.tosd"
            """);

        var result = TomlSchema.ValidateDocument(documentPath);

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    [Fact]
    public void ResolvesRelativeLocationAgainstDocumentDirectoryNotWorkingDirectory()
    {
        var dir = CreateTestDirectory();
        Directory.CreateDirectory(Path.Combine(dir, "schemas"));
        Directory.CreateDirectory(Path.Combine(dir, "documents"));
        Write(dir, "schemas/schema.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.title]
            type = "string"
            """);
        var documentPath = Write(dir, "documents/document.toml", """
            title = "Example"

            [toml-schema]
            location = "../schemas/schema.tosd"
            """);

        var result = TomlSchema.ValidateDocument(documentPath);

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    [Fact]
    public void ResolvesAbsoluteLocalPathLocation()
    {
        var dir = CreateTestDirectory();
        var schemaPath = Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.title]
            type = "string"
            """);
        var documentPath = Write(dir, "document.toml", $$"""
            title = "Example"

            [toml-schema]
            location = "{{schemaPath.Replace("\\", "\\\\")}}"
            """);

        var result = TomlSchema.ValidateDocument(documentPath);

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    [Fact]
    public void ResolvesAbsoluteFileUriLocation()
    {
        var dir = CreateTestDirectory();
        var schemaPath = Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.title]
            type = "string"
            """);
        var fileUri = new Uri(schemaPath).ToString();
        var documentPath = Write(dir, "document.toml", $$"""
            title = "Example"

            [toml-schema]
            location = "{{fileUri}}"
            """);

        var result = TomlSchema.ValidateDocument(documentPath);

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    [Fact]
    public void FailsDiscoveryWhenLocationMissing()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            title = "Example"

            [toml-schema]
            version = "1.0.0"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("does not contain [toml-schema].location", exception.Message);
    }

    [Fact]
    public void FailsDiscoveryWhenLocationIsBlank()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "   "
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("does not contain [toml-schema].location", exception.Message);
    }

    [Fact]
    public void FailsDiscoveryWhenMetadataHasNoTomlSchemaTable()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            title = "Example"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("does not contain [toml-schema].location", exception.Message);
    }

    [Fact]
    public void RejectsNonScalarSchemaReferenceMetadata()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = ["schema.tosd"]
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("must be a scalar value", exception.Message);
    }

    [Fact]
    public void RejectsArrayOfTablesSchemaReferenceMetadata()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "schema.tosd"

            [[toml-schema.entries]]
            name = "a"

            [[toml-schema.entries]]
            name = "b"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("must be a scalar value", exception.Message);
    }

    [Fact]
    public void RejectsInlineTableSchemaReferenceMetadata()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "schema.tosd"
            meta = { author = "me" }
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("must be a scalar value", exception.Message);
    }

    [Fact]
    public void WarnsOnNonMajorVersionMismatch()
    {
        var dir = CreateTestDirectory();
        Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.1"

            [elements.title]
            type = "string"
            """);
        var documentPath = Write(dir, "document.toml", """
            title = "Example"

            [toml-schema]
            version = "1.0.0"
            location = "schema.tosd"
            """);

        var discovered = TomlSchema.Discover(documentPath);

        Assert.Single(discovered.Warnings);
        Assert.Contains("1.0.0", discovered.Warnings[0].Message);
        Assert.Contains("1.0.1", discovered.Warnings[0].Message);
        Assert.True(discovered.Validate().IsValid);
    }

    [Fact]
    public void FailsOnMajorVersionMismatch()
    {
        var dir = CreateTestDirectory();
        Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.1"

            [elements.title]
            type = "string"
            """);
        var documentPath = Write(dir, "document.toml", """
            title = "Example"

            [toml-schema]
            version = "2.0.0"
            location = "schema.tosd"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("major version", exception.Message);
    }

    [Fact]
    public void RejectsUnsupportedUriScheme()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "https://example.com/schema.tosd"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("unsupported schema location URI scheme: https", exception.Message);
    }

    [Fact]
    public void RejectsOpaqueFileUri()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "file:schema.tosd"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("invalid file schema location", exception.Message);
    }

    [Fact]
    public void RejectsFileUriWithQueryComponent()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "file:///schema.tosd?version=1"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("invalid file schema location", exception.Message);
    }

    [Fact]
    public void RejectsFileUriWithFragmentComponent()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "file:///schema.tosd#fragment"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("invalid file schema location", exception.Message);
    }

    [Fact]
    public void RejectsFileUriWithNonLocalHost()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "file://example.com/schema.tosd"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("non-local host", exception.Message);
    }

    [Fact]
    public void AcceptsFileUriWithLocalhostHost()
    {
        var dir = CreateTestDirectory();
        var schemaPath = Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.title]
            type = "string"
            """);
        var hostQualifiedUri = "file://localhost" + schemaPath.Replace('\\', '/');
        var documentPath = Write(dir, "document.toml", $$"""
            title = "Example"

            [toml-schema]
            location = "{{hostQualifiedUri}}"
            """);

        var result = TomlSchema.ValidateDocument(documentPath);

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    [Fact]
    public void RejectsEncodedPathSeparatorInFileUri()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "file:///tmp%2Fschema.tosd"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("encoded path separator", exception.Message);
    }

    [Fact]
    public void RejectsInvalidUriReferenceCharacters()
    {
        var dir = CreateTestDirectory();
        var documentPath = Write(dir, "document.toml", """
            [toml-schema]
            location = "sche ma.tosd"
            """);

        var exception = Assert.Throws<InvalidOperationException>(() => TomlSchema.Discover(documentPath));
        Assert.Contains("invalid [toml-schema].location URI", exception.Message);
    }

    [Fact]
    public void IgnoresReservedTomlSchemaTableDuringApplicationValidationByDefault()
    {
        var dir = CreateTestDirectory();
        Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.title]
            type = "string"
            """);
        var documentPath = Write(dir, "document.toml", """
            title = "Example"

            [toml-schema]
            version = "1.0.0"
            location = "schema.tosd"
            extra-key = "ignored by discovery, reserved for validation"
            """);

        var result = TomlSchema.ValidateDocument(documentPath);

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    [Fact]
    public void ValidatesReservedTomlSchemaTableWhenExplicitlyModeled()
    {
        var dir = CreateTestDirectory();
        Write(dir, "schema.tosd", """
            [toml-schema]
            version = "1.0.0"

            [elements.title]
            type = "string"

            [elements."toml-schema"]
            type = "table"
            [elements."toml-schema".location]
            type = "string"
            """);
        var documentPath = Write(dir, "document.toml", """
            title = "Example"

            [toml-schema]
            location = "schema.tosd"
            """);

        var result = TomlSchema.ValidateDocument(documentPath);

        Assert.True(result.IsValid, $"Validation failed: {string.Join(", ", result.Errors.Select(e => e.Message))}");
    }

    private static string CreateTestDirectory()
    {
        var dir = Path.Combine(Path.GetTempPath(), "toml-schema-discovery-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static string Write(string dir, string relativePath, string content)
    {
        var path = Path.Combine(dir, relativePath.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        return path;
    }
}
