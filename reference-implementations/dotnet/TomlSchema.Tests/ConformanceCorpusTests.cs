namespace TomlSchema.Tests;

using System.Collections.Generic;
using System.IO;
using Tomlyn.Model;
using Xunit;

/// <summary>
/// Runs the shared conformance corpus (see <c>conformance/manifest.toml</c>) against the
/// .NET reference implementation. Each case is a separate <see cref="TheoryAttribute"/>
/// data row so a systematic gap is diagnosable from a single named result.
/// </summary>
public class ConformanceCorpusTests
{
    [Theory]
    [MemberData(nameof(Cases))]
    public void Conforms(string id, string expect, bool document)
    {
        _ = document;
        var caseDir = Path.Combine(CorpusRoot(), "cases", id);
        var schemaPath = Path.Combine(caseDir, "schema.tosd");

        TomlSchema schema;
        try
        {
            schema = TomlSchema.Load(schemaPath);
        }
        catch (Exception loadError)
        {
            if (expect == "schema-load-error")
            {
                return;
            }

            Assert.Fail($"case {id}: expected {expect} but the schema failed to load: {Describe(loadError)}");
            return;
        }

        if (expect == "schema-load-error")
        {
            Assert.Fail($"case {id}: expected schema-load-error but the schema loaded successfully");
        }

        ValidationResult result = schema.Validate(Path.Combine(caseDir, "document.toml"));

        if (expect == "valid")
        {
            Assert.True(
                result.IsValid,
                $"case {id}: expected valid but validation reported errors: {FormatErrors(result)}");
        }
        else // validation-failure
        {
            Assert.False(
                result.IsValid,
                $"case {id}: expected validation-failure but the document validated with no errors");
        }
    }

    public static IEnumerable<object[]> Cases()
    {
        var manifestPath = Path.Combine(CorpusRoot(), "manifest.toml");
        var model = SchemaLoader.ParseToml(File.ReadAllText(manifestPath));
        if (model["case"] is not TomlTableArray cases)
        {
            throw new InvalidOperationException("conformance manifest has no [[case]] entries");
        }

        foreach (var entry in cases)
        {
            var id = (string)entry["id"];
            var expect = (string)entry["expect"];
            var document = entry.TryGetValue("document", out var value) && value is bool flag && flag;
            yield return new object[] { id, expect, document };
        }
    }

    private static string Describe(Exception error) =>
        $"{error.GetType().Name}: {error.Message}";

    private static string FormatErrors(ValidationResult result) =>
        string.Join("; ", result.Errors.Select(e => e.ToString()));

    private static string CorpusRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null &&
               !File.Exists(Path.Combine(dir, "conformance", "manifest.toml")))
        {
            dir = Path.GetDirectoryName(dir);
        }

        if (dir == null)
        {
            throw new InvalidOperationException("Cannot locate conformance/ directory from " + AppContext.BaseDirectory);
        }

        return Path.Combine(dir, "conformance");
    }
}
