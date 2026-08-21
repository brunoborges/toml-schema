package org.tomlschema;

/**
 * The severity assigned to a validation diagnostic.
 */
public enum DiagnosticSeverity {
    ERROR,
    WARNING;

    /**
     * Returns the normative wire spelling of this severity ({@code error} or
     * {@code warning}).
     *
     * @return the severity name used for conformance comparison
     */
    public String wireName() {
        return name().toLowerCase(java.util.Locale.ROOT);
    }
}
