"""TOML Schema reference library.

Load ``.tosd`` schema documents (see SPEC.md) and validate TOML documents
against them, using only the Python standard library (``tomllib``) at
runtime.

Quick start::

    from toml_schema import load_schema

    schema = load_schema("config.tosd")
    result = schema.validate_file("config.toml")
    if not result.valid:
        for error in result.errors:
            print(f"{error.path}: {error.message}")

Discovering a document's own schema via its ``[toml-schema].location``
metadata::

    from toml_schema import validate_document

    result = validate_document("config.toml")
"""

from ._definition import Condition, Definition
from ._discovery import (
    compare_document_schema_version,
    resolve_schema_location,
    schema_from_document,
    validate_document,
)
from ._errors import DiscoveryError, SchemaError
from ._schema import Schema, load_document, load_schema
from ._types import Diagnostic, Severity, SchemaType, ValidationError, ValidationResult

__version__ = "1.0.0-rc.2"

__all__ = [
    "__version__",
    "load_schema",
    "load_document",
    "schema_from_document",
    "validate_document",
    "resolve_schema_location",
    "compare_document_schema_version",
    "Schema",
    "Definition",
    "Condition",
    "ValidationResult",
    "Diagnostic",
    "ValidationError",
    "Severity",
    "SchemaType",
    "SchemaError",
    "DiscoveryError",
]
