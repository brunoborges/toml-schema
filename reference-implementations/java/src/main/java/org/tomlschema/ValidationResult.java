package org.tomlschema;

import java.util.List;
import java.util.stream.Stream;

/**
 * The errors and warnings produced by a validation attempt. SPEC.md requires that
 * implementations "provide separate access to errors and warnings"; both are the same
 * {@link ValidationDiagnostic} record, partitioned here by severity.
 *
 * @param errors the error-severity diagnostics
 * @param warnings the warning-severity diagnostics
 */
public record ValidationResult(List<ValidationDiagnostic> errors, List<ValidationDiagnostic> warnings) {
    /**
     * Creates a result with errors and no warnings.
     *
     * @param errors the validation errors
     */
    public ValidationResult(List<ValidationDiagnostic> errors) {
        this(errors, List.of());
    }

    public ValidationResult {
        errors = List.copyOf(errors);
        warnings = List.copyOf(warnings);
    }

    /**
     * Reports whether validation produced no errors.
     *
     * @return {@code true} when validation succeeded
     */
    public boolean isValid() {
        return errors.isEmpty();
    }

    /**
     * Returns all errors and warnings in diagnostic order.
     *
     * @return the combined diagnostics
     */
    public List<ValidationDiagnostic> diagnostics() {
        return Stream.concat(errors.stream(), warnings.stream()).toList();
    }
}
