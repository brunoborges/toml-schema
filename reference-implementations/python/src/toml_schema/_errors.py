"""Exception types raised while loading or discovering schemas."""

from __future__ import annotations


class SchemaError(ValueError):
    """Raised when a `.tosd` schema document is structurally or semantically
    invalid."""


class DiscoveryError(ValueError):
    """Raised when a document's ``[toml-schema].location`` cannot be resolved
    to a schema, or when its metadata is malformed."""
