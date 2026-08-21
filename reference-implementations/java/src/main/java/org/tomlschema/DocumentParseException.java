package org.tomlschema;

import java.util.List;

/**
 * Thrown when a TOML document submitted for validation is not well-formed TOML.
 *
 * <p>Such a document never reaches the validator, so its failure is deliberately
 * <em>not</em> a {@link ValidationDiagnostic}. SPEC.md requires that a parse failure
 * "is a parse error rather than a validation diagnostic", that it is not reported
 * under a registry or extension code, and that the document is not reported as
 * invalid. A command-line validator reports it as an unusable invocation and exits
 * {@code 2}.
 */
public final class DocumentParseException extends RuntimeException {
    private final transient List<String> parseErrors;

    DocumentParseException(List<String> parseErrors) {
        super(String.join("; ", parseErrors));
        this.parseErrors = List.copyOf(parseErrors);
    }

    /**
     * Returns the underlying TOML parser messages.
     *
     * @return the parser messages, never empty
     */
    public List<String> parseErrors() {
        return parseErrors;
    }
}
