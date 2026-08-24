package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.InvalidPathException;
import java.nio.file.Files;
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
    private static final String LOCATION_PATH = "$.toml-schema.location";
    private static final String VERSION_PATH = "$.toml-schema.version";

    private SchemaDiscovery() {
    }

    static DiscoveredSchema discover(Path documentPath) throws IOException {
        TomlParseResult document = Toml.parse(documentPath);
        if (document.hasErrors()) {
            throw new DocumentParseException(
                    document.errors().stream().map(Object::toString).toList());
        }

        Object metadataValue = document.get("toml-schema");
        if (metadataValue == null) {
            throw discoveryError(DiagnosticCodes.DISCOVERY_MISSING_LOCATION, null,
                    "document does not contain [toml-schema].location");
        }
        if (!(metadataValue instanceof TomlTable metadata)) {
            throw discoveryError(DiagnosticCodes.DISCOVERY_INVALID_METADATA, "$.toml-schema",
                    "document [toml-schema] metadata must be a table");
        }
        for (String key : metadata.keySet()) {
            if (!isScalar(metadata.get(key))) {
                throw discoveryError(DiagnosticCodes.DISCOVERY_INVALID_METADATA,
                        "$.toml-schema." + PathEncoding.encodeKey(key),
                        "document [toml-schema]." + key + " must be a scalar value");
            }
        }
        Object rawLocation = metadata.get("location");
        if (rawLocation != null && !(rawLocation instanceof String)) {
            throw discoveryError(DiagnosticCodes.DISCOVERY_INVALID_METADATA, LOCATION_PATH,
                    "document [toml-schema].location must be a string");
        }
        String location = rawLocation instanceof String value ? value.strip() : "";
        if (location.isEmpty()) {
            throw discoveryError(DiagnosticCodes.DISCOVERY_MISSING_LOCATION, null,
                    "document does not contain [toml-schema].location");
        }

        Path schemaPath = resolveSchemaLocation(documentPath, location);
        if (!Files.isRegularFile(schemaPath) || !Files.isReadable(schemaPath)) {
            throw discoveryError(DiagnosticCodes.SCHEMA_RETRIEVAL_FAILED, LOCATION_PATH,
                    "unable to retrieve schema " + schemaPath);
        }
        TomlSchema schema = TomlSchema.load(schemaPath);

        List<ValidationDiagnostic> warnings = new ArrayList<>();
        if (metadata.contains("version")) {
            TomlSchemaVersion.Version expected;
            try {
                expected = TomlSchemaVersion.parseDocumentVersion(metadata.get("version"));
            } catch (SchemaException invalidVersion) {
                throw discoveryError(DiagnosticCodes.DISCOVERY_INVALID_METADATA, VERSION_PATH,
                        invalidVersion.getMessage());
            }
            TomlSchemaVersion.Version actual = TomlSchemaVersion.parseDocumentVersion(schema.version());
            if (!expected.major().equals(actual.major())) {
                throw new SchemaException(DiagnosticPhase.DISCOVERY, DiagnosticCodes.UNSUPPORTED_VERSION,
                        VERSION_PATH,
                        "document expects TOML Schema major version " + expected.value()
                        + ", but resolved schema uses " + schema.version());
            }
            if (!expected.value().equals(schema.version())) {
                warnings.add(ValidationDiagnostic.warning(DiagnosticPhase.DISCOVERY,
                        DiagnosticCodes.VERSION_MISMATCH, null, VERSION_PATH,
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
            throw discoveryError(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION, LOCATION_PATH,
                    "invalid [toml-schema].location URI: " + location);
        }
        URI reference;
        try {
            reference = new URI(location);
        } catch (URISyntaxException e) {
            throw discoveryError(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION, LOCATION_PATH,
                    "invalid [toml-schema].location URI: " + location + ": " + e.getMessage());
        }
        URI base = documentPath.toAbsolutePath().normalize().toUri();
        URI resolved = base.resolve(reference);
        if (!"file".equalsIgnoreCase(resolved.getScheme())) {
            throw discoveryError(DiagnosticCodes.SCHEMA_RETRIEVAL_REFUSED, LOCATION_PATH,
                    "schema retrieval is not permitted for URI scheme: " + resolved.getScheme());
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
            throw unresolvedLocation("invalid file schema location: " + location);
        }
        String host = uri.getHost();
        if (host != null && !host.isEmpty() && !"localhost".equalsIgnoreCase(host)) {
            throw unresolvedLocation("file URI has a non-local host: " + location);
        }
        String rawPath = uri.getRawPath();
        if (rawPath == null) {
            throw unresolvedLocation("invalid file schema location: " + location);
        }
        String lowerRawPath = rawPath.toLowerCase(Locale.ROOT);
        if (lowerRawPath.contains("%2f") || lowerRawPath.contains("%5c")) {
            throw unresolvedLocation("file URI contains an encoded path separator: " + location);
        }
        String path = uri.getPath();
        if (path == null || path.isEmpty() || path.indexOf('\0') >= 0) {
            throw unresolvedLocation("file URI does not contain a safe path: " + location);
        }
        if (path.length() >= 3 && path.charAt(0) == '/' && Character.isLetter(path.charAt(1)) && path.charAt(2) == ':') {
            path = path.substring(1);
        }
        try {
            Path resolvedPath = Path.of(path);
            if (!resolvedPath.isAbsolute()) {
                throw unresolvedLocation("file URI path is not absolute: " + location);
            }
            return resolvedPath.normalize();
        } catch (InvalidPathException e) {
            throw new SchemaException(DiagnosticPhase.DISCOVERY,
                    DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION, LOCATION_PATH,
                    "invalid file schema location: " + location, e);
        }
    }

    private static SchemaException unresolvedLocation(String message) {
        return discoveryError(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION, LOCATION_PATH, message);
    }

    private static SchemaException discoveryError(String code, String schemaPath, String message) {
        return new SchemaException(DiagnosticPhase.DISCOVERY, code, schemaPath, message);
    }

}
