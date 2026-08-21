namespace TomlSchema.Tests;

using System.Collections.Generic;
using System.IO;
using System.Linq;
using Tomlyn.Model;
using Xunit;

/// <summary>
/// Runs the shared conformance corpus (see <c>conformance/manifest.toml</c>) against the
/// .NET reference implementation. Each case is a separate <see cref="TheoryAttribute"/>
/// data row so a systematic gap is diagnosable from a single named result. Beyond the
/// coarse <c>expect</c> outcome, every pinned <c>[[case.diagnostics]]</c> expectation is
/// asserted present (subset semantics; message text is never compared) and every emitted
/// diagnostic is checked against the six universal checks from <c>conformance/README.md</c>.
/// </summary>
public class ConformanceCorpusTests
{
    private sealed record ExpectedDiagnostic(
        string? Phase, string? Severity, string? Code, string? InstancePath, string? SchemaPath);

    private sealed record RegistryEntry(string Severity, IReadOnlyList<string> Phases);

    [Theory]
    [MemberData(nameof(Cases))]
    public void Conforms(string id, string expect, bool document)
    {
        _ = document;
        var caseDir = Path.Combine(CorpusRoot(), "cases", id);
        var schemaPath = Path.Combine(caseDir, "schema.tosd");
        var expected = ExpectedDiagnostics(id);
        var emitted = new List<ValidationDiagnostic>();

        TomlSchema schema;
        try
        {
            schema = TomlSchema.Load(schemaPath);
        }
        catch (SchemaException loadError)
        {
            emitted.Add(loadError.ToDiagnostic());
            FinishLoadFailure(id, expect, expected, emitted);
            return;
        }
        catch (Exception loadError)
        {
            if (expect == "schema-load-error")
            {
                Assert.Fail(
                    $"case {id}: schema failed to load with a non-structured exception: {Describe(loadError)}");
                return;
            }

            Assert.Fail($"case {id}: expected {expect} but the schema failed to load: {Describe(loadError)}");
            return;
        }

        if (expect == "schema-load-error")
        {
            Assert.Fail($"case {id}: expected schema-load-error but the schema loaded successfully");
        }

        var documentPath = Path.Combine(caseDir, "document.toml");

        if (expect == "document-parse-error")
        {
            var parseError = Assert.Throws<DocumentParseException>(() => schema.Validate(documentPath));
            Assert.NotNull(parseError);
            // A document that is not well-formed TOML never reaches the validator, so it
            // yields no diagnostics at all.
            Assert.Empty(expected);
            return;
        }

        ValidationResult result = schema.Validate(documentPath);
        emitted.AddRange(result.Errors);
        emitted.AddRange(result.Warnings);

        foreach (var diagnostic in emitted)
            AssertUniversalChecks(id, diagnostic);

        AssertExpectedPresent(id, expected, emitted);

        if (expect == "valid")
        {
            Assert.True(
                result.Errors.Count == 0,
                $"case {id}: expected valid but validation reported errors: {FormatErrors(result)}");
        }
        else // validation-failure
        {
            Assert.False(
                result.Errors.Count == 0,
                $"case {id}: expected validation-failure but the document validated with no errors");
        }
    }

    private void FinishLoadFailure(
        string id, string expect, IReadOnlyList<ExpectedDiagnostic> expected,
        IReadOnlyList<ValidationDiagnostic> emitted)
    {
        if (expect != "schema-load-error")
        {
            Assert.Fail(
                $"case {id}: expected {expect} but the schema failed to load: {emitted[0]}");
        }

        foreach (var diagnostic in emitted)
            AssertUniversalChecks(id, diagnostic);

        AssertExpectedPresent(id, expected, emitted);
    }

    /// <summary>
    /// Asserts every pinned diagnostic is present. Subset semantics: a conforming
    /// implementation may emit fewer (fail-fast) or more diagnostics. Comparison is on
    /// phase, severity, code, and the asserted paths only; message text is never compared,
    /// and an omitted path in the expectation is unasserted rather than "must be absent".
    /// </summary>
    private static void AssertExpectedPresent(
        string id, IReadOnlyList<ExpectedDiagnostic> expected, IReadOnlyList<ValidationDiagnostic> emitted)
    {
        foreach (var want in expected)
        {
            var present = emitted.Any(got => Matches(want, got));
            Assert.True(
                present,
                $"case {id}: expected diagnostic {Format(want)} was not present. Emitted: "
                    + string.Join(" | ", emitted.Select(Format)));
        }
    }

    private static bool Matches(ExpectedDiagnostic want, ValidationDiagnostic got)
    {
        if (want.Phase != null && want.Phase != got.Phase.WireName())
            return false;
        if (want.Severity != null && want.Severity != got.Severity.WireName())
            return false;
        if (want.Code != null && want.Code != got.Code)
            return false;
        if (want.InstancePath != null && want.InstancePath != got.InstancePath)
            return false;
        if (want.SchemaPath != null && want.SchemaPath != got.SchemaPath)
            return false;
        return true;
    }

