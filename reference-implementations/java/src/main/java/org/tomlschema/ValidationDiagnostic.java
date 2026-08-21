package org.tomlschema;

/**
 * A single diagnostic produced while discovering a schema, loading a schema, or
 * validating a document. This one record shape carries every normative field defined by
 * SPEC.md's {@code ### Diagnostic Record}: the {@code phase}, the {@code severity}, the
 * registry {@code code}, an optional instance path, an optional schema path, and a
 * human-readable message. Errors and warnings share this type; they are told apart by
 * {@link #severity()} and are exposed separately by {@link ValidationResult}.
 *
 * <p>Message text is presentation only. SPEC.md states implementations "MUST NOT be
 * compared, and MUST NOT compare themselves, by message text", so conformance is judged
 * on {@code phase}, {@code severity}, {@code code}, {@code instancePath}, and
 * {@code schemaPath}.
 *
 * @param phase the processing phase that produced this diagnostic
 * @param severity whether this diagnostic is an error or a warning
 * @param code the stable registry (or namespaced extension) code
 * @param instancePath where in the document the condition was observed, or {@code null}
 * @param schemaPath where in the schema the failing rule is declared, or {@code null}
 * @param message human-readable text; content is implementation-defined
 */
public record ValidationDiagnostic(
        DiagnosticPhase phase,
        DiagnosticSeverity severity,
        String code,
        String instancePath,
        String schemaPath,
        String message
) {
    /**
     * Creates a validation-phase error.
     *
     * @param code the diagnostic code
     * @param instancePath the instance path, or {@code null}
     * @param schemaPath the schema path, or {@code null}
     * @param message a human-readable description
     * @return the error diagnostic
     */
    static ValidationDiagnostic error(String code, String instancePath, String schemaPath, String message) {
        return new ValidationDiagnostic(
                DiagnosticPhase.VALIDATION, DiagnosticSeverity.ERROR, code, instancePath, schemaPath, message);
    }

    static ValidationDiagnostic error(
            DiagnosticPhase phase, String code, String instancePath, String schemaPath, String message) {
        return new ValidationDiagnostic(
                phase, DiagnosticSeverity.ERROR, code, instancePath, schemaPath, message);
    }

    /**
     * Creates a validation-phase warning.
     *
     * @param code the diagnostic code
     * @param instancePath the instance path, or {@code null}
     * @param schemaPath the schema path, or {@code null}
     * @param message a human-readable description
     * @return the warning diagnostic
     */
    static ValidationDiagnostic warning(String code, String instancePath, String schemaPath, String message) {
        return new ValidationDiagnostic(
                DiagnosticPhase.VALIDATION, DiagnosticSeverity.WARNING, code, instancePath, schemaPath, message);
    }

    static ValidationDiagnostic warning(
            DiagnosticPhase phase, String code, String instancePath, String schemaPath, String message) {
        return new ValidationDiagnostic(
                phase, DiagnosticSeverity.WARNING, code, instancePath, schemaPath, message);
    }

    /**
     * Returns the instance path to the affected document value, or {@code null}.
     *
     * <p>This is an alias for {@link #instancePath()} kept for readability at call sites
     * that previously referred to a document {@code path}.
     *
     * @return the document instance path
     */
    public String path() {
        return instancePath;
    }

    /**
     * Returns this diagnostic as an instance path and message when a path is present,
     * otherwise the schema path or bare message.
     *
     * @return the formatted diagnostic
     */
    @Override
    public String toString() {
        String location = instancePath != null ? instancePath : schemaPath;
        return location == null ? message : location + ": " + message;
    }
}
