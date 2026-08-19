"""Schema discovery from a document's ``[toml-schema].location`` metadata.

Mirrors Go's ``SchemaFromDocument``/``resolveSchemaLocation``: a document may
declare where its own schema lives, either as a local filesystem path or as a
(possibly relative) ``file://`` URI resolved against the document's own path.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Tuple
from urllib.parse import quote, urljoin, urlsplit, unquote

from ._errors import DiscoveryError, SchemaError
from ._schema import Schema, load_document, load_schema, SEMVER_PATTERN
from ._types import Diagnostic, Severity, ValidationResult

_INVALID_URI_REFERENCE_CHARS = set('\\"<>^`{|}')


def _has_invalid_uri_reference_character(reference: str) -> bool:
    for character in reference:
        if character <= " " or character == "\x7f":
            return True
        if character in _INVALID_URI_REFERENCE_CHARS:
            return True
    return False


def _is_schema_reference_scalar(value: Any) -> bool:
    # Every TOML value that is not an array or table is a scalar (string,
    # integer, float, boolean, or one of the three date/time kinds).
    return not isinstance(value, (list, dict))


def _local_path_from_file_uri(parts) -> str:
    if parts.fragment or parts.query:
        raise DiscoveryError("file URI contains unsupported components")
    netloc = parts.netloc
    if "@" in netloc:
        raise DiscoveryError("file URI contains unsupported components")
    if netloc and netloc.lower() != "localhost":
        raise DiscoveryError("file URI has a non-local host")
    escaped_path = parts.path.lower()
    if "%2f" in escaped_path or "%5c" in escaped_path:
        raise DiscoveryError("file URI contains an encoded path separator")
    path = unquote(parts.path)
    if not path or "\x00" in path:
        raise DiscoveryError("file URI does not contain a safe path")
    if sys.platform.startswith("win") and len(path) >= 3 and path[0] == "/" and path[2] == ":":
        path = path[1:]
    if os.sep != "/":
        path = path.replace("/", os.sep)
    if not os.path.isabs(path):
        raise DiscoveryError("file URI path is not absolute")
    return path


def resolve_schema_location(document_path: str, location: str) -> str:
    if os.path.isabs(location):
        return os.path.normpath(location)
    if _has_invalid_uri_reference_character(location):
        raise DiscoveryError(f"invalid [toml-schema].location URI: {location}")
    try:
        parts = urlsplit(location)
        if parts.scheme:
            # `location` is itself an absolute URI reference: per RFC 3986
            # section 5.3, the base is ignored entirely (mirrors Go's
            # url.URL.ResolveReference short-circuit for absolute
            # references). A reference with no authority and a path that
            # does not start with "/" is opaque (e.g. "file:something") and
            # is rejected below, same as Go's uri.Opaque != "" check.
            is_opaque = not parts.netloc and not parts.path.startswith("/")
        else:
            absolute_document_path = os.path.abspath(document_path)
            base = "file://" + quote(absolute_document_path.replace(os.sep, "/"), safe="/")
            parts = urlsplit(urljoin(base, location))
            is_opaque = False
    except ValueError as exc:
        raise DiscoveryError(f"invalid [toml-schema].location URI: {location}: {exc}") from exc
    if parts.scheme.lower() != "file":
        raise DiscoveryError(f"unsupported schema location URI scheme: {parts.scheme}")
    if is_opaque:
        raise DiscoveryError(
            f"invalid file schema location: {location}: file URI contains unsupported components"
        )
    try:
        path = _local_path_from_file_uri(parts)
    except DiscoveryError as exc:
        raise DiscoveryError(f"invalid file schema location: {location}: {exc}") from exc
    return os.path.normpath(path)


def compare_document_schema_version(value: Any, actual: str) -> str:
    """Returns a warning string when versions differ but remain compatible
    (same major version); raises DiscoveryError on incompatible/invalid
    versions."""
    if not isinstance(value, str):
        raise DiscoveryError("document [toml-schema].version must be a SemVer string")
    expected_parts = SEMVER_PATTERN.match(value)
    if not expected_parts:
        raise DiscoveryError("document [toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax")
    actual_parts = SEMVER_PATTERN.match(actual)
    if expected_parts.group(1) != actual_parts.group(1):
        raise DiscoveryError(
            f"document expects TOML Schema major version {value}, but resolved schema uses {actual}"
        )
    if value != actual:
        return f"Warning: document expects TOML Schema version {value}, but resolved schema uses {actual}"
    return ""


def schema_from_document(document_path: str) -> Tuple[Schema, dict]:
    """Loads a document and discovers+loads its schema via
    ``[toml-schema].location`` (and, if present, checks
    ``[toml-schema].version`` compatibility, appending a warning to
    ``schema.warnings`` on a compatible-but-differing version).

    Raises :class:`toml_schema.SchemaError`/:class:`toml_schema.DiscoveryError`
    if discovery or schema loading fails.
    """
    document = load_document(document_path)
    metadata = document.get("toml-schema")
    if not isinstance(metadata, dict):
        raise DiscoveryError("document does not contain [toml-schema].location")
    for key, value in metadata.items():
        if not _is_schema_reference_scalar(value):
            raise DiscoveryError(f"document [toml-schema].{key} must be a scalar value")
    location = metadata.get("location")
    if not isinstance(location, str) or location.strip() == "":
        raise DiscoveryError("document does not contain [toml-schema].location")

    schema_path = resolve_schema_location(document_path, location)
    schema = load_schema(schema_path)
    if "version" in metadata:
        warning = compare_document_schema_version(metadata["version"], schema.version)
        if warning:
            schema.warnings.append(warning)
    return schema, document


def validate_document(document_path: str) -> ValidationResult:
    """Convenience wrapper combining schema discovery and validation for a
    single document: loads the document, discovers its schema via
    ``[toml-schema].location``, and validates the document against it.

    Discovery or schema-load failures are reported as a single structured
    error diagnostic rather than raised, so callers can treat this the same
    way as :meth:`Schema.validate_file`.
    """
    try:
        schema, document = schema_from_document(document_path)
    except (SchemaError, DiscoveryError, OSError) as exc:
        diagnostic = Diagnostic(
            severity=Severity.ERROR, code="document-parse-error", path="$", message=str(exc)
        )
        return ValidationResult(errors=[diagnostic])
    return schema.validate(document)