    /// <summary>
    /// The six universal checks that apply to every diagnostic of every case.
    /// </summary>
    private void AssertUniversalChecks(string id, ValidationDiagnostic diagnostic)
    {
        var registry = Registry();

        // 1. Code is registered or matches the extension pattern.
        var known = registry.TryGetValue(diagnostic.Code, out var entry);
        Assert.True(
            known || System.Text.RegularExpressions.Regex.IsMatch(
                diagnostic.Code, "^x-[a-z][a-z0-9]*-[a-z0-9-]+$"),
            $"case {id}: code '{diagnostic.Code}' is neither registered nor a valid extension code");

        // 2 & 3. Severity and phase are valid for the code.
        if (known)
        {
            Assert.Equal(entry!.Severity, diagnostic.Severity.WireName());
            Assert.Contains(diagnostic.Phase.WireName(), entry.Phases);
        }

        // Only deprecated and version-mismatch are warnings.
        if (diagnostic.Severity == DiagnosticSeverity.Warning)
        {
            Assert.True(
                diagnostic.Code is "deprecated" or "version-mismatch",
                $"case {id}: warning has unexpected code '{diagnostic.Code}'");
        }

        // 4. No instance_path on schema-load or discovery diagnostics.
        if (diagnostic.Phase is DiagnosticPhase.SchemaLoad or DiagnosticPhase.Discovery)
        {
            Assert.True(
                diagnostic.InstancePath == null,
                $"case {id}: {diagnostic.Phase.WireName()} diagnostic carries an instance path");
        }

        // 5. Both paths parse under the grammar.
        Assert.True(
            ParsesAsPath(diagnostic.InstancePath),
            $"case {id}: instance path '{diagnostic.InstancePath}' does not parse under the grammar");
        Assert.True(
            ParsesAsPath(diagnostic.SchemaPath),
            $"case {id}: schema path '{diagnostic.SchemaPath}' does not parse under the grammar");
    }

    /// <summary>
    /// Verifies a path parses under the shared instance-path/schema-path grammar: a root
    /// <c>$</c> followed by <c>.</c>-separated key segments (bare or JSON-quoted) and
    /// <c>[i]</c> index segments with no sign and no leading zeros. A <c>null</c> path is
    /// vacuously valid (it is simply absent).
    /// </summary>
    private static bool ParsesAsPath(string? path)
    {
        if (path == null)
            return true;
        if (path.Length == 0 || path[0] != '$')
            return false;
        var i = 1;
        while (i < path.Length)
        {
            if (path[i] == '.')
            {
                i++;
                if (i >= path.Length)
                    return false;
                if (path[i] == '"')
                {
                    i++;
                    var closed = false;
                    while (i < path.Length)
                    {
                        if (path[i] == '\\')
                        {
                            i += 2;
                            continue;
                        }
                        if (path[i] == '"')
                        {
                            i++;
                            closed = true;
                            break;
                        }
                        i++;
                    }
                    if (!closed)
                        return false;
                }
                else
                {
                    var start = i;
                    while (i < path.Length && IsBareChar(path[i]))
                        i++;
                    if (i == start)
                        return false;
                }
            }
            else if (path[i] == '[')
            {
                i++;
                var start = i;
                while (i < path.Length && path[i] >= '0' && path[i] <= '9')
                    i++;
                var digits = path[start..i];
                if (digits.Length == 0 || (digits.Length > 1 && digits[0] == '0'))
                    return false;
                if (i >= path.Length || path[i] != ']')
                    return false;
                i++;
            }
            else
            {
                return false;
            }
        }
        return true;
    }

    private static bool IsBareChar(char c) =>
        c is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or (>= '0' and <= '9') or '_' or '-';

    public static IEnumerable<object[]> Cases()
    {
        foreach (var entry in ManifestCases())
        {
            var id = (string)entry["id"];
            var expect = (string)entry["expect"];
            var document = entry.TryGetValue("document", out var value) && value is bool flag && flag;
            yield return new object[] { id, expect, document };
        }
    }

    private static TomlTableArray ManifestCases()
    {
        var manifestPath = Path.Combine(CorpusRoot(), "manifest.toml");
        var model = SchemaLoader.ParseToml(File.ReadAllText(manifestPath));
        if (model["case"] is not TomlTableArray cases)
        {
            throw new InvalidOperationException("conformance manifest has no [[case]] entries");
        }

        return cases;
    }

    private static IReadOnlyList<ExpectedDiagnostic> ExpectedDiagnostics(string id)
    {
        foreach (var entry in ManifestCases())
        {
            if ((string)entry["id"] != id)
                continue;
            if (!entry.TryGetValue("diagnostics", out var value) || value is not TomlTableArray diagnostics)
                return Array.Empty<ExpectedDiagnostic>();

            return diagnostics.Select(d => new ExpectedDiagnostic(
                d.TryGetValue("phase", out var p) ? (string)p : null,
                d.TryGetValue("severity", out var s) ? (string)s : null,
                d.TryGetValue("code", out var c) ? (string)c : null,
                d.TryGetValue("instance_path", out var ip) ? (string)ip : null,
                d.TryGetValue("schema_path", out var sp) ? (string)sp : null)).ToList();
        }

        return Array.Empty<ExpectedDiagnostic>();
    }

    private static Dictionary<string, RegistryEntry>? _registry;

    private static Dictionary<string, RegistryEntry> Registry()
    {
        if (_registry != null)
            return _registry;

        var codesPath = Path.Combine(CorpusRoot(), "codes.toml");
        var model = SchemaLoader.ParseToml(File.ReadAllText(codesPath));
        var registry = new Dictionary<string, RegistryEntry>(StringComparer.Ordinal);
        if (model["code"] is TomlTableArray codes)
        {
            foreach (var code in codes)
            {
                var name = (string)code["name"];
                var severity = (string)code["severity"];
                var phases = ((TomlArray)code["phases"]).Select(x => (string)x!).ToList();
                registry[name] = new RegistryEntry(severity, phases);
            }
        }

        _registry = registry;
        return registry;
    }

    private static string Format(ExpectedDiagnostic want) =>
        $"[{want.Phase}/{want.Severity}/{want.Code} inst={want.InstancePath ?? "*"} schema={want.SchemaPath ?? "*"}]";

    private static string Format(ValidationDiagnostic got) =>
        $"[{got.Phase.WireName()}/{got.Severity.WireName()}/{got.Code} inst={got.InstancePath ?? "-"} schema={got.SchemaPath ?? "-"}]";

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
