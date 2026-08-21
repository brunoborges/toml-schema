package org.tomlschema;

/**
 * The stable diagnostic codes defined by SPEC.md's {@code ### Code Registry}. Every
 * unprefixed code emitted by this implementation is one of these constants, which lets
 * a conformance guard test assert that the implementation never emits a code outside the
 * registry. Message text is presentation and is not represented here.
 */
final class DiagnosticCodes {
    private DiagnosticCodes() {
    }

    // Discovery codes.
    static final String DISCOVERY_MISSING_LOCATION = "discovery-missing-location";
    static final String DISCOVERY_INVALID_METADATA = "discovery-invalid-metadata";
    static final String DISCOVERY_UNRESOLVED_LOCATION = "discovery-unresolved-location";
    static final String SCHEMA_RETRIEVAL_REFUSED = "schema-retrieval-refused";
    static final String SCHEMA_RETRIEVAL_FAILED = "schema-retrieval-failed";
    static final String VERSION_MISMATCH = "version-mismatch";
    static final String UNSUPPORTED_VERSION = "unsupported-version";
    static final String RESOURCE_LIMIT_EXCEEDED = "resource-limit-exceeded";

    // Schema-load codes.
    static final String UNRECOGNIZED_PROPERTY = "unrecognized-property";
    static final String INAPPLICABLE_PROPERTY = "inapplicable-property";
    static final String EXCLUSIVE_PROPERTIES = "exclusive-properties";
    static final String UNRESOLVED_REFERENCE = "unresolved-reference";
    static final String DUPLICATE_REFERENCE = "duplicate-reference";
    static final String INVERTED_RANGE = "inverted-range";
    static final String INVALID_BOUNDARY = "invalid-boundary";
    static final String INDETERMINATE_OPERAND = "indeterminate-operand";
    static final String INVALID_PATTERN = "invalid-pattern";
    static final String UNSUPPORTED_PATTERN = "unsupported-pattern";
    static final String CYCLIC_REFERENCE = "cyclic-reference";
    static final String INCOMPATIBLE_COMPOSITION = "incompatible-composition";
    static final String INVALID_DEFAULT = "invalid-default";
    static final String SCHEMA_MALFORMED = "schema-malformed";

    // Validation codes.
    static final String UNKNOWN_KEY = "unknown-key";
    static final String MISSING_REQUIRED = "missing-required";
    static final String TYPE_MISMATCH = "type-mismatch";
    static final String ALLOWEDVALUES = "allowedvalues";
    static final String PATTERN = "pattern";
    static final String FORMAT = "format";
    static final String MIN = "min";
    static final String MAX = "max";
    static final String MINLENGTH = "minlength";
    static final String MAXLENGTH = "maxlength";
    static final String UNIQUEITEMS = "uniqueitems";
    static final String TUPLE_LENGTH = "tuple-length";
    static final String KEYPATTERN = "keypattern";
    static final String ONEOF = "oneof";
    static final String ANYOF = "anyof";
    static final String DEPENDENTREQUIRED = "dependentrequired";
    static final String MUTUALLYEXCLUSIVE = "mutuallyexclusive";
    static final String EXACTLYONE = "exactlyone";
    static final String DEPRECATED = "deprecated";
}
