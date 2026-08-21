/**
 * The stable diagnostic model defined by SPEC.md's `## Diagnostics` section: the
 * three phases, and the closed registry of unprefixed diagnostic codes.
 *
 * Message text is presentation and is deliberately not represented here. SPEC.md
 * states implementations "MUST NOT be compared, and MUST NOT compare themselves,
 * by message text", so conformance is judged on phase, severity, code, instance
 * path, and schema path.
 */

/** The phase of processing that produced a diagnostic (SPEC.md `### Phases`). */
export type DiagnosticPhase = "discovery" | "schema-load" | "validation";

/**
 * Every unprefixed code SPEC.md's `### Code Registry` defines. A conformance
 * guard test asserts that each value here appears in `conformance/codes.toml`,
 * which catches typos and legacy names before they can be emitted.
 */
export const DiagnosticCodes = {
  // Discovery codes.
  DISCOVERY_MISSING_LOCATION: "discovery-missing-location",
  DISCOVERY_INVALID_METADATA: "discovery-invalid-metadata",
  DISCOVERY_UNRESOLVED_LOCATION: "discovery-unresolved-location",
  SCHEMA_RETRIEVAL_REFUSED: "schema-retrieval-refused",
  SCHEMA_RETRIEVAL_FAILED: "schema-retrieval-failed",
  VERSION_MISMATCH: "version-mismatch",
  UNSUPPORTED_VERSION: "unsupported-version",
  RESOURCE_LIMIT_EXCEEDED: "resource-limit-exceeded",

  // Schema-load codes.
  UNRECOGNIZED_PROPERTY: "unrecognized-property",
  INAPPLICABLE_PROPERTY: "inapplicable-property",
  EXCLUSIVE_PROPERTIES: "exclusive-properties",
  UNRESOLVED_REFERENCE: "unresolved-reference",
  DUPLICATE_REFERENCE: "duplicate-reference",
  INVERTED_RANGE: "inverted-range",
  INVALID_BOUNDARY: "invalid-boundary",
  INDETERMINATE_OPERAND: "indeterminate-operand",
  INVALID_PATTERN: "invalid-pattern",
  UNSUPPORTED_PATTERN: "unsupported-pattern",
  CYCLIC_REFERENCE: "cyclic-reference",
  INCOMPATIBLE_COMPOSITION: "incompatible-composition",
  INVALID_DEFAULT: "invalid-default",
  SCHEMA_MALFORMED: "schema-malformed",

  // Validation codes.
  UNKNOWN_KEY: "unknown-key",
  MISSING_REQUIRED: "missing-required",
  TYPE_MISMATCH: "type-mismatch",
  ALLOWEDVALUES: "allowedvalues",
  PATTERN: "pattern",
  FORMAT: "format",
  MIN: "min",
  MAX: "max",
  MINLENGTH: "minlength",
  MAXLENGTH: "maxlength",
  UNIQUEITEMS: "uniqueitems",
  TUPLE_LENGTH: "tuple-length",
  KEYPATTERN: "keypattern",
  ONEOF: "oneof",
  ANYOF: "anyof",
  DEPENDENTREQUIRED: "dependentrequired",
  MUTUALLYEXCLUSIVE: "mutuallyexclusive",
  EXACTLYONE: "exactlyone",
  DEPRECATED: "deprecated",
} as const;

export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];
