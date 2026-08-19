package org.tomlschema;

/**
 * A diagnostic emitted while validating a TOML document.
 */
public sealed interface ValidationDiagnostic permits ValidationError, ValidationWarning {
    /**
     * Returns whether this diagnostic is an error or warning.
     *
     * @return the diagnostic severity
     */
    DiagnosticSeverity severity();

    /**
     * Returns the stable diagnostic code.
     *
     * @return the diagnostic code
     */
    String code();

    /**
     * Returns the path to the affected document value.
     *
     * @return the document path
     */
    String path();

    /**
     * Returns a human-readable diagnostic message.
     *
     * @return the diagnostic message
     */
    String message();
}
