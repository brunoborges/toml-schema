package org.tomlschema;

import java.util.List;
import java.util.stream.Stream;

public record ValidationResult(List<ValidationError> errors, List<ValidationWarning> warnings) {
    public ValidationResult(List<ValidationError> errors) {
        this(errors, List.of());
    }

    public ValidationResult {
        errors = List.copyOf(errors);
        warnings = List.copyOf(warnings);
    }

    public boolean isValid() {
        return errors.isEmpty();
    }

    public List<ValidationDiagnostic> diagnostics() {
        return Stream.concat(errors.stream(), warnings.stream())
                .map(ValidationDiagnostic.class::cast)
                .toList();
    }
}
