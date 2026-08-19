"""Core public types: schema type names, diagnostics, and validation results."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Sequence


class SchemaType(str, Enum):
    """The built-in TOML Schema type names."""

    ANY = "any"
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    OFFSET_DATE_TIME = "offset-date-time"
    LOCAL_DATE_TIME = "local-date-time"
    LOCAL_DATE = "local-date"
    LOCAL_TIME = "local-time"
    ARRAY = "array"
    TABLE = "table"
    COLLECTION = "collection"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


_BUILT_IN_TYPES = {member.value: member for member in SchemaType}


def parse_schema_type(value: str) -> SchemaType | None:
    return _BUILT_IN_TYPES.get(value)


_TYPES_PREFIX = "types."


def normalize_reference(reference: str) -> str:
    """Strips a leading ``types.`` prefix, mirroring Go's
    ``strings.TrimPrefix(reference, "types.")``."""
    if reference.startswith(_TYPES_PREFIX):
        return reference[len(_TYPES_PREFIX) :]
    return reference


def normalize_references(references: Sequence[str]) -> List[str]:
    return [normalize_reference(reference) for reference in references]


class Severity(str, Enum):
    """The severity of a validation diagnostic."""

    ERROR = "error"
    WARNING = "warning"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


@dataclass(frozen=True)
class Diagnostic:
    """A single structured validation diagnostic (error or warning)."""

    severity: Severity
    code: str
    path: str
    message: str


# ValidationError is an alias for Diagnostic, mirroring the other reference
# implementations (which use one structured diagnostic type for both errors
# and warnings).
ValidationError = Diagnostic


@dataclass
class ValidationResult:
    """The outcome of validating a document against a Schema."""

    errors: List[Diagnostic] = field(default_factory=list)
    warnings: List[Diagnostic] = field(default_factory=list)

    @property
    def diagnostics(self) -> List[Diagnostic]:
        return [*self.errors, *self.warnings]

    @property
    def valid(self) -> bool:
        return len(self.errors) == 0

    def __bool__(self) -> bool:
        return self.valid
