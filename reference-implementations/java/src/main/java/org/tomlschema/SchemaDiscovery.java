package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Discovers a schema referenced by a TOML document's reserved
 * {@code [toml-schema].location}, following the resolution and
 * version-compatibility rules of SPEC.md's
 * "TOML Reference of a TOML Schema" section.
 */
final class SchemaDiscovery {
    private SchemaDiscovery() {
    }

    static DiscoveredSchema discover(Path documentPath) throws IOException {
        TomlParseResult document = Toml.parse(documentPath);
        if (document.hasErrors()) {
            throw new SchemaException("Unable to parse document " + documentPath + ": "
                    + formatParseErrors(document));
        }

        TomlTable metadata = document.getTable("toml-schema");
        if (metadata == null) {
            throw new SchemaException("document does not contain [toml-schema].location");
        }
        for (String key : metadata.keySet()) {
            if (!isScalar(metadata.get(key))) {
                throw new SchemaException("document [toml-schema]." + key + " must be a scalar value");
            }
        }
        Object rawLocation = metadata.get("location");
        String location = rawLocation instanceof String value ? value.strip() : "";
        if (location.isEmpty()) {
            throw new SchemaException("document does not contain [toml-schema].location");
        }

        Path schemaPath = resolveSchemaLocation(documentPath, location);
        TomlSchema schema = TomlSchema.load(schemaPath);

        List<ValidationDiagnostic> warnings = new ArrayList<>();
        if (metadata.contains("version")) {
            TomlSchemaVersion.Version expected = TomlSchemaVersion.parseDocumentVersion(metadata.get("version"));
            TomlSchemaVersion.Version actual = TomlSchemaVersion.parseDocumentVersion(schema.version());
            if (!expected.major().equals(actual.major())) {
                throw new SchemaException(DiagnosticPhase.DISCOVERY, DiagnosticCodes.UNSUPPORTED_VERSION,
                        "$.toml-schema.version",
                        "document expects TOML Schema major version " + expected.value()
                        + ", but resolved schema uses " + schema.version());
            }
            if (!expected.value().equals(schema.version())) {
                warnings.add(ValidationDiagnostic.warning(DiagnosticPhase.DISCOVERY,
                        DiagnosticCodes.VERSION_MISMATCH, null, "$.toml-schema.version",
                        "document expects TOML Schema version " + expected.value()
                                + ", but resolved schema uses " + schema.version()));
            }
        }

        return new DiscoveredSchema(schema, document, warnings);
    }

    private static boolean isScalar(Object value) {
        return !(value instanceof TomlArray) && !(value instanceof TomlTable);
    }

    private static Path resolveSchemaLocation(Path documentPath, String location) {
        if (isAbsoluteLocalPath(location)) {
            return Path.of(location).normalize();
        }
        if (hasInvalidUriReferenceCharacter(location)) {
            throw new SchemaException("invalid [toml-schema].location URI: " + location);
        }
        URI reference;
        try {
            reference = new URI(location);
        } catch (URISyntaxException e) {
            throw new SchemaException("invalid [toml-schema].location URI: " + location + ": " + e.getMessage());
        }
        URI base = documentPath.toAbsolutePath().normalize().toUri();
        URI resolved = base.resolve(reference);
        if (!"file".equalsIgnoreCase(resolved.getScheme())) {
            throw new SchemaException("unsupported schema location URI scheme: " + resolved.getScheme());
        }
        return localPathFromFileUri(location, resolved);
    }

    private static boolean isAbsoluteLocalPath(String location) {
        if (location.startsWith("/")) {
            return true;
        }
        if (location.length() >= 3 && Character.isLetter(location.charAt(0)) && location.charAt(1) == ':'
                && (location.charAt(2) == '\\' || location.charAt(2) == '/')) {
            return true;
        }
        return false;
    }

    private static boolean hasInvalidUriReferenceCharacter(String reference) {
        for (int i = 0; i < reference.length(); i++) {
            char character = reference.charAt(i);
            if (character <= ' ' || character == 0x7f) {
                return true;
            }
            switch (character) {
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
                default:
                    break;
            }
        }
        return false;
    }

    private static Path localPathFromFileUri(String location, URI uri) {
        if (uri.isOpaque() || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new SchemaException("invalid file schema location: " + location);
        }
        String host = uri.getHost();
        if (host != null && !host.isEmpty() && !"localhost".equalsIgnoreCase(host)) {
            throw new SchemaException("file URI has a non-local host: " + location);
        }
        String rawPath = uri.getRawPath();
        if (rawPath == null) {
            throw new SchemaException("invalid file schema location: " + location);
        }
        String lowerRawPath = rawPath.toLowerCase(Locale.ROOT);
        if (lowerRawPath.contains("%2f") || lowerRawPath.contains("%5c")) {
            throw new SchemaException("file URI contains an encoded path separator: " + location);
        }
        String path = uri.getPath();
        if (path == null || path.isEmpty() || path.indexOf('\0') >= 0) {
            throw new SchemaException("file URI does not contain a safe path: " + location);
        }
        if (path.length() >= 3 && path.charAt(0) == '/' && Character.isLetter(path.charAt(1)) && path.charAt(2) == ':') {
            path = path.substring(1);
        }
        try {
            Path resolvedPath = Path.of(path);
            if (!resolvedPath.isAbsolute()) {
                throw new SchemaException("file URI path is not absolute: " + location);
            }
            return resolvedPath.normalize();
        } catch (InvalidPathException e) {
            throw new SchemaException("invalid file schema location: " + location, e);
        }
    }

    private static String formatParseErrors(TomlParseResult document) {
        return document.errors().stream().map(Object::toString)
                .reduce((left, right) -> left + "; " + right).orElse("");
    }
}
