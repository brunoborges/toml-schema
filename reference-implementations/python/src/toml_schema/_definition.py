"""The Definition and Condition data model for a parsed schema node."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Pattern, Tuple

from ._types import SchemaType


@dataclass
class Condition:
    """An ``if`` selector: ``{ key = ..., equals = ... }`` or
    ``{ key = ..., in = [...] }``."""

    key: str
    has_equals: bool
    equals: Any = None
    in_values: Tuple[Any, ...] = ()


@dataclass
class Definition:
    """A single parsed schema definition node (a ``[types.*]`` or
    ``[elements.*]`` entry, or one of its nested child definitions).

    Public accessors mirror the other reference implementations:
    ``description``, ``deprecated``, ``default()``, and ``child(name)``.
    Internal validator state (references, constraints, sibling rules) is
    consumed by the schema/validator modules within this package.
    """

    name: str
    type_name: Optional[SchemaType] = None
    reference: str = ""
    description: str = ""
    item_reference: str = ""
    items: Tuple[str, ...] = ()
    optional: bool = False
    allowed_values: Tuple[Any, ...] = ()
    pattern: Optional[Pattern[str]] = None
    format: str = ""
    key_pattern: Optional[Pattern[str]] = None
    min: Any = None
    max: Any = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    one_of: Tuple[str, ...] = ()
    any_of: Tuple[str, ...] = ()
    condition: Optional[Condition] = None
    then_reference: str = ""
    else_reference: str = ""
    all_of: Tuple[str, ...] = ()
    dependent_required: Dict[str, Tuple[str, ...]] = field(default_factory=dict)
    mutually_exclusive: Tuple[Tuple[str, ...], ...] = ()
    exactly_one: Tuple[Tuple[str, ...], ...] = ()
    unique_items: Optional[bool] = None
    default_value: Any = None
    has_default: bool = False
    deprecated: bool = False
    has_deprecated: bool = False
    children: Dict[str, "Definition"] = field(default_factory=dict)

    def default(self) -> Tuple[Any, bool]:
        """Returns the effective, non-materializing default annotation as
        ``(value, has_default)``."""
        return self.default_value, self.has_default

    def child(self, name: str) -> Optional["Definition"]:
        return self.children.get(name)

    def child_names(self) -> List[str]:
        return list(self.children.keys())
