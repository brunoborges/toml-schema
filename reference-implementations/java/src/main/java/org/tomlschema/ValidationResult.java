package org.tomlschema;

import java.util.List;

public record ValidationResult(List<ValidationError> errors) {
    public ValidationResult {
        errors = List.copyOf(errors);
    }

    public boolean isValid() {
        return errors.isEmpty();
    }
}
