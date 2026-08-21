package org.tomlschema;

/**
 * Thrown when a TOML Schema document is malformed or cannot be loaded. The exception
 * carries a structured diagnostic (phase, code, and optional schema path) so callers can
 * report a normative {@link ValidationDiagnostic} instead of parsing free-form message
 * text. The two-argument legacy constructors default to the schema-load
 * {@code schema-malformed} catch-all, which SPEC.md designates for any schema-load
 * failure with no more specific code.
 */
public final class SchemaException extends RuntimeException {
    private final transient DiagnosticPhase phase;
    private final transient String code;
    private final transient String schemaPath;

    public SchemaException(String message) {
        this(DiagnosticPhase.SCHEMA_LOAD, DiagnosticCodes.SCHEMA_MALFORMED, null, message);
    }

    public SchemaException(String message, Throwable cause) {
        this(DiagnosticPhase.SCHEMA_LOAD, DiagnosticCodes.SCHEMA_MALFORMED, null, message, cause);
    }

    SchemaException(String code, String schemaPath, String message) {
        this(DiagnosticPhase.SCHEMA_LOAD, code, schemaPath, message);
    }

    SchemaException(String code, String schemaPath, String message, Throwable cause) {
        this(DiagnosticPhase.SCHEMA_LOAD, code, schemaPath, message, cause);
    }

    SchemaException(DiagnosticPhase phase, String code, String schemaPath, String message) {
        super(message);
        this.phase = phase;
        this.code = code;
        this.schemaPath = schemaPath;
    }

    SchemaException(DiagnosticPhase phase, String code, String schemaPath, String message, Throwable cause) {
        super(message, cause);
        this.phase = phase;
        this.code = code;
        this.schemaPath = schemaPath;
    }

    DiagnosticPhase phase() {
        return phase;
    }

    String code() {
        return code;
    }

    String schemaPath() {
        return schemaPath;
    }

    /**
     * Returns this failure as a normative diagnostic. Schema-load and discovery
     * diagnostics never carry an instance path.
     *
     * @return the structured diagnostic for this failure
     */
    ValidationDiagnostic toDiagnostic() {
        return new ValidationDiagnostic(phase, DiagnosticSeverity.ERROR, code, null, schemaPath, getMessage());
    }
}
