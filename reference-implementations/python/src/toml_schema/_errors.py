"""Exception types raised while loading or discovering schemas."""

from __future__ import annotations

from typing import Optional

from ._codes import DISCOVERY_MISSING_LOCATION, SCHEMA_MALFORMED


class SchemaError(ValueError):
    """Raised when a ``.tosd`` schema document is structurally or semantically
    invalid.

    Carries a structured diagnostic identity (``code`` and optional
    ``schema_path``) so callers can report a normative diagnostic instead of
    parsing free-form message text. The default ``code`` is the schema-load
    ``schema-malformed`` catch-all, which SPEC.md designates for any schema-load
    failure with no more specific code.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str = SCHEMA_MALFORMED,
        schema_path: Optional[str] = None,
        phase: str = "schema-load",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.schema_path = schema_path
        self.phase = phase


class DiscoveryError(ValueError):
    """Raised when a document's ``[toml-schema].location`` cannot be resolved
    to a schema, or when its metadata is malformed.

    Discovery diagnostics never carry an instance path (SPEC.md ``### Phases``).
    """

    def __init__(
        self,
        message: str,
        *,
        code: str = DISCOVERY_MISSING_LOCATION,
        schema_path: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.schema_path = schema_path
        self.phase = "discovery"


class DocumentParseError(ValueError):
    """Raised when the document under validation is not well-formed TOML.

    SPEC.md: such a document "never reaches a validator, and its parse failure
    is a parse error rather than a validation diagnostic". It MUST NOT be
    reported as a diagnostic under any registry or extension code, and a
    command-line validator exits ``2``.
    """
