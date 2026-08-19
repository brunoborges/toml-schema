package org.tomlschema;

import org.tomlj.TomlParseResult;

import java.util.List;

/**
 * The outcome of discovering a schema from a TOML document via its reserved
 * {@code [toml-schema].location}, as described in SPEC.md's
 * "TOML Reference of a TOML Schema" section.
 *
 * @param schema the discovered and loaded schema
 * @param document the parsed TOML document that referenced the schema
 * @param warnings non-fatal version-compatibility warnings produced while comparing
 *                  the document's expected TOML Schema version against the resolved
 *                  schema's declared version; empty when the document omits
 *                  {@code [toml-schema].version} or the versions match exactly
 */
public record DiscoveredSchema(TomlSchema schema, TomlParseResult document, List<ValidationWarning> warnings) {
    public DiscoveredSchema {
        warnings = List.copyOf(warnings);
    }

    /**
     * Validates the discovered document against the discovered schema, including any
     * version-compatibility warnings produced during discovery.
     *
     * @return the combined validation result
     */
    public ValidationResult validate() {
        ValidationResult result = schema.validate(document);
        if (warnings.isEmpty()) {
            return result;
        }
        List<ValidationWarning> combined = new java.util.ArrayList<>(warnings);
        combined.addAll(result.warnings());
        return new ValidationResult(result.errors(), combined);
    }
}
