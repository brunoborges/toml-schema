"""The stable diagnostic codes defined by SPEC.md's ``### Code Registry``.

Every unprefixed code this implementation emits is one of these constants, which
lets a conformance guard assert the implementation never emits a code outside the
registry (see ``conformance/codes.toml``). Message text is presentation and is
not represented here.
"""

from __future__ import annotations

# Discovery codes.
DISCOVERY_MISSING_LOCATION = "discovery-missing-location"
DISCOVERY_INVALID_METADATA = "discovery-invalid-metadata"
DISCOVERY_UNRESOLVED_LOCATION = "discovery-unresolved-location"
SCHEMA_RETRIEVAL_REFUSED = "schema-retrieval-refused"
SCHEMA_RETRIEVAL_FAILED = "schema-retrieval-failed"
VERSION_MISMATCH = "version-mismatch"
UNSUPPORTED_VERSION = "unsupported-version"
RESOURCE_LIMIT_EXCEEDED = "resource-limit-exceeded"

# Schema-load codes.
UNRECOGNIZED_PROPERTY = "unrecognized-property"
INAPPLICABLE_PROPERTY = "inapplicable-property"
EXCLUSIVE_PROPERTIES = "exclusive-properties"
UNRESOLVED_REFERENCE = "unresolved-reference"
DUPLICATE_REFERENCE = "duplicate-reference"
INVERTED_RANGE = "inverted-range"
INVALID_BOUNDARY = "invalid-boundary"
INDETERMINATE_OPERAND = "indeterminate-operand"
INVALID_PATTERN = "invalid-pattern"
UNSUPPORTED_PATTERN = "unsupported-pattern"
CYCLIC_REFERENCE = "cyclic-reference"
INCOMPATIBLE_COMPOSITION = "incompatible-composition"
INVALID_DEFAULT = "invalid-default"
SCHEMA_MALFORMED = "schema-malformed"

# Validation codes.
UNKNOWN_KEY = "unknown-key"
MISSING_REQUIRED = "missing-required"
TYPE_MISMATCH = "type-mismatch"
ALLOWEDVALUES = "allowedvalues"
PATTERN = "pattern"
FORMAT = "format"
MIN = "min"
MAX = "max"
MINLENGTH = "minlength"
MAXLENGTH = "maxlength"
UNIQUEITEMS = "uniqueitems"
TUPLE_LENGTH = "tuple-length"
KEYPATTERN = "keypattern"
ONEOF = "oneof"
ANYOF = "anyof"
DEPENDENTREQUIRED = "dependentrequired"
MUTUALLYEXCLUSIVE = "mutuallyexclusive"
EXACTLYONE = "exactlyone"
DEPRECATED = "deprecated"

# Every code this implementation can emit. The registry-guard conformance test
# asserts each appears in conformance/codes.toml.
ALL_EMITTABLE_CODES = frozenset(
    {
        DISCOVERY_MISSING_LOCATION,
        DISCOVERY_INVALID_METADATA,
        DISCOVERY_UNRESOLVED_LOCATION,
        SCHEMA_RETRIEVAL_REFUSED,
        SCHEMA_RETRIEVAL_FAILED,
        VERSION_MISMATCH,
        UNSUPPORTED_VERSION,
        RESOURCE_LIMIT_EXCEEDED,
        UNRECOGNIZED_PROPERTY,
        INAPPLICABLE_PROPERTY,
        EXCLUSIVE_PROPERTIES,
        UNRESOLVED_REFERENCE,
        DUPLICATE_REFERENCE,
        INVERTED_RANGE,
        INVALID_BOUNDARY,
        INDETERMINATE_OPERAND,
        INVALID_PATTERN,
        UNSUPPORTED_PATTERN,
        CYCLIC_REFERENCE,
        INCOMPATIBLE_COMPOSITION,
        INVALID_DEFAULT,
        SCHEMA_MALFORMED,
        UNKNOWN_KEY,
        MISSING_REQUIRED,
        TYPE_MISMATCH,
        ALLOWEDVALUES,
        PATTERN,
        FORMAT,
        MIN,
        MAX,
        MINLENGTH,
        MAXLENGTH,
        UNIQUEITEMS,
        TUPLE_LENGTH,
        KEYPATTERN,
        ONEOF,
        ANYOF,
        DEPENDENTREQUIRED,
        MUTUALLYEXCLUSIVE,
        EXACTLYONE,
        DEPRECATED,
    }
)
