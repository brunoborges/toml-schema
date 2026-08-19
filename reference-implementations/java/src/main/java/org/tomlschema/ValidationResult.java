package org.tomlschema;

import java.util.List;
import java.util.stream.Stream;

/**
 * The errors and warnings produced by a validation attempt.
 *
 * @param errors the validation errors
 * @param warnings the non-fatal validation warnings
 */
public record ValidationResult(List<ValidationError> errors, List<ValidationWarning> warnings) {
    /**
     * Creates a result with errors and no warnings.
     *
     * @param errors the validation errors
     */
    public ValidationResult(List<ValidationError> errors) {
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
        return Stream.concat(errors.stream(), warnings.stream())
                .map(ValidationDiagnostic.class::cast)
                .toList();
    }
}
