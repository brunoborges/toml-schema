namespace TomlSchema.Tests;

using System.IO;
using System.Linq;
using System.Reflection;
using Tomlyn.Model;
using Xunit;

/// <summary>
/// Guards that every diagnostic code the .NET implementation can emit is present in the
/// machine-readable registry (<c>conformance/codes.toml</c>). Because every emitted code
/// flows through a <see cref="DiagnosticCodes"/> constant, reflecting over those constants
/// and checking each against the registry catches typos and stale legacy code names (the
/// three renamed <c>invalid-value</c>/<c>pattern-mismatch</c>/<c>duplicate-items</c> spellings
/// would have been caught here). This mirrors the Rust <c>every_emittable_code_is_registered</c>
/// test and the existing ABNF conformance guards.
/// </summary>
public class DiagnosticRegistryGuardTests
{
    [Fact]
    public void EveryEmittableCodeIsRegistered()
    {
        var registry = RegisteredCodeNames();

        foreach (var (name, value) in EmittableCodes())
        {
            Assert.True(
                registry.Contains(value),
                $"DiagnosticCodes.{name} = \"{value}\" is not present in conformance/codes.toml");
        }
    }

    private static IEnumerable<(string Name, string Value)> EmittableCodes() =>
        typeof(DiagnosticCodes)
            .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
            .Where(field => field is { IsLiteral: true, IsInitOnly: false } && field.FieldType == typeof(string))
            .Select(field => (field.Name, (string)field.GetRawConstantValue()!));

    private static HashSet<string> RegisteredCodeNames()
    {
        var codesPath = Path.Combine(CorpusRoot(), "codes.toml");
        var model = SchemaLoader.ParseToml(File.ReadAllText(codesPath));
        var names = new HashSet<string>(StringComparer.Ordinal);
        if (model["code"] is TomlTableArray codes)
        {
            foreach (var code in codes)
                names.Add((string)code["name"]);
        }

        return names;
    }

    private static string CorpusRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null &&
               !File.Exists(Path.Combine(dir, "conformance", "codes.toml")))
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
