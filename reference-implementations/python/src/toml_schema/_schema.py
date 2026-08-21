"""Schema loading: parses a ``.tosd`` document into a validated Definition
tree and exposes the ``Schema`` public API (``validate``, ``validate_file``,
``element``, ``type``).

This mirrors the load-time logic in Go's ``schema.go`` (``LoadSchema``,
``parseDefinition``/``parseDefinitions``, the semantic validation passes, and
the annotation resolver) as closely as possible.
"""

from __future__ import annotations

import dataclasses
import re
import tomllib
from typing import Any, Dict, List, Optional, Set, Tuple

from ._compare import (
    compare,
    is_infinite,
    is_nan,
    is_numeric,
    is_range_comparable,
    is_type,
    values_equal,
)
from ._definition import Condition, Definition
from ._errors import SchemaError
from ._formats import SUPPORTED_FORMATS, matches_format
from ._source import SchemaSource
from ._types import (
    Diagnostic,
    Severity,
    SchemaType,
    ValidationResult,
    normalize_reference,
    normalize_references,
    parse_schema_type,
)
from ._validator import Validator

Path = Tuple[str, ...]

# The full TOML Schema vocabulary. Must exactly match the ABNF `schema-key`
# production (see toml-schema.abnf and tests/test_abnf_conformance.py).
DEFINITION_KEYS = frozenset(
    {
        "type",
        "description",
        "itemtype",
        "items",
        "allowedvalues",
        "pattern",
        "format",
        "keypattern",
        "optional",
        "min",
        "max",
        "minlength",
        "maxlength",
        "oneof",
        "anyof",
        "dependentrequired",
        "mutuallyexclusive",
        "exactlyone",
        "allof",
        "uniqueitems",
        "default",
        "deprecated",
        "if",
        "then",
        "else",
    }
)

NAMED_REFERENCE_KEYS = frozenset({"type", "description", "optional", "allof", "default", "deprecated"})
UNION_KEYS = frozenset({"oneof", "anyof", "description", "optional", "allof", "default", "deprecated"})
CONDITIONAL_KEYS = frozenset(
    {"if", "then", "else", "description", "optional", "allof", "default", "deprecated"}
)

# TOML Schema 1.0.0 has not been released yet; this is the version new
# schema-language features are developed against ahead of that release. Do
# not bump this beyond 1.0.0 until the release actually ships.
CURRENT_TOML_SCHEMA_VERSION = "1.0.0"

SEMVER_PATTERN = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


def validate_schema_version(value: Any) -> None:
    if not isinstance(value, str):
        raise SchemaError("[toml-schema].version must be a SemVer string")
    match = SEMVER_PATTERN.match(value)
    if not match:
        raise SchemaError("[toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax")
    if match.group(1) != "1":
        raise SchemaError(f"unsupported TOML Schema major version: {value}")
    if match.group(2) != "0":
        raise SchemaError(f"unsupported TOML Schema minor version: {value}")


def load_document(path: str) -> dict:
    """Parses a TOML document file into plain Python values."""
    with open(path, "rb") as handle:
        return tomllib.load(handle)


def _property_value(table: dict, key: str) -> Any:
    """Returns table[key] unless it is a table (dict) value, in which case
    None is returned -- mirrors Go's propertyValue, which only ever looks at
    *scalar/array* annotation values (table-valued ambiguity is handled
    separately via the schema source scanner)."""
    value = table.get(key)
    if isinstance(value, dict):
        return None
    return value


