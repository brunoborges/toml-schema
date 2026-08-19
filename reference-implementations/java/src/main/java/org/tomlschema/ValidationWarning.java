package org.tomlschema;

/**
 * A non-fatal diagnostic emitted while validating a TOML document.
 *
 * @param code the stable warning code
 * @param path the path to the affected value
 * @param message a human-readable description
 */
public record ValidationWarning(String code, String path, String message) implements ValidationDiagnostic {
    /**
     * {@inheritDoc}
     */
    @Override
    public DiagnosticSeverity severity() {
        return DiagnosticSeverity.WARNING;
    }

    /**
     * Returns this warning as a path and message.
     *
     * @return the formatted warning
     */
    @Override
    public String toString() {
        return path + ": " + message;
    }
}
