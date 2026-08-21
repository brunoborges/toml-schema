package org.tomlschema;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class TomlSchemaVersion {
    static final String CURRENT = "1.0.0";

    private static final String SUPPORTED_MAJOR = "1";
    private static final String SUPPORTED_MINOR = "0";
    private static final Pattern SEMVER = Pattern.compile(
            "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)"
                    + "(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
                    + "(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$"
    );

    private TomlSchemaVersion() {
    }

    static Version validate(Object value) {
        Version version = parse(value, "[toml-schema].version");
        if (!SUPPORTED_MAJOR.equals(version.major())) {
            throw new SchemaException(DiagnosticCodes.UNSUPPORTED_VERSION, "$.toml-schema.version",
                    "Unsupported TOML Schema major version: " + version.value());
        }
        if (!SUPPORTED_MINOR.equals(version.minor())) {
            throw new SchemaException(DiagnosticCodes.UNSUPPORTED_VERSION, "$.toml-schema.version",
                    "Unsupported TOML Schema minor version: " + version.value());
        }
        return version;
    }

    static Version parseDocumentVersion(Object value) {
        return parse(value, "Document [toml-schema].version");
    }

    private static Version parse(Object value, String property) {
        if (!(value instanceof String version)) {
            throw new SchemaException(DiagnosticCodes.UNSUPPORTED_VERSION, "$.toml-schema.version",
                    property + " must be a SemVer string");
        }
        Matcher matcher = SEMVER.matcher(version);
        if (!matcher.matches()) {
            throw new SchemaException(DiagnosticCodes.UNSUPPORTED_VERSION, "$.toml-schema.version",
                    property + " must use SemVer MAJOR.MINOR.PATCH syntax");
        }
        return new Version(version, matcher.group(1), matcher.group(2));
    }

    record Version(String value, String major, String minor) {
    }
}
