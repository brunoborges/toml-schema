package io.github.brunoborges.tomlschema;

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

    static void validate(Object value) {
        if (!(value instanceof String version)) {
            throw new SchemaException("[toml-schema].version must be a SemVer string");
        }
        Matcher matcher = SEMVER.matcher(version);
        if (!matcher.matches()) {
            throw new SchemaException("[toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax");
        }
        String major = matcher.group(1);
        String minor = matcher.group(2);
        if (!SUPPORTED_MAJOR.equals(major)) {
            throw new SchemaException("Unsupported TOML Schema major version: " + version);
        }
        if (!SUPPORTED_MINOR.equals(minor)) {
            throw new SchemaException("Unsupported TOML Schema minor version: " + version);
        }
    }
}
