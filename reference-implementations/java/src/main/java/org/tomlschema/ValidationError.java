package org.tomlschema;

public record ValidationError(String code, String path, String message) implements ValidationDiagnostic {
    public ValidationError(String path, String message) {
        this("validation-error", path, message);
    }

    @Override
    public DiagnosticSeverity severity() {
        return DiagnosticSeverity.ERROR;
    }

    @Override
    public String toString() {
        return path + ": " + message;
    }
}
