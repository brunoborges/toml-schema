"""TOML-aware value comparison, equality, and type-name helpers.

These utilities implement TOML Schema's numeric-precision-preserving
comparisons and its "TOML equality" semantics for allowedvalues,
uniqueitems, and conditional selectors. They intentionally avoid comparing
values through Python's native ``==``/``<`` operators for datetimes, because
``datetime.datetime`` equality and ordering for timezone-aware values compare
*instants*, while TOML Schema's allowedvalues/uniqueitems equality compares
*literal* representations (same offset, same local time).
"""

from __future__ import annotations

import datetime as _dt
import math
from fractions import Fraction
from typing import Any

from ._types import SchemaType

_RANGE_COMPARABLE = {
    SchemaType.INTEGER,
    SchemaType.FLOAT,
    SchemaType.OFFSET_DATE_TIME,
    SchemaType.LOCAL_DATE_TIME,
    SchemaType.LOCAL_DATE,
    SchemaType.LOCAL_TIME,
}


def is_range_comparable(type_name: SchemaType) -> bool:
    return type_name in _RANGE_COMPARABLE


def is_numeric(value: Any) -> bool:
    """True for TOML integer/float values. Booleans are never numeric."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_nan(value: Any) -> bool:
    return isinstance(value, float) and math.isnan(value)


def is_infinite(value: Any) -> bool:
    return isinstance(value, float) and math.isinf(value)


def is_offset_date_time(value: Any) -> bool:
    return isinstance(value, _dt.datetime) and value.tzinfo is not None


def is_local_date_time(value: Any) -> bool:
    return isinstance(value, _dt.datetime) and value.tzinfo is None


def is_local_date(value: Any) -> bool:
    return isinstance(value, _dt.date) and not isinstance(value, _dt.datetime)


def is_local_time(value: Any) -> bool:
    return isinstance(value, _dt.time)


def type_name_of(value: Any) -> str:
    if isinstance(value, str):
        return "string"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    if is_offset_date_time(value):
        return "offset-date-time"
    if is_local_date_time(value):
        return "local-date-time"
    if is_local_date(value):
        return "local-date"
    if is_local_time(value):
        return "local-time"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "table"
    return type(value).__name__


def is_type(value: Any, type_name: SchemaType) -> bool:
    if type_name == SchemaType.ANY:
        return True
    if type_name == SchemaType.STRING:
        return isinstance(value, str)
    if type_name == SchemaType.INTEGER:
        return isinstance(value, int) and not isinstance(value, bool)
    if type_name == SchemaType.FLOAT:
        return isinstance(value, float)
    if type_name == SchemaType.BOOLEAN:
        return isinstance(value, bool)
    if type_name == SchemaType.OFFSET_DATE_TIME:
        return is_offset_date_time(value)
    if type_name == SchemaType.LOCAL_DATE_TIME:
        return is_local_date_time(value)
    if type_name == SchemaType.LOCAL_DATE:
        return is_local_date(value)
    if type_name == SchemaType.LOCAL_TIME:
        return is_local_time(value)
    if type_name == SchemaType.ARRAY:
        return isinstance(value, list)
    if type_name in (SchemaType.TABLE, SchemaType.COLLECTION):
        return isinstance(value, dict)
    return False


class IncomparableError(ValueError):
    """Raised when two values cannot be ordered against each other."""


def _numeric_rat(value: Any) -> Fraction:
    if isinstance(value, int):
        return Fraction(value)
    return Fraction(value)  # exact binary value of the float


def compare_numbers(left: Any, right: Any) -> int:
    if is_nan(left) or is_nan(right):
        raise IncomparableError("NaN is unordered")
    if isinstance(left, int) and isinstance(right, int):
        return (left > right) - (left < right)
    left_is_float = isinstance(left, float)
    right_is_float = isinstance(right, float)
    if (left_is_float and math.isinf(left)) or (right_is_float and math.isinf(right)):
        left_f = float(left)
        right_f = float(right)
        return (left_f > right_f) - (left_f < right_f)
    left_rat = _numeric_rat(left)
    right_rat = _numeric_rat(right)
    return (left_rat > right_rat) - (left_rat < right_rat)


def compare(value: Any, boundary: Any) -> int:
    """Compares a value with a min/max boundary of a compatible kind.

    Raises IncomparableError when the two values cannot be compared.
    """
    if is_numeric(value) and is_numeric(boundary):
        return compare_numbers(value, boundary)
    if is_offset_date_time(value) and is_offset_date_time(boundary):
        return (value > boundary) - (value < boundary)
    if is_local_date_time(value) and is_local_date_time(boundary):
        return (value > boundary) - (value < boundary)
    if is_local_date(value) and is_local_date(boundary):
        return (value > boundary) - (value < boundary)
    if is_local_time(value) and is_local_time(boundary):
        return (value > boundary) - (value < boundary)
    raise IncomparableError(
        f"cannot compare {type_name_of(value)} with boundary {type_name_of(boundary)}"
    )


def _offset_date_times_equal(left: _dt.datetime, right: _dt.datetime) -> bool:
    return (
        left.year == right.year
        and left.month == right.month
        and left.day == right.day
        and left.hour == right.hour
        and left.minute == right.minute
        and left.second == right.second
        and left.microsecond == right.microsecond
        and left.utcoffset() == right.utcoffset()
    )


def values_equal(allowed: Any, value: Any) -> bool:
    """TOML equality: literal representation equality, not instant equality."""
    if is_numeric(allowed) and is_numeric(value):
        if is_nan(allowed) or is_nan(value):
            return is_nan(allowed) and is_nan(value)
        try:
            return compare_numbers(allowed, value) == 0
        except IncomparableError:
            return False
    if isinstance(allowed, bool) or isinstance(value, bool):
        return isinstance(allowed, bool) and isinstance(value, bool) and allowed == value
    if isinstance(allowed, str):
        return isinstance(value, str) and allowed == value
    if is_offset_date_time(allowed):
        return is_offset_date_time(value) and _offset_date_times_equal(allowed, value)
    if is_local_date_time(allowed):
        return is_local_date_time(value) and allowed == value
    if is_local_date(allowed):
        return is_local_date(value) and allowed == value
    if is_local_time(allowed):
        return is_local_time(value) and allowed == value
    if isinstance(allowed, list):
        if not isinstance(value, list) or len(allowed) != len(value):
            return False
        return all(values_equal(a, b) for a, b in zip(allowed, value))
    if isinstance(allowed, dict):
        if not isinstance(value, dict) or len(allowed) != len(value):
            return False
        for key, allowed_value in allowed.items():
            if key not in value or not values_equal(allowed_value, value[key]):
                return False
        return True
    return allowed is None and value is None
