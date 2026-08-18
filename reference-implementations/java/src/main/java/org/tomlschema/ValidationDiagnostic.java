package org.tomlschema;

public sealed interface ValidationDiagnostic permits ValidationError, ValidationWarning {
    DiagnosticSeverity severity();

    String code();

    String path();

    String message();
}
