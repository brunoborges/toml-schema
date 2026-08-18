package org.tomlschema;

public record ValidationWarning(String code, String path, String message) implements ValidationDiagnostic {
    @Override
    public DiagnosticSeverity severity() {
        return DiagnosticSeverity.WARNING;
    }

    @Override
    public String toString() {
        return path + ": " + message;
    }
}
