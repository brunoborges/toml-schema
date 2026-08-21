package org.tomlschema;

/**
 * The phase of processing that produced a diagnostic, as defined by SPEC.md's
 * {@code ### Phases} section. Every diagnostic belongs to exactly one phase.
 */
public enum DiagnosticPhase {
    /** Resolving a schema from a document's {@code [toml-schema]} table. */
    DISCOVERY("discovery"),
    /** Parsing a schema document and applying every schema-load rule. */
    SCHEMA_LOAD("schema-load"),
    /** Applying a successfully loaded schema to a TOML document. */
    VALIDATION("validation");

    private final String wireName;

    DiagnosticPhase(String wireName) {
        this.wireName = wireName;
    }

    /**
     * Returns the normative wire spelling of this phase ({@code discovery},
     * {@code schema-load}, or {@code validation}).
     *
     * @return the phase name used for conformance comparison
     */
    public String wireName() {
        return wireName;
    }
}
