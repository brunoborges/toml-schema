package org.tomlschema;

/**
 * An error that makes validation unsuccessful.
 *
 * @param code the stable error code
 * @param path the path to the invalid value
 * @param message a human-readable description
 */
public record ValidationError(String code, String path, String message) implements ValidationDiagnostic {
    /**
     * Creates an error with the general validation-error code.
     *
     * @param path the path to the invalid value
     * @param message a human-readable description
     */
    public ValidationError(String path, String message) {
        this("validation-error", path, message);
    }

    @Override
    /**
     * {@inheritDoc}
     */
    public DiagnosticSeverity severity() {
        return DiagnosticSeverity.ERROR;
    }

    @Override
    /**
     * Returns this error as a path and message.
     *
     * @return the formatted error
     */
    public String toString() {
        return path + ": " + message;
    }
}
