namespace TomlSchema;

using Tomlyn;
using Tomlyn.Model;
using System.Text.RegularExpressions;

/// <summary>
/// Discovers a schema referenced by a TOML document's reserved
/// <c>[toml-schema].location</c>, following the resolution and
/// version-compatibility rules of SPEC.md's
/// "TOML Reference of a TOML Schema" section.
/// </summary>
internal static class SchemaDiscovery
{
    private static readonly Regex SemVerPattern = new(
        @"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
        + @"(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
        + @"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
        + @"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
        RegexOptions.Compiled
    );

    public static DiscoveredSchema Discover(string documentPath)
    {
        var content = File.ReadAllText(documentPath);
        var document = TomlSerializer.Deserialize<TomlTable>(content)
            ?? throw new InvalidOperationException($"Failed to parse document: {documentPath}");

        if (!document.TryGetValue("toml-schema", out var metadataObj) || metadataObj is not TomlTable metadata)
            throw new InvalidOperationException("document does not contain [toml-schema].location");

        foreach (var (key, value) in metadata)
        {
            if (!IsScalar(value))
                throw new InvalidOperationException($"document [toml-schema].{key} must be a scalar value");
        }

        if (!metadata.TryGetValue("location", out var locationObj) || locationObj is not string location
            || string.IsNullOrWhiteSpace(location))
            throw new InvalidOperationException("document does not contain [toml-schema].location");

        var schemaPath = ResolveSchemaLocation(documentPath, location.Trim());
        var schema = TomlSchema.Load(schemaPath);

        var warnings = new List<ValidationDiagnostic>();
        if (metadata.TryGetValue("version", out var versionObj))
        {
            if (versionObj is not string expectedVersion)
                throw new InvalidOperationException("document [toml-schema].version must be a SemVer string");

            var expectedMatch = SemVerPattern.Match(expectedVersion);
            if (!expectedMatch.Success)
                throw new InvalidOperationException(
                    "document [toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax");

            var actualMatch = SemVerPattern.Match(schema.Version);
            var expectedMajor = expectedMatch.Groups[1].Value;
            var actualMajor = actualMatch.Groups[1].Value;

            if (expectedMajor != actualMajor)
            {
                throw new InvalidOperationException(
                    $"document expects TOML Schema major version {expectedVersion}, "
                    + $"but resolved schema uses {schema.Version}");
            }

            if (expectedVersion != schema.Version)
            {
                warnings.Add(new ValidationDiagnostic(
                    DiagnosticPhase.Discovery,
                    DiagnosticSeverity.Warning,
                    DiagnosticCodes.VersionMismatch,
                    null,
                    null,
                    $"document expects TOML Schema version {expectedVersion}, but resolved schema uses {schema.Version}"));
            }
        }

        return new DiscoveredSchema(schema, document, warnings);
    }

    private static bool IsScalar(object? value) =>
        value is not TomlTable && value is not TomlArray && value is not TomlTableArray;

    private static string ResolveSchemaLocation(string documentPath, string location)
    {
        if (IsAbsoluteLocalPath(location))
            return Path.GetFullPath(location);

        if (HasInvalidUriReferenceCharacter(location))
            throw new InvalidOperationException($"invalid [toml-schema].location URI: {location}");

        Uri reference;
        try
        {
            reference = new Uri(location, UriKind.RelativeOrAbsolute);
        }
        catch (UriFormatException ex)
        {
            throw new InvalidOperationException($"invalid [toml-schema].location URI: {location}: {ex.Message}");
        }

        var absoluteDocumentPath = Path.GetFullPath(documentPath);
        var baseUri = new Uri("file://" + ToUriPath(absoluteDocumentPath), UriKind.Absolute);
        Uri resolved;
        try
        {
            resolved = reference.IsAbsoluteUri ? reference : new Uri(baseUri, reference);
        }
        catch (UriFormatException)
        {
            // A malformed absolute reference, such as an opaque "file:schema.tosd" URI that lacks
            // the authority component a hierarchical file URI requires, fails during resolution.
            throw new InvalidOperationException($"invalid file schema location: {location}");
        }

        if (!string.Equals(resolved.Scheme, "file", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"unsupported schema location URI scheme: {resolved.Scheme}");

        return LocalPathFromFileUri(location, resolved);
    }

    private static string ToUriPath(string absolutePath)
    {
        var normalized = absolutePath.Replace('\\', '/');
        return normalized.StartsWith('/') ? normalized : "/" + normalized;
    }

    private static bool IsAbsoluteLocalPath(string location)
    {
        if (location.StartsWith('/'))
            return true;
        if (location.Length >= 3 && char.IsLetter(location[0]) && location[1] == ':'
            && (location[2] == '\\' || location[2] == '/'))
            return true;
        return false;
    }

    private static bool HasInvalidUriReferenceCharacter(string reference)
    {
        foreach (var character in reference)
        {
            if (character <= ' ' || character == 0x7f)
                return true;
            switch (character)
            {
                case '\\':
                case '"':
                case '<':
                case '>':
                case '^':
                case '`':
                case '{':
                case '|':
                case '}':
                    return true;
            }
        }
        return false;
    }

    private static string LocalPathFromFileUri(string location, Uri uri)
    {
        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidOperationException($"invalid file schema location: {location}");

        var host = uri.Host;
        if (!string.IsNullOrEmpty(host) && !string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"file URI has a non-local host: {location}");

        // System.Uri decodes %2F/%5C while parsing, so an encoded separator can only be detected
        // by inspecting the original, still-escaped [toml-schema].location text.
        var lowerLocation = location.ToLowerInvariant();
        if (lowerLocation.Contains("%2f") || lowerLocation.Contains("%5c"))
            throw new InvalidOperationException($"file URI contains an encoded path separator: {location}");

        // AbsolutePath (not LocalPath) is used because LocalPath renders a UNC-style
        // "\\host\path" form whenever a host component is present, even a benign "localhost".
        var path = uri.AbsolutePath;
        if (string.IsNullOrEmpty(path) || path.Contains('\0'))
            throw new InvalidOperationException($"file URI does not contain a safe path: {location}");

        if (!Path.IsPathRooted(path))
            throw new InvalidOperationException($"file URI path is not absolute: {location}");

        return Path.GetFullPath(path);
    }
}