def _get_string(table: dict, key: str) -> str:
    value = _property_value(table, key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise SchemaError(f"expected {key} to be a string")
    return value


def _get_bool(table: dict, key: str) -> bool:
    value = _property_value(table, key)
    if value is None:
        return False
    if not isinstance(value, bool):
        raise SchemaError(f"expected {key} to be a boolean")
    return value


def _get_optional_bool(table: dict, key: str) -> Optional[bool]:
    value = _property_value(table, key)
    if value is None:
        return None
    if not isinstance(value, bool):
        raise SchemaError(f"expected {key} to be a boolean")
    return value


def _get_pattern(name: str, table: dict) -> Optional[re.Pattern]:
    return _get_pattern_key(name, table, "pattern")


def _get_pattern_key(name: str, table: dict, key: str) -> Optional[re.Pattern]:
    value = _property_value(table, key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise SchemaError(f"expected {key} to be a string")
    _validate_portable_pattern(name, key, value)
    try:
        return re.compile(value)
    except re.error as exc:
        raise SchemaError(f"invalid-pattern: {name} has invalid {key}: {exc}") from exc


def _validate_portable_pattern(name: str, key: str, pattern: str) -> None:
    index = 0
    in_character_class = False
    while index < len(pattern):
        current = pattern[index]
        if current == "\\" and index + 1 < len(pattern):
            escaped = pattern[index + 1]
            if escaped not in "\\.^$*+?()[]{}|-tnrfva":
                raise SchemaError(
                    f"unsupported-pattern: {name} {key} uses non-portable escape \\{escaped}"
                )
            index += 2
            continue
        if current == "[":
            in_character_class = True
        elif current == "]":
            in_character_class = False
        elif not in_character_class and current == "(" and pattern[index + 1 : index + 2] == "?":
            if pattern[index + 2 : index + 3] != ":":
                raise SchemaError(
                    f"unsupported-pattern: {name} {key} uses non-portable group syntax"
                )
        elif (
            not in_character_class
            and current in "?*+}"
            and pattern[index + 1 : index + 2] in ("?", "+")
        ):
            raise SchemaError(
                f"unsupported-pattern: {name} {key} uses a non-greedy or possessive quantifier"
            )
        index += 1


def _get_array_values(table: dict, key: str) -> Optional[list]:
    value = _property_value(table, key)
    if value is None:
        return None
    if not isinstance(value, list):
        raise SchemaError(f"expected {key} to be an array")
    return value


def _get_string_array_values(table: dict, key: str) -> List[str]:
    values = _get_array_values(table, key)
    if values is None:
        return []
    result = []
    for value in values:
        if not isinstance(value, str):
            raise SchemaError(f"expected {key} to contain only strings")
        result.append(value)
    return result


_MAX_INT32 = 2**31 - 1


def _get_integer_pointer(table: dict, key: str) -> Optional[int]:
    value = _property_value(table, key)
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool):
        raise SchemaError(f"expected {key} to be an integer")
    if value < 0 or value > _MAX_INT32:
        raise SchemaError(f"{key} must be between 0 and {_MAX_INT32}")
    return value


def _get_conditional(
    name: str, path: Path, table: dict, source: SchemaSource
) -> Tuple[Optional[Condition], str, str]:
    has_if = source.is_property(table, path, "if")
    has_then = source.is_property(table, path, "then")
    has_else = source.is_property(table, path, "else")
    if not (has_if or has_then or has_else):
        return None, "", ""
    if not (has_if and has_then and has_else):
        raise SchemaError(f"{name} must define if, then, and else together")
    raw_condition = table.get("if")
    if not isinstance(raw_condition, dict):
        raise SchemaError(f"{name} if must be an inline table")
    for key in raw_condition:
        if key not in ("key", "equals", "in"):
            raise SchemaError(f"{name} if contains unsupported property: {key}")
    key = raw_condition.get("key")
    if not isinstance(key, str):
        raise SchemaError(f"{name} if.key must be a string")
    has_equals = "equals" in raw_condition
    has_in = "in" in raw_condition
    if has_equals == has_in:
        raise SchemaError(f"{name} if must define exactly one of equals and in")
    equals_value = raw_condition.get("equals")
    in_values: Tuple[Any, ...] = ()
    if has_in:
        raw_in = raw_condition["in"]
        if not isinstance(raw_in, list) or len(raw_in) == 0:
            raise SchemaError(f"{name} if.in must be a non-empty array")
        in_values = tuple(raw_in)
    then_reference = table.get("then")
    if not isinstance(then_reference, str) or then_reference.strip() == "":
        raise SchemaError(f"{name} then must be a non-blank named type reference")
    else_reference = table.get("else")
    if not isinstance(else_reference, str) or else_reference.strip() == "":
        raise SchemaError(f"{name} else must be a non-blank named type reference")
    for property_name, reference in (("then", then_reference), ("else", else_reference)):
        if parse_schema_type(normalize_reference(reference)) is not None:
            raise SchemaError(f"{name} {property_name} must be a named reusable type reference")
    return (
        Condition(key=key, has_equals=has_equals, equals=equals_value, in_values=in_values),
        then_reference,
        else_reference,
    )


def _get_dependent_required(
    name: str, path: Path, table: dict, source: SchemaSource
) -> Dict[str, Tuple[str, ...]]:
    if not source.is_property(table, path, "dependentrequired"):
        return {}
    dependencies = table.get("dependentrequired")
    if not isinstance(dependencies, dict):
        raise SchemaError(f"{name} dependentrequired must be a table")
    if len(dependencies) == 0:
        raise SchemaError(f"{name} dependentrequired must not be empty")
    result: Dict[str, Tuple[str, ...]] = {}
    for trigger, raw in dependencies.items():
        if not isinstance(raw, list) or len(raw) == 0:
            raise SchemaError(f"{name} dependentrequired.{trigger} must be a non-empty string array")
        seen: Set[str] = set()
        values: List[str] = []
        for value in raw:
            if not isinstance(value, str):
                raise SchemaError(f"{name} dependentrequired.{trigger} must contain only strings")
            if value in seen:
                raise SchemaError(f"{name} dependentrequired.{trigger} contains duplicate {value!r}")
            seen.add(value)
            values.append(value)
        result[trigger] = tuple(values)
    return result


def _get_key_groups(
    name: str, path: Path, table: dict, key: str, source: SchemaSource
) -> Tuple[Tuple[str, ...], ...]:
    if not source.is_property(table, path, key):
        return ()
    groups = table.get(key)
    if not isinstance(groups, list) or len(groups) == 0:
        raise SchemaError(f"{name} {key} must be a non-empty array")
    result: List[Tuple[str, ...]] = []
    for index, raw_group in enumerate(groups):
        if not isinstance(raw_group, list) or len(raw_group) < 2:
            raise SchemaError(f"{name} {key}[{index}] must contain at least two strings")
        seen: Set[str] = set()
        converted: List[str] = []
        for raw_name in raw_group:
            if not isinstance(raw_name, str):
                raise SchemaError(f"{name} {key}[{index}] must contain only strings")
            if raw_name in seen:
                raise SchemaError(f"{name} {key}[{index}] contains duplicate {raw_name!r}")
            seen.add(raw_name)
            converted.append(raw_name)
        result.append(tuple(converted))
    return tuple(result)


def _reject_bare_collection_reference(name: str, property_name: str, reference: str) -> None:
    if normalize_reference(reference) == SchemaType.COLLECTION.value:
        raise SchemaError(f"{name} cannot use collection as a bare {property_name} reference")


def _reject_bare_collection_references(name: str, property_name: str, references: List[str]) -> None:
    for reference in references:
        _reject_bare_collection_reference(name, property_name, normalize_reference(reference))


def _validate_alternative_references(name: str, property_name: str, references: List[str]) -> None:
    seen: Dict[str, str] = {}
    for reference in references:
        normalized = normalize_reference(reference)
        _reject_bare_collection_reference(name, property_name, normalized)
        if normalized == SchemaType.ANY.value:
            raise SchemaError(f"{name} cannot use any directly in {property_name}")
        if normalized in seen:
            raise SchemaError(
                f"{name} {property_name} contains duplicate type references "
                f"{seen[normalized]!r} and {reference!r}; both resolve to {normalized}"
            )
        seen[normalized] = reference


def _is_range_boundary(value: Any) -> bool:
    from ._compare import is_local_date, is_local_date_time, is_local_time, is_offset_date_time

    return (
        is_numeric(value)
        or is_offset_date_time(value)
        or is_local_date_time(value)
        or is_local_date(value)
        or is_local_time(value)
    )


def _validate_range_boundary(name: str, key: str, value: Any) -> None:
    if value is None or _is_range_boundary(value):
        return
    raise SchemaError(f"{name} {key} must be an integer, float, or temporal value")


def _boundary_matches_type(value: Any, type_name: SchemaType) -> bool:
    from ._compare import is_local_date, is_local_date_time, is_local_time, is_offset_date_time

    if type_name in (SchemaType.INTEGER, SchemaType.FLOAT):
        return is_numeric(value)
    if type_name == SchemaType.OFFSET_DATE_TIME:
        return is_offset_date_time(value)
    if type_name == SchemaType.LOCAL_DATE_TIME:
        return is_local_date_time(value)
    if type_name == SchemaType.LOCAL_DATE:
        return is_local_date(value)
    if type_name == SchemaType.LOCAL_TIME:
        return is_local_time(value)
    return False


def _validate_boundary_matches_type(name: str, key: str, value: Any, type_name: SchemaType) -> None:
    if value is None or _boundary_matches_type(value, type_name):
        return
    raise SchemaError(f"{name} {key} must be comparable with {type_name}")


def _validate_range_constraints(
    name: str, type_name: Optional[SchemaType], min_value: Any, max_value: Any
) -> None:
    if min_value is None and max_value is None:
        return
    _validate_range_boundary(name, "min", min_value)
    _validate_range_boundary(name, "max", max_value)
    if is_nan(min_value):
        raise SchemaError(f"{name} cannot use NaN as min")
    if is_nan(max_value):
        raise SchemaError(f"{name} cannot use NaN as max")
    if type_name == SchemaType.ANY:
        raise SchemaError(f"{name} cannot define min or max when type is any")
    if type_name in (SchemaType.ARRAY, SchemaType.COLLECTION):
        return
    if type_name is not None and not is_range_comparable(type_name):
        raise SchemaError(
            f"{name} can only define min or max for integer, float, date/time, or compatible array types"
        )
    if type_name is not None:
        _validate_boundary_matches_type(name, "min", min_value, type_name)
        _validate_boundary_matches_type(name, "max", max_value, type_name)
        _validate_ordered_range(name, min_value, max_value, type_name)


def _validate_ordered_range(
    name: str, min_value: Any, max_value: Any, comparable_kind: SchemaType
) -> None:
    if comparable_kind == SchemaType.INTEGER:
        if is_infinite(min_value):
            raise SchemaError(f"{name} cannot use infinity as min when comparable kind is integer")
        if is_infinite(max_value):
            raise SchemaError(f"{name} cannot use infinity as max when comparable kind is integer")
    if min_value is not None and max_value is not None and compare(min_value, max_value) > 0:
        raise SchemaError(f"{name} min must not be greater than max")


def _validate_allowed_values_constraints(
    name: str,
    type_name: Optional[SchemaType],
    allowed_values: List[Any],
    pattern: Optional[re.Pattern],
    format_name: str,
    min_value: Any,
    max_value: Any,
    min_length: Optional[int],
    max_length: Optional[int],
) -> None:
    from ._compare import IncomparableError, compare

    if not allowed_values:
        return
    is_container = type_name in (SchemaType.ARRAY, SchemaType.COLLECTION)
    for index, allowed in enumerate(allowed_values):
        entry = f"{name} allowedvalues[{index}]"
        if pattern is not None:
            if not isinstance(allowed, str) or not pattern.search(allowed):
                raise SchemaError(f"{entry} does not satisfy pattern")
        if format_name:
            if not isinstance(allowed, str) or not matches_format(allowed, format_name):
                raise SchemaError(f"{entry} does not satisfy format {format_name}")
        if (min_value is not None or max_value is not None) and is_nan(allowed):
            raise SchemaError(f"{entry} does not satisfy min or max")
        if min_value is not None:
            try:
                comparison = compare(allowed, min_value)
            except IncomparableError as exc:
                raise SchemaError(f"{entry} cannot be compared with min: {exc}") from exc
            if comparison < 0:
                raise SchemaError(f"{entry} is less than min")
        if max_value is not None:
            try:
                comparison = compare(allowed, max_value)
            except IncomparableError as exc:
                raise SchemaError(f"{entry} cannot be compared with max: {exc}") from exc
            if comparison > 0:
                raise SchemaError(f"{entry} is greater than max")
        if not is_container and (min_length is not None or max_length is not None):
            if not isinstance(allowed, str):
                raise SchemaError(f"{entry} does not satisfy string length constraints")
            length = len(allowed)
            if min_length is not None and length < min_length:
                raise SchemaError(f"{entry} is shorter than minlength")
            if max_length is not None and length > max_length:
                raise SchemaError(f"{entry} is longer than maxlength")


def parse_definitions(
    prefix: str, table: Optional[dict], required: bool, source: SchemaSource
) -> Dict[str, Definition]:
    if table is None:
        if required:
            raise SchemaError(f"missing required [{prefix}] table")
        return {}
    definitions: Dict[str, Definition] = {}
    for key, value in table.items():
        if prefix == "types":
            if parse_schema_type(key) is not None:
                raise SchemaError(f"[types.{key}] uses a reserved built-in type name")
            if key.startswith("types."):
                raise SchemaError(f"[types.{key}] uses the reserved type-reference prefix")
        if not isinstance(value, dict):
            raise SchemaError(f"[{prefix}] entry must be a table: {key}")
        definition = parse_definition(f"{prefix}.{key}", (prefix, key), value, source)
        definitions[key] = definition
    return definitions


def _is_selector_bearing_child(table: dict, path: Path, source: SchemaSource) -> bool:
    return any(
        source.is_property(table, path, key)
        for key in ("type", "oneof", "anyof", "if")
    )


def parse_definition(name: str, path: Path, table: dict, source: SchemaSource) -> Definition:
    type_selector = _get_string(table, "type")
    if _property_value(table, "type") is not None and type_selector == "":
        raise SchemaError(f"{name} type must not be blank")
    type_name: Optional[SchemaType] = None
    reference = ""
    if type_selector:
        normalized_selector = normalize_reference(type_selector)
        builtin = parse_schema_type(normalized_selector)
        if builtin is not None:
            type_name = builtin
        else:
            reference = normalized_selector
    if reference:
        for key in table:
            if key not in NAMED_REFERENCE_KEYS:
                raise SchemaError(f"{name} named type reference cannot define {key}")

    description = _get_string(table, "description")
    item_reference = _get_string(table, "itemtype")
    if _property_value(table, "itemtype") is not None and item_reference == "":
        raise SchemaError(f"{name} itemtype must not be blank")
    items = _get_string_array_values(table, "items")
    if _property_value(table, "items") is not None and len(items) == 0:
        raise SchemaError(f"{name} items must contain at least one type reference")
    optional = _get_bool(table, "optional")
    pattern = _get_pattern(name, table)
    format_name = _get_string(table, "format")
    if _property_value(table, "format") is not None and format_name not in SUPPORTED_FORMATS:
        supported = ", ".join(sorted(SUPPORTED_FORMATS))
        raise SchemaError(f"{name} has unknown format {format_name!r}; supported formats: {supported}")
    key_pattern = _get_pattern_key(name, table, "keypattern")
    min_length = _get_integer_pointer(table, "minlength")
    max_length = _get_integer_pointer(table, "maxlength")
    allowed_values = _get_array_values(table, "allowedvalues") or []
    has_allowed_values = _property_value(table, "allowedvalues") is not None
    if has_allowed_values and len(allowed_values) == 0:
        raise SchemaError(f"{name} allowedvalues must contain at least one entry")
    has_one_of = _property_value(table, "oneof") is not None
    has_any_of = _property_value(table, "anyof") is not None
    one_of = _get_string_array_values(table, "oneof")
    any_of = _get_string_array_values(table, "anyof")
    all_of = _get_string_array_values(table, "allof")
    condition, then_reference, else_reference = _get_conditional(name, path, table, source)

    for property_name, references in (
        ("items", items),
        ("oneof", one_of),
        ("anyof", any_of),
        ("allof", all_of),
    ):
        for reference_value in references:
            if reference_value == "":
                raise SchemaError(f"{name} {property_name} references must not be blank")

    if has_one_of and len(one_of) == 0:
        raise SchemaError(f"{name} oneof must contain at least one type reference")
    if has_any_of and len(any_of) == 0:
        raise SchemaError(f"{name} anyof must contain at least one type reference")
    if _property_value(table, "allof") is not None and len(all_of) == 0:
        raise SchemaError(f"{name} allof must contain at least one type reference")

    _reject_bare_collection_reference(name, "itemtype", item_reference)
    _reject_bare_collection_references(name, "items", items)
    _validate_alternative_references(name, "oneof", one_of)
    _validate_alternative_references(name, "anyof", any_of)
    _validate_alternative_references(name, "allof", all_of)

    if (
        type_selector
        and type_name != SchemaType.COLLECTION
        and normalize_reference(type_selector) == SchemaType.COLLECTION.value
    ):
        raise SchemaError(f"{name} cannot use collection as a bare type reference")

    type_selectors = 0
    if type_selector:
        type_selectors += 1
    if has_one_of:
        type_selectors += 1
    if has_any_of:
        type_selectors += 1
    if condition is not None:
        type_selectors += 1
    if type_selectors > 1:
        raise SchemaError(f"{name} cannot define more than one of type, oneof, anyof, and if")

    children: Dict[str, Definition] = {}
    escaped_children = table.get("children")
    has_escape_namespace = (
        isinstance(escaped_children, dict)
        and not _is_selector_bearing_child(escaped_children, path + ("children",), source)
    )
    if has_escape_namespace:
        if not escaped_children:
            raise SchemaError(f"{name} children escape namespace must not be empty")
        for key, value in escaped_children.items():
            if key not in DEFINITION_KEYS and key != "children":
                raise SchemaError(
                    f"{name} children escape namespace contains non-conflicting child: {key}"
                )
            if not isinstance(value, dict):
                raise SchemaError(f"{name}.children.{key} must be a child definition table")
            children[key] = parse_definition(
                f"{name}.{key}", path + ("children", key), value, source
            )

    for key, value in table.items():
        if key == "children" and has_escape_namespace:
            continue
        if key in DEFINITION_KEYS and source.is_property(table, path, key):
            continue
        if isinstance(value, dict):
            if key in children:
                raise SchemaError(f"{name} defines child {key} more than once")
            child = parse_definition(f"{name}.{key}", path + (key,), value, source)
            children[key] = child
        elif key not in DEFINITION_KEYS:
            raise SchemaError(f"{name} contains unsupported property: {key}")

    if has_one_of or has_any_of:
        for key in table:
            if key not in UNION_KEYS:
                raise SchemaError(f"{name} union cannot define {key}")

    if condition is not None:
        for key in table:
            if key not in CONDITIONAL_KEYS:
                raise SchemaError(f"{name} conditional selector cannot define {key}")
        if children:
            raise SchemaError(f"{name} conditional selector cannot define child definitions")

    if type_name is None and not reference and not has_one_of and not has_any_of and condition is None:
        if not children:
            if not all_of:
                raise SchemaError(f"{name} must define type, oneof, anyof, or child definitions")
        else:
            type_name = SchemaType.TABLE

    if children and type_name not in (SchemaType.TABLE, SchemaType.COLLECTION):
        raise SchemaError(f"{name} can only define children when type is table or collection")
    if type_name not in (SchemaType.ARRAY, SchemaType.COLLECTION) and item_reference:
        raise SchemaError(f"{name} can only define itemtype when type is array or collection")
    if type_name != SchemaType.ARRAY and items:
        raise SchemaError(f"{name} can only define items when type is array")

    if items:
        if item_reference:
            raise SchemaError(f"{name} cannot define both items and itemtype")
        if min_length is not None or max_length is not None:
            raise SchemaError(f"{name} cannot define minlength or maxlength together with items")
        if has_allowed_values:
            raise SchemaError(f"{name} cannot define allowedvalues together with items")
        if _property_value(table, "min") is not None or _property_value(table, "max") is not None:
            raise SchemaError(f"{name} cannot define min or max together with items")
        if pattern is not None or format_name:
            raise SchemaError(f"{name} cannot define pattern or format together with items")

    min_value = _property_value(table, "min")
    max_value = _property_value(table, "max")
    if min_length is not None and max_length is not None and min_length > max_length:
        raise SchemaError(f"{name} minlength must not be greater than maxlength")
    if key_pattern is not None and type_name != SchemaType.COLLECTION:
        raise SchemaError(f"{name} can only define keypattern when type is collection")
    if pattern is not None and type_name not in (
        SchemaType.STRING,
        SchemaType.ARRAY,
        SchemaType.COLLECTION,
    ):
        raise SchemaError(f"{name} can only define pattern when type is string")
    if format_name and type_name not in (
        SchemaType.STRING,
        SchemaType.ARRAY,
        SchemaType.COLLECTION,
    ):
        raise SchemaError(
            f"{name} can only define format when locally selecting built-in type string"
        )
    if has_allowed_values and type_name == SchemaType.TABLE:
        raise SchemaError(f"{name} can only define allowedvalues for scalar, unconstrained, or array types")
    if (min_length is not None or max_length is not None) and type_name not in (
        SchemaType.STRING,
        SchemaType.ARRAY,
        SchemaType.COLLECTION,
    ):
        raise SchemaError(
            f"{name} can only define minlength or maxlength when type is string, array, or collection"
        )
    if type_name == SchemaType.COLLECTION and not item_reference and not all_of:
        raise SchemaError(f"{name} must define itemtype when type is collection")

    _validate_range_constraints(name, type_name, min_value, max_value)
    _validate_allowed_values_constraints(
        name, type_name, allowed_values, pattern, format_name, min_value, max_value, min_length, max_length
    )

    dependent_required = _get_dependent_required(name, path, table, source)
    mutually_exclusive = _get_key_groups(name, path, table, "mutuallyexclusive", source)
    exactly_one = _get_key_groups(name, path, table, "exactlyone", source)
    unique_items = _get_optional_bool(table, "uniqueitems")
    deprecated_ptr = _get_optional_bool(table, "deprecated")

    has_default = source.is_property(table, path, "default")
    default_value = table.get("default") if has_default else None
    if condition is not None and has_default and not isinstance(default_value, dict):
        raise SchemaError(f"{name} conditional default must be a table")

    return Definition(
        name=name,
        type_name=type_name,
        reference=reference,
        description=description,
        item_reference=normalize_reference(item_reference),
        items=tuple(normalize_references(items)),
        optional=optional,
        allowed_values=tuple(allowed_values),
        pattern=pattern,
        format=format_name,
        key_pattern=key_pattern,
        min=min_value,
        max=max_value,
        min_length=min_length,
        max_length=max_length,
        one_of=tuple(normalize_references(one_of)),
        any_of=tuple(normalize_references(any_of)),
        condition=condition,
        then_reference=normalize_reference(then_reference),
        else_reference=normalize_reference(else_reference),
        all_of=tuple(normalize_references(all_of)),
        dependent_required=dependent_required,
        mutually_exclusive=mutually_exclusive,
        exactly_one=exactly_one,
        unique_items=unique_items,
        default_value=default_value,
        has_default=has_default,
        deprecated=bool(deprecated_ptr) if deprecated_ptr is not None else False,
        has_deprecated=deprecated_ptr is not None,
        children=children,
    )


class Schema:
    """A parsed, validated TOML Schema document.

    Construct via :func:`load_schema`. Public accessors: :meth:`validate`,
    :meth:`validate_file`, :meth:`element`, :meth:`type`, and
    :attr:`warnings` (non-fatal discovery warnings, e.g. schema-language
    version mismatches).
    """

    def __init__(
        self, source: str, version: str, types: Dict[str, Definition], elements: Dict[str, Definition]
    ) -> None:
        self.source = source
        self.version = version
        self.warnings: List[str] = []
        self.types = types
        self.elements = elements

    # -- public API -----------------------------------------------------------

    def element(self, name: str) -> Optional[Definition]:
        """Returns an element definition with inherited annotations resolved."""
        definition = self.elements.get(name)
        if definition is None:
            return None
        return self._with_effective_annotations(definition)

    def type(self, name: str) -> Optional[Definition]:
        """Returns a named type definition with inherited annotations resolved."""
        definition = self.types.get(normalize_reference(name))
        if definition is None:
            return None
        return self._with_effective_annotations(definition)

    def validate(self, document: dict) -> ValidationResult:
        validator = Validator(self)
        validator.validate_table("$", document, self.elements)
        for key in document:
            if key not in self.elements and key != "toml-schema":
                validator.add(f"$.{_encode_root_key(key)}", "unexpected key")
        return ValidationResult(errors=validator.errors, warnings=validator.warnings)

    def validate_file(self, path: str) -> ValidationResult:
        try:
            document = load_document(path)
        except Exception as exc:  # noqa: BLE001 - surfaced as a structured diagnostic
            diagnostic = Diagnostic(
                severity=Severity.ERROR, code="document-parse-error", path="$", message=str(exc)
            )
            return ValidationResult(errors=[diagnostic])
        return self.validate(document)

    # -- annotation resolution -------------------------------------------------

    def _with_effective_annotations(self, definition: Definition) -> Definition:
        resolver = _AnnotationResolver(self)
        effective, _ = resolver.resolve(definition)
        return effective

    def effective_description(self, definition: Definition, visiting: Set[str]) -> str:
        if definition.description:
            return definition.description
        reference = definition.reference
        if not reference:
            return ""
        if parse_schema_type(reference) is not None or reference in visiting:
            return ""
        target = self.types.get(reference)
        if target is None:
            return ""
        visiting.add(reference)
        try:
            return self.effective_description(target, visiting)
        finally:
            visiting.discard(reference)

    def effective_deprecated(self, definition: Definition, visiting: Set[str]) -> bool:
        if definition.deprecated:
            return True
        references = list(definition.all_of)
        if definition.reference:
            references.append(definition.reference)
        for reference in references:
            if parse_schema_type(reference) is not None or reference in visiting:
                continue
            target = self.types.get(reference)
            if target is not None:
                visiting.add(reference)
                try:
                    if self.effective_deprecated(target, visiting):
                        return True
                finally:
                    visiting.discard(reference)
        return False

    def effective_default(self, definition: Definition, visiting: Set[str]) -> Tuple[Any, bool]:
        if definition.has_default:
            return definition.default_value, True
        value: Any = None
        found = False
        references = list(definition.all_of)
        if definition.reference:
            references = [definition.reference] + references
        for reference in references:
            if parse_schema_type(reference) is not None:
                continue
            if reference in visiting:
                raise SchemaError(f"cyclic default reference: {reference}")
            target = self.types.get(reference)
            if target is None:
                continue
            visiting.add(reference)
            try:
                candidate, has_candidate = self.effective_default(target, visiting)
            finally:
                visiting.discard(reference)
            if not has_candidate:
                continue
            if found and not values_equal(value, candidate):
                raise SchemaError(f"{definition.name} has conflicting inherited defaults")
            value, found = candidate, True
        return value, found

    # -- composition/effective-kind resolution ---------------------------------

    def definition_for_reference(self, reference: str) -> Definition:
        normalized = normalize_reference(reference)
        builtin = parse_schema_type(normalized)
        if builtin is not None:
            return Definition(name=normalized, type_name=builtin)
        definition = self.types.get(normalized)
        if definition is None:
            raise SchemaError(f"unknown type reference: {reference}")
        return definition

    def effective_kind(
        self, definition: Definition, visiting: Set[str]
    ) -> Tuple[Optional[SchemaType], bool]:
        kind: Optional[SchemaType] = None
        resolved = False
        if definition.reference:
            target = self.types.get(definition.reference)
            if target is None:
                raise SchemaError(f"unknown type reference: {definition.reference}")
            if definition.reference in visiting:
                raise SchemaError(f"cyclic type reference: {definition.reference}")
            visiting.add(definition.reference)
            try:
                kind, resolved = self.effective_kind(target, visiting)
            finally:
                visiting.discard(definition.reference)
        elif definition.one_of or definition.any_of:
            alternatives = definition.one_of if definition.one_of else definition.any_of
            for reference in alternatives:
                alternative = self.definition_for_reference(reference)
                alternative_kind, ok = self.effective_kind(alternative, visiting)
                if not ok or (resolved and alternative_kind != kind):
                    resolved = False
                    kind = None
                    break
                kind, resolved = alternative_kind, True
        elif definition.condition is not None:
            for reference in (definition.then_reference, definition.else_reference):
                branch = self.definition_for_reference(reference)
                branch_kind, ok = self.effective_kind(branch, visiting)
                if not ok or (resolved and branch_kind != kind):
                    raise SchemaError("conditional branches have incompatible effective kinds")
                kind, resolved = branch_kind, True
        else:
            kind, resolved = definition.type_name, definition.type_name is not None

        if not definition.all_of:
            return kind, resolved
        for reference in definition.all_of:
            component = self.definition_for_reference(reference)
            component_kind, ok = self.effective_kind(component, visiting)
            if not ok or component_kind == SchemaType.ANY:
                raise SchemaError(f"allof component {reference} has indeterminate effective kind")
            if resolved and component_kind != kind:
                raise SchemaError(f"allof component {reference} has incompatible effective kind")
            if not resolved:
                kind, resolved = component_kind, True
        return kind, True

    def determinate_fixed_children(self, definition: Definition, visiting: Set[str]) -> Set[str]:
        fixed: Set[str] = set(definition.children.keys())
        references = list(definition.all_of)
        if definition.reference:
            references.append(definition.reference)
        for reference in references:
            target_fixed = self.determinate_reference_fixed_children(reference, visiting)
            fixed.update(target_fixed)
        return fixed

    def determinate_reference_fixed_children(
        self, reference: str, visiting: Set[str]
    ) -> Set[str]:
        if parse_schema_type(reference) is not None:
            return set()
        if reference in visiting:
            raise SchemaError(f"cyclic composition reference: {reference}")
        target = self.types.get(reference)
        if target is None:
            raise SchemaError(f"unknown type reference: {reference}")
        visiting.add(reference)
        try:
            return self.determinate_fixed_children(target, visiting)
        finally:
            visiting.discard(reference)

    def has_collection_item_constraint(self, definition: Definition, visiting: Set[str]) -> bool:
        if definition.one_of or definition.any_of or definition.condition is not None:
            return True
        if definition.item_reference:
            return True
        if definition.reference:
            target = self.types.get(definition.reference)
            if target is None:
                raise SchemaError(f"unknown type reference: {definition.reference}")
            visiting.add(definition.reference)
            try:
                if self.has_collection_item_constraint(target, visiting):
                    return True
            finally:
                visiting.discard(definition.reference)
        for reference in definition.all_of:
            if parse_schema_type(reference) is not None:
                continue
            if reference in visiting:
                raise SchemaError(f"cyclic composition reference: {reference}")
            target = self.types.get(reference)
            if target is None:
                raise SchemaError(f"unknown type reference: {reference}")
            if target.one_of or target.any_of or target.condition is not None:
                continue
            visiting.add(reference)
            try:
                found = self.has_collection_item_constraint(target, visiting)
            finally:
                visiting.discard(reference)
            if found:
                return True
        return False

    def resolve_item_kind(self, reference: str, seen: Set[str]) -> Tuple[Optional[SchemaType], bool]:
        normalized = normalize_reference(reference)
        if not normalized:
            return None, False
        builtin = parse_schema_type(normalized)
        if builtin is not None:
            return builtin, True
        if normalized in seen:
            raise SchemaError(f"cyclic type reference: {normalized}")
        definition = self.types.get(normalized)
        if definition is None:
            raise SchemaError(f"unknown type reference: {reference}")
        seen.add(normalized)
        try:
            if definition.reference:
                return self.resolve_item_kind(definition.reference, seen)
            if definition.condition is not None:
                kind: Optional[SchemaType] = None
                for candidate_reference in (definition.then_reference, definition.else_reference):
                    branch_kind, resolved = self.resolve_item_kind(candidate_reference, seen)
                    if not resolved or (kind is not None and branch_kind != kind):
                        return None, False
                    kind = branch_kind
                return kind, kind is not None
            alternatives = definition.one_of if definition.one_of else definition.any_of
            if not alternatives:
                return definition.type_name, definition.type_name is not None
            resolved_type: Optional[SchemaType] = None
            for alternative in alternatives:
                alternative_type, ok = self.resolve_item_kind(alternative, seen)
                if not ok or (resolved_type is not None and alternative_type != resolved_type):
                    return None, False
                resolved_type = alternative_type
            return resolved_type, resolved_type is not None
        finally:
            seen.discard(normalized)

    def collect_reference_types(self, reference: str, seen: Set[str], types: Set[SchemaType]) -> None:
        normalized = normalize_reference(reference)
        builtin = parse_schema_type(normalized)
        if builtin is not None:
            types.add(builtin)
            return
        if normalized in seen:
            raise SchemaError(f"cyclic type reference: {normalized}")
        definition = self.types.get(normalized)
        if definition is None:
            raise SchemaError(f"unknown type reference: {reference}")
        seen.add(normalized)
        try:
            if definition.reference:
                self.collect_reference_types(definition.reference, seen, types)
                return
            if definition.condition is not None:
                for candidate_reference in (definition.then_reference, definition.else_reference):
                    self.collect_reference_types(candidate_reference, seen, types)
                return
            alternatives = definition.one_of if definition.one_of else definition.any_of
            if not alternatives:
                if definition.type_name is not None:
                    types.add(definition.type_name)
                return
            for alternative in alternatives:
                self.collect_reference_types(alternative, seen, types)
        finally:
            seen.discard(normalized)

    # -- schema-load-time validation passes -------------------------------------

    def validate_references(self, definitions: Dict[str, Definition]) -> None:
        for definition in definitions.values():
            references = [definition.reference, definition.item_reference]
            references += list(definition.items)
            references += list(definition.one_of)
            references += list(definition.any_of)
            if definition.condition is not None:
                references += [definition.then_reference, definition.else_reference]
            references += list(definition.all_of)
            for reference in references:
                if not reference:
                    continue
                if parse_schema_type(reference) is not None:
                    continue
                if reference not in self.types:
                    raise SchemaError(f"{definition.name} contains unknown type reference: {reference}")
            self.validate_references(definition.children)

    def validate_selector_cycles(self) -> None:
        visited: Set[str] = set()
        for type_name in self.types:
            self.validate_selector_cycle(type_name, set(), visited)

    def validate_selector_cycle(self, type_name: str, visiting: Set[str], visited: Set[str]) -> None:
        if parse_schema_type(type_name) is not None or type_name in visited:
            return
        if type_name in visiting:
            raise SchemaError(f"cyclic type selector reference involving types.{type_name}")
        definition = self.types.get(type_name)
        if definition is None:
            return
        visiting.add(type_name)
        references = [definition.reference]
        references += list(definition.one_of)
        references += list(definition.any_of)
        if definition.condition is not None:
            references += [definition.then_reference, definition.else_reference]
        references += list(definition.all_of)
        for reference in references:
            if reference:
                self.validate_selector_cycle(reference, visiting, visited)
        visiting.discard(type_name)
        visited.add(type_name)

    def validate_allowed_value_types(self) -> None:
        def validate_definition(definition: Definition) -> None:
            permitted: Set[SchemaType] = set()
            if definition.allowed_values:
                if definition.type_name in (SchemaType.ARRAY, SchemaType.COLLECTION):
                    if definition.item_reference:
                        self.collect_reference_types(definition.item_reference, set(), permitted)
                elif definition.type_name is not None:
                    permitted.add(definition.type_name)
                for index, value in enumerate(definition.allowed_values):
                    matches = len(permitted) == 0
                    for candidate_type in permitted:
                        if is_type(value, candidate_type):
                            matches = True
                            break
                    if not matches:
                        raise SchemaError(
                            f"{definition.name} allowedvalues[{index}] does not match the permitted TOML type"
                        )
            for child in definition.children.values():
                validate_definition(child)

        for definitions in (self.types, self.elements):
            for definition in definitions.values():
                validate_definition(definition)

    def validate_semantics(self) -> None:
        for definitions in (self.types, self.elements):
            for definition in definitions.values():
                self.validate_definition_semantics(definition)

    def validate_definition_semantics(self, definition: Definition) -> None:
        try:
            kind, resolved = self.effective_kind(definition, set())
        except SchemaError as exc:
            raise SchemaError(f"{definition.name}: {exc}") from exc
        has_sibling_rules = bool(definition.dependent_required) or bool(
            definition.mutually_exclusive
        ) or bool(definition.exactly_one)
        if has_sibling_rules:
            if not resolved or kind not in (SchemaType.TABLE, SchemaType.COLLECTION):
                raise SchemaError(f"{definition.name} sibling rules require an effective table or collection")
            try:
                fixed = self.determinate_fixed_children(definition, set())
            except SchemaError as exc:
                raise SchemaError(f"{definition.name}: {exc}") from exc

            def check_name(property_name: str, operand: str) -> None:
                if operand not in fixed:
                    raise SchemaError(
                        f"{definition.name} {property_name} contains unknown fixed child {operand!r}"
                    )

            for trigger, dependencies in definition.dependent_required.items():
                check_name("dependentrequired", trigger)
                for dependency in dependencies:
                    check_name("dependentrequired", dependency)
            for property_name, groups in (
                ("mutuallyexclusive", definition.mutually_exclusive),
                ("exactlyone", definition.exactly_one),
            ):
                for group in groups:
                    for operand in group:
                        check_name(property_name, operand)
        if definition.unique_items is not None and (not resolved or kind != SchemaType.ARRAY):
            raise SchemaError(f"{definition.name} uniqueitems requires an effective array")
        if resolved and kind == SchemaType.COLLECTION:
            try:
                has_constraint = self.has_collection_item_constraint(definition, set())
            except SchemaError as exc:
                raise SchemaError(f"{definition.name}: {exc}") from exc
            if not has_constraint:
                raise SchemaError(f"{definition.name} effective collection must define at least one itemtype")
        if definition.condition is not None:
            if not resolved or kind not in (SchemaType.TABLE, SchemaType.COLLECTION):
                raise SchemaError(
                    f"{definition.name} conditional selector requires compatible table or collection branches"
                )
            for property_name, reference in (
                ("then", definition.then_reference),
                ("else", definition.else_reference),
            ):
                branch = self.types.get(reference)
                if branch is None:
                    raise SchemaError(
                        f"{definition.name} contains unknown type reference: {reference}"
                    )
                branch_kind, branch_resolved = self.effective_kind(branch, set())
                if branch_resolved and branch_kind == SchemaType.COLLECTION:
                    continue
                fixed = self.determinate_fixed_children(branch, set())
                if fixed and definition.condition.key not in fixed:
                    raise SchemaError(
                        f"{definition.name} {property_name} branch has a non-empty "
                        "determinate fixed-child set that omits discriminator "
                        f"{definition.condition.key!r}"
                    )
        for child in definition.children.values():
            self.validate_definition_semantics(child)

    def validate_array_ranges(self) -> None:
        def validate_definition(definition: Definition) -> None:
            if definition.type_name in (SchemaType.ARRAY, SchemaType.COLLECTION):
                has_range = definition.min is not None or definition.max is not None
                has_string_constraint = definition.pattern is not None or bool(definition.format)
                if has_range or has_string_constraint:
                    try:
                        item_type, ok = self.resolve_item_kind(definition.item_reference, set())
                    except SchemaError as exc:
                        raise SchemaError(f"{definition.name} has invalid itemtype: {exc}") from exc
                    if not ok:
                        message = (
                            "can only define min or max when itemtype resolves to one comparable built-in type"
                            if has_range
                            else "per-member constraints require a determinate itemtype"
                        )
                        raise SchemaError(f"{definition.name} {message}")
                    if has_range and not is_range_comparable(item_type):
                        raise SchemaError(
                            f"{definition.name} can only define min or max when itemtype resolves to one comparable built-in type"
                        )
                    if has_string_constraint and item_type != SchemaType.STRING:
                        raise SchemaError(
                            f"{definition.name} can only define pattern or format when itemtype resolves to string"
                        )
                    if has_range:
                        _validate_boundary_matches_type(
                            definition.name, "min", definition.min, item_type
                        )
                        _validate_boundary_matches_type(
                            definition.name, "max", definition.max, item_type
                        )
                        _validate_ordered_range(
                            definition.name, definition.min, definition.max, item_type
                        )
                self.validate_duplicate_member_constraints(definition)
            for child in definition.children.values():
                validate_definition(child)

        for definitions in (self.types, self.elements):
            for definition in definitions.values():
                validate_definition(definition)

    def validate_duplicate_member_constraints(self, definition: Definition) -> None:
        if not definition.item_reference:
            return
        constraints = (
            ("allowedvalues", bool(definition.allowed_values)),
            ("min", definition.min is not None),
            ("max", definition.max is not None),
            ("pattern", definition.pattern is not None),
            ("format", bool(definition.format)),
        )
        for property_name, present in constraints:
            if present and self.reference_has_constraint(
                definition.item_reference, property_name, set()
            ):
                raise SchemaError(
                    f"{definition.name} defines {property_name} both inline and on its resolved itemtype"
                )

    def reference_has_constraint(
        self,
        reference: str,
        property_name: str,
        visiting: Set[str],
    ) -> bool:
        if parse_schema_type(reference) is not None:
            return False
        if reference in visiting:
            raise SchemaError(f"cyclic type reference: {reference}")
        definition = self.types.get(reference)
        if definition is None:
            raise SchemaError(f"unknown type reference: {reference}")
        visiting.add(reference)
        try:
            local = {
                "allowedvalues": bool(definition.allowed_values),
                "min": definition.min is not None,
                "max": definition.max is not None,
                "pattern": definition.pattern is not None,
                "format": bool(definition.format),
            }[property_name]
            if local:
                return True
            references = list(definition.one_of + definition.any_of)
            if definition.reference:
                references.append(definition.reference)
            if definition.condition is not None:
                references.extend((definition.then_reference, definition.else_reference))
            return any(
                self.reference_has_constraint(nested, property_name, visiting)
                for nested in references
            )
        finally:
            visiting.discard(reference)

    def validate_defaults(self) -> None:
        def validate_definition(definition: Definition) -> None:
            value, has_default = self.effective_default(definition, set())
            if has_default:
                candidate = Validator(self, suppress_warnings=True)
                candidate.validate_value(definition.name, value, definition)
                if candidate.errors:
                    raise SchemaError(f"{definition.name} default is invalid: {candidate.errors[0].message}")
            for child in definition.children.values():
                validate_definition(child)

        for definitions in (self.types, self.elements):
            for definition in definitions.values():
                validate_definition(definition)


class _AnnotationResolver:
    """Materializes effective annotations (default/deprecated/description and
    reference-merged children) for a definition tree.

    Schemas may legally recurse through child definitions that reference an
    enclosing named type, so resolution is guarded against re-entering a
    definition it is already expanding and memoizes fully expanded results --
    mirrors Go's ``annotationResolver``.
    """

    def __init__(self, schema: Schema) -> None:
        self.schema = schema
        self.visiting: Set[str] = set()
        self.resolved: Dict[str, Definition] = {}

    def resolve(self, definition: Definition) -> Tuple[Definition, bool]:
        key = definition.name + "\x00" + definition.reference
        if key in self.resolved:
            return self.resolved[key], True
        effective = self._annotate(definition)
        if key in self.visiting:
            return effective, False
        self.visiting.add(key)
        try:
            complete = True
            children: Dict[str, Definition] = {}
            for name, child in effective.children.items():
                resolved_child, child_complete = self.resolve(child)
                complete = complete and child_complete
                children[name] = resolved_child
            effective = dataclasses.replace(effective, children=children)
            if complete:
                self.resolved[key] = effective
            return effective, complete
        finally:
            self.visiting.discard(key)

    def _annotate(self, definition: Definition) -> Definition:
        original = definition
        try:
            resolved = Validator(self.schema).resolve(definition, set())
            definition = resolved
        except SchemaError:
            pass
        try:
            value, has_value = self.schema.effective_default(original, set())
        except SchemaError:
            has_value = False
            value = None
        if has_value:
            definition = dataclasses.replace(definition, default_value=value, has_default=True)
        deprecated = self.schema.effective_deprecated(original, set())
        definition = dataclasses.replace(definition, deprecated=deprecated)
        if not definition.description:
            description = self.schema.effective_description(original, set())
            if description:
                definition = dataclasses.replace(definition, description=description)
        return definition


_PLAIN_ROOT_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _encode_root_key(key: str) -> str:
    if key and _PLAIN_ROOT_KEY_RE.match(key):
        return key
    import json

    return json.dumps(key)


def load_schema(path: str) -> Schema:
    """Loads and fully validates a ``.tosd`` schema document.

    Raises :class:`toml_schema.SchemaError` if the schema is structurally or
    semantically invalid.
    """
    try:
        with open(path, "rb") as handle:
            content_bytes = handle.read()
    except OSError as exc:
        raise SchemaError(f"unable to parse schema {path}: {exc}") from exc
    try:
        content_text = content_bytes.decode("utf-8")
        parsed = tomllib.loads(content_text)
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        raise SchemaError(f"unable to parse schema {path}: {exc}") from exc

    source = SchemaSource(content_text)

    metadata = parsed.get("toml-schema")
    if not isinstance(metadata, dict):
        raise SchemaError("schema must contain a [toml-schema] table")
    if not isinstance(parsed.get("elements"), dict):
        raise SchemaError("schema must contain an [elements] table")
    for key in parsed:
        if key not in ("toml-schema", "types", "elements"):
            raise SchemaError(f"unsupported top-level schema key: {key}")
    if "version" not in metadata:
        raise SchemaError("[toml-schema] must contain version")
    version = metadata["version"]
    validate_schema_version(version)
    for key in metadata:
        if key not in ("version", "meta"):
            raise SchemaError(f"unsupported [toml-schema] key: {key}")

    types = parse_definitions("types", parsed.get("types"), False, source)
    elements = parse_definitions("elements", parsed.get("elements"), True, source)

    schema = Schema(source=str(path), version=version, types=types, elements=elements)
    schema.validate_references(types)
    schema.validate_references(elements)
    schema.validate_selector_cycles()
    schema.validate_allowed_value_types()
    schema.validate_semantics()
    schema.validate_array_ranges()
    schema.validate_defaults()
    return schema
