"""The document validator: applies a resolved Definition tree to a parsed TOML
document and produces structured errors/warnings.

This mirrors the Go ``validator`` type in ``schema.go`` closely, including its
reference-resolution/merge semantics (``resolve``/``resolve_reference``) and
its composed table/collection validation for ``allof`` (structural + union +
conditional contributors).
"""

from __future__ import annotations

import dataclasses
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from ._compare import IncomparableError, compare, is_type, type_name_of, values_equal
from ._definition import Condition, Definition
from ._errors import SchemaError
from ._formats import matches_format
from ._codes import (
    ALLOWEDVALUES,
    ANYOF,
    DEPENDENTREQUIRED,
    DEPRECATED,
    EXACTLYONE,
    FORMAT,
    INCOMPATIBLE_COMPOSITION,
    KEYPATTERN,
    MAX,
    MAXLENGTH,
    MIN,
    MINLENGTH,
    MISSING_REQUIRED,
    MUTUALLYEXCLUSIVE,
    ONEOF,
    PATTERN,
    SCHEMA_MALFORMED,
    TUPLE_LENGTH,
    TYPE_MISMATCH,
    UNIQUEITEMS,
    UNKNOWN_KEY,
)
from ._types import (
    Diagnostic,
    Phase,
    Severity,
    SchemaType,
    normalize_reference,
    parse_schema_type,
)

_PLAIN_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _encode_path_key(key: str) -> str:
    if key and _PLAIN_KEY_RE.match(key):
        return key
    parts = ['"']
    for char in key:
        code = ord(char)
        if char == '"':
            parts.append('\\"')
        elif char == "\\":
            parts.append("\\\\")
        elif code == 0x08:
            parts.append("\\b")
        elif code == 0x09:
            parts.append("\\t")
        elif code == 0x0A:
            parts.append("\\n")
        elif code == 0x0C:
            parts.append("\\f")
        elif code == 0x0D:
            parts.append("\\r")
        elif code <= 0x1F:
            parts.append("\\u%04x" % code)
        else:
            parts.append(char)
    parts.append('"')
    return "".join(parts)


def append_path(path: str, key: str) -> str:
    return f"{path}.{_encode_path_key(key)}"


def _condition_matches(table: dict, condition: Condition) -> bool:
    if condition.key not in table:
        return False
    value = table[condition.key]
    if condition.has_equals:
        return values_equal(condition.equals, value)
    return any(values_equal(candidate, value) for candidate in condition.in_values)


def _merge_dependencies(
    left: Dict[str, Tuple[str, ...]], right: Dict[str, Tuple[str, ...]]
) -> Dict[str, Tuple[str, ...]]:
    if not left and not right:
        return {}
    merged: Dict[str, Tuple[str, ...]] = {}
    for trigger, dependencies in left.items():
        merged[trigger] = merged.get(trigger, ()) + tuple(dependencies)
    for trigger, dependencies in right.items():
        merged[trigger] = merged.get(trigger, ()) + tuple(dependencies)
    return merged


def _present_group_members(table: dict, group: Tuple[str, ...]) -> List[str]:
    return [name for name in group if name in table]


@dataclass
class CompositionParts:
    structural: List[Definition] = field(default_factory=list)
    unions: List[Definition] = field(default_factory=list)
    conditionals: List[Definition] = field(default_factory=list)


class Validator:
    """A single validation pass. Instances are cheap and disposable: unions,
    allof alternatives, and default validation each run against isolated
    sub-validators so a failed branch's diagnostics never leak into the
    aggregate result."""

    def __init__(self, schema: Any, suppress_warnings: bool = False) -> None:
        self.schema = schema
        self.errors: List[Diagnostic] = []
        self.warnings: List[Diagnostic] = []
        self.suppress_warnings = suppress_warnings

    # -- table/value dispatch -------------------------------------------------

    def validate_table(self, path: str, table: dict, definitions: Dict[str, Definition]) -> None:
        for key, definition in definitions.items():
            try:
                resolved = self.resolve(definition, set())
            except SchemaError as exc:
                self.add_exc(append_path(path, key), exc)
                continue
            child_path = append_path(path, key)
            if key not in table:
                if not resolved.optional:
                    self.add(
                        MISSING_REQUIRED, child_path, self._sp(definition), "required value is missing"
                    )
                continue
            self.validate_value(child_path, table[key], resolved)

    def validate_value(self, path: str, value: Any, definition: Definition) -> None:
        candidate = Validator(self.schema, suppress_warnings=self.suppress_warnings)
        candidate._validate_value_internal(path, value, definition)
        self.errors.extend(candidate.errors)
        if not candidate.errors:
            self.append_warnings(candidate.warnings)

    def _validate_value_internal(self, path: str, value: Any, definition: Definition) -> None:
        try:
            resolved = self.resolve(definition, set())
        except SchemaError as exc:
            self.add_exc(path, exc)
            return
        if resolved.condition is not None:
            self.validate_conditional(path, value, resolved)
        elif resolved.one_of or resolved.any_of:
            self.validate_union(path, value, resolved)
        elif resolved.all_of:
            self.validate_all_of(path, value, resolved)
        else:
            self.validate_plain_value(path, value, resolved)
        if not self.errors and resolved.deprecated:
            self.warn(DEPRECATED, path, self._sp(resolved, "deprecated"), "value is deprecated")

    def validate_conditional(self, path: str, value: Any, definition: Definition) -> None:
        reference = definition.else_reference
        if isinstance(value, dict) and _condition_matches(value, definition.condition):
            reference = definition.then_reference
        try:
            branch = self.resolve_reference(reference, set())
        except SchemaError as exc:
            self.add_exc(path, exc)
            return
        branch = dataclasses.replace(branch, all_of=branch.all_of + definition.all_of)
        self.validate_value(path, value, branch)

    def validate_plain_value(self, path: str, value: Any, definition: Definition) -> None:
        type_name = definition.type_name if definition.type_name is not None else SchemaType.ANY
        self.validate_type(path, value, type_name, self._sp(definition, "type"))
        if not is_type(value, type_name):
            return
        self.validate_common_constraints(path, value, definition)
        if type_name == SchemaType.TABLE:
            self.validate_table_value(path, value, definition)
        elif type_name == SchemaType.COLLECTION:
            self.validate_collection(path, value, definition)
        elif type_name == SchemaType.ARRAY:
            self.validate_array(path, value, definition)

    def validate_union(self, path: str, value: Any, definition: Definition) -> None:
        alternatives = definition.one_of if definition.one_of else definition.any_of
        matches = 0
        successes: List[Validator] = []
        for reference in alternatives:
            try:
                referenced = self.resolve_reference(reference, set())
            except SchemaError as exc:
                self.add_exc(path, exc)
                return
            referenced = dataclasses.replace(
                referenced,
                all_of=referenced.all_of + definition.all_of,
                dependent_required=_merge_dependencies(
                    referenced.dependent_required, definition.dependent_required
                ),
                mutually_exclusive=referenced.mutually_exclusive + definition.mutually_exclusive,
                exactly_one=referenced.exactly_one + definition.exactly_one,
                unique_items=(
                    definition.unique_items
                    if definition.unique_items is not None
                    else referenced.unique_items
                ),
            )
            candidate = Validator(self.schema, suppress_warnings=self.suppress_warnings)
            candidate.validate_value(path, value, referenced)
            if not candidate.errors:
                matches += 1
                successes.append(candidate)
        if definition.one_of and matches != 1:
            self.add(
                ONEOF,
                path,
                self._sp(definition, "oneof"),
                f"expected exactly one matching type from oneof but found {matches}",
            )
        elif definition.one_of:
            self.append_warnings(successes[0].warnings)
        if definition.any_of and matches == 0:
            self.add(
                ANYOF,
                path,
                self._sp(definition, "anyof"),
                "expected at least one matching type from anyof",
            )
        elif definition.any_of:
            for candidate in successes:
                self.append_warnings(candidate.warnings)

    def validate_all_of(self, path: str, value: Any, definition: Definition) -> None:
        try:
            kind, resolved = self.schema.effective_kind(definition, set())
        except SchemaError as exc:
            self.add_exc(path, exc)
            return
        if not resolved:
            self.add(
                INCOMPATIBLE_COMPOSITION,
                path,
                self._sp(definition, "allof"),
                "allof has no determinate effective kind",
            )
            return
        if kind in (SchemaType.TABLE, SchemaType.COLLECTION):
            if (
                definition.type_name is None
                and not definition.reference
                and not definition.one_of
                and not definition.any_of
                and definition.condition is None
            ):
                definition = dataclasses.replace(definition, type_name=kind)
            self.validate_composed_structure(path, value, kind, definition, None)
            return
        local = dataclasses.replace(definition, all_of=())
        self.validate_plain_value(path, value, local)
        for reference in definition.all_of:
            try:
                component = self.resolve_reference(reference, set())
            except SchemaError as exc:
                self.add_exc(path, exc)
                continue
            self.validate_value(path, value, component)

    # -- composition (allof over table/collection) ---------------------------

    def composition_parts(self, definition: Definition, visiting: Set[str]) -> CompositionParts:
        resolved = self.resolve(definition, set())
        references = list(resolved.all_of)
        resolved = dataclasses.replace(resolved, all_of=())
        parts = CompositionParts()
        if resolved.condition is not None:
            parts.conditionals.append(resolved)
        elif resolved.one_of or resolved.any_of:
            parts.unions.append(resolved)
        else:
            parts.structural.append(resolved)
        for reference in references:
            if reference in visiting:
                raise SchemaError(f"cyclic composition reference: {reference}")
            visiting.add(reference)
            try:
                component = self.resolve_reference(reference, set())
                nested = self.composition_parts(component, visiting)
            finally:
                visiting.discard(reference)
            parts.structural.extend(nested.structural)
            parts.unions.extend(nested.unions)
            parts.conditionals.extend(nested.conditionals)
        return parts

    def validate_composed_structure(
        self,
        path: str,
        value: Any,
        kind: SchemaType,
        definition: Definition,
        inherited_keys: Optional[Set[str]],
    ) -> None:
        try:
            parts = self.composition_parts(definition, set())
        except SchemaError as exc:
            self.add_exc(path, exc)
            return
        self.validate_composed_parts(path, value, kind, parts, inherited_keys)

    def validate_composed_parts(
        self,
        path: str,
        value: Any,
        kind: SchemaType,
        parts: CompositionParts,
        inherited_keys: Optional[Set[str]],
    ) -> None:
        if not isinstance(value, dict):
            self.validate_type(path, value, kind)
            return
        table = value
        children: Dict[str, List[Definition]] = {}
        has_fixed_structure = bool(inherited_keys)
        for component in parts.structural:
            if component.type_name != kind:
                self.add(
                    TYPE_MISMATCH,
                    path,
                    self._sp(component, "type"),
                    f"expected {kind} component but found {component.type_name}",
                )
                continue
            if component.children:
                has_fixed_structure = True
            for name, child in component.children.items():
                children.setdefault(name, []).append(child)
        known_keys: Set[str] = set(inherited_keys) if inherited_keys else set()
        known_keys.update(children.keys())
        unions: List[Definition] = []
        union_keys: List[Set[str]] = []
        for union in parts.unions:
            try:
                alternative_keys = self.effective_closure_keys(union, value, set())
            except SchemaError as exc:
                self.add_exc(path, exc)
                continue
            if alternative_keys:
                has_fixed_structure = True
            known_keys.update(alternative_keys)
            unions.append(union)
            union_keys.append(alternative_keys)
        conditionals: List[Definition] = []
        conditional_keys: List[Set[str]] = []
        for conditional in parts.conditionals:
            try:
                branch_keys = self.effective_closure_keys(conditional, value, set())
            except SchemaError as exc:
                self.add_exc(path, exc)
                continue
            if branch_keys:
                has_fixed_structure = True
            known_keys.update(branch_keys)
            conditionals.append(conditional)
            conditional_keys.append(branch_keys)
        selector_keys: List[Set[str]] = union_keys + conditional_keys
        for name, definitions in children.items():
            child_path = append_path(path, name)
            present = name in table
            child_value = table.get(name)
            for child in definitions:
                try:
                    resolved = self.resolve(child, set())
                except SchemaError as exc:
                    self.add_exc(child_path, exc)
                    continue
                if not present:
                    if not resolved.optional:
                        self.add(
                            MISSING_REQUIRED, child_path, self._sp(child), "required value is missing"
                        )
                    continue
                self.validate_value(child_path, child_value, child)
        for index, union in enumerate(unions):
            branch_keys: Set[str] = set(inherited_keys) if inherited_keys else set()
            branch_keys.update(children.keys())
            for other_index, keys in enumerate(selector_keys):
                if other_index == index:
                    continue
                branch_keys.update(keys)
            self.validate_composed_union(path, value, kind, union, branch_keys)
        for index, conditional in enumerate(conditionals):
            branch_keys = set(inherited_keys) if inherited_keys else set()
            branch_keys.update(children.keys())
            selector_index = len(unions) + index
            for other_index, keys in enumerate(selector_keys):
                if other_index == selector_index:
                    continue
                branch_keys.update(keys)
            self.validate_composed_conditional(path, value, kind, conditional, branch_keys)
        for component in parts.structural:
            self.validate_sibling_rules(path, table, component)
        for union in unions:
            self.validate_sibling_rules(path, table, union)
        closed_sp = self._sp(parts.structural[0]) if parts.structural else None
        if kind == SchemaType.TABLE:
            if has_fixed_structure:
                for key in table:
                    if key not in known_keys:
                        self.add(UNKNOWN_KEY, append_path(path, key), closed_sp, "unexpected key")
        else:
            for component in parts.structural:
                dynamic_entries = 0
                for key, entry in table.items():
                    if key in known_keys:
                        continue
                    dynamic_entries += 1
                    child_path = append_path(path, key)
                    if component.key_pattern is not None and not component.key_pattern.search(key):
                        self.add(
                            KEYPATTERN,
                            child_path,
                            self._sp(component, "keypattern"),
                            f"key does not match keypattern {component.key_pattern.pattern}",
                        )
                    self.validate_member_value_constraints(child_path, entry, component)
                    if not component.item_reference:
                        continue
                    try:
                        item = self.resolve_reference(component.item_reference, set())
                    except SchemaError as exc:
                        self.add_exc(child_path, exc)
                    else:
                        self.validate_value(child_path, entry, item)
                self.validate_length(path, dynamic_entries, component)
        for component in parts.structural:
            if component.deprecated:
                self.warn(DEPRECATED, path, self._sp(component, "deprecated"), "value is deprecated")
        for union in unions:
            if union.deprecated:
                self.warn(DEPRECATED, path, self._sp(union, "deprecated"), "value is deprecated")
        for conditional in conditionals:
            if conditional.deprecated:
                self.warn(
                    DEPRECATED, path, self._sp(conditional, "deprecated"), "value is deprecated"
                )

    def effective_closure_keys(
        self, definition: Definition, value: Any, visiting: Set[str]
    ) -> Set[str]:
        keys = set(definition.children.keys())

        def merge_reference(reference: str) -> None:
            if parse_schema_type(reference) is not None:
                return
            if reference in visiting:
                raise SchemaError(f"cyclic composition reference: {reference}")
            visiting.add(reference)
            try:
                target = self.resolve_reference(reference, set())
                keys.update(self.effective_closure_keys(target, value, visiting))
            finally:
                visiting.discard(reference)

        if definition.reference:
            merge_reference(definition.reference)
        for reference in definition.all_of:
            merge_reference(reference)
        alternatives = definition.one_of if definition.one_of else definition.any_of
        for reference in alternatives:
            merge_reference(reference)
        if definition.condition is not None:
            reference = definition.else_reference
            if isinstance(value, dict) and _condition_matches(value, definition.condition):
                reference = definition.then_reference
            merge_reference(reference)
        return keys

    def validate_composed_union(
        self,
        path: str,
        value: Any,
        kind: SchemaType,
        definition: Definition,
        known_keys: Set[str],
    ) -> None:
        alternatives = definition.one_of if definition.one_of else definition.any_of
        matches = 0
        successes: List[Validator] = []
        for reference in alternatives:
            try:
                alternative = self.resolve_reference(reference, set())
            except SchemaError as exc:
                self.add_exc(path, exc)
                return
            candidate = Validator(self.schema, suppress_warnings=self.suppress_warnings)
            try:
                alternative_kind, resolved = self.schema.effective_kind(alternative, set())
            except SchemaError as exc:
                candidate.add_exc(path, exc)
            else:
                if not resolved or alternative_kind != kind:
                    candidate.add(
                        TYPE_MISMATCH,
                        path,
                        self._sp(alternative, "type"),
                        f"expected {kind} alternative but found {alternative_kind}",
                    )
                else:
                    candidate.validate_composed_structure(path, value, kind, alternative, known_keys)
            if not candidate.errors:
                matches += 1
                successes.append(candidate)
        if definition.one_of:
            if matches != 1:
                self.add(
                    ONEOF,
                    path,
                    self._sp(definition, "oneof"),
                    f"expected exactly one matching type from oneof but found {matches}",
                )
                return
            self.append_warnings(successes[0].warnings)
            return
        if matches == 0:
            self.add(
                ANYOF,
                path,
                self._sp(definition, "anyof"),
                "expected at least one matching type from anyof",
            )
            return
        for candidate in successes:
            self.append_warnings(candidate.warnings)

    def validate_composed_conditional(
        self,
        path: str,
        value: Any,
        kind: SchemaType,
        definition: Definition,
        known_keys: Set[str],
    ) -> None:
        reference = definition.else_reference
        if isinstance(value, dict) and _condition_matches(value, definition.condition):
            reference = definition.then_reference
        try:
            branch = self.resolve_reference(reference, set())
        except SchemaError as exc:
            self.add_exc(path, exc)
            return
        try:
            branch_kind, resolved = self.schema.effective_kind(branch, set())
        except SchemaError as exc:
            self.add_exc(path, exc)
            return
        if not resolved or branch_kind != kind:
            self.add(
                TYPE_MISMATCH,
                path,
                self._sp(branch, "type"),
                f"expected {kind} conditional branch but found {branch_kind}",
            )
            return
        self.validate_composed_structure(path, value, kind, branch, known_keys)

    # -- plain table/collection/array validation ------------------------------

    def validate_table_value(self, path: str, table: dict, definition: Definition) -> None:
        if not definition.children:
            return
        self.validate_table(path, table, definition.children)
        for key in table:
            if key not in definition.children:
                self.add(UNKNOWN_KEY, append_path(path, key), self._sp(definition), "unexpected key")
        self.validate_sibling_rules(path, table, definition)

    def validate_collection(self, path: str, table: dict, definition: Definition) -> None:
        dynamic_entries = 0
        for key, value in table.items():
            child_path = append_path(path, key)
            fixed_child = definition.children.get(key)
            if fixed_child is not None:
                self.validate_value(child_path, value, fixed_child)
                continue
            dynamic_entries += 1
            if definition.key_pattern is not None and not definition.key_pattern.search(key):
                self.add(
                    KEYPATTERN,
                    child_path,
                    self._sp(definition, "keypattern"),
                    f"key does not match keypattern {definition.key_pattern.pattern}",
                )
            if not definition.item_reference:
                self.add(
                    SCHEMA_MALFORMED,
                    child_path,
                    self._sp(definition),
                    "collection entry has no itemtype reference",
                )
                continue
            try:
                referenced = self.resolve_reference(definition.item_reference, set())
            except SchemaError as exc:
                self.add_exc(child_path, exc)
                continue
            self.validate_value(child_path, value, referenced)
            self.validate_member_value_constraints(child_path, value, definition)
        self.validate_length(path, dynamic_entries, definition)
        for key, child in definition.children.items():
            try:
                resolved = self.resolve(child, set())
            except SchemaError as exc:
                self.add_exc(append_path(path, key), exc)
                continue
            if key not in table and not resolved.optional:
                self.add(
                    MISSING_REQUIRED,
                    append_path(path, key),
                    self._sp(child),
                    "required value is missing",
                )
        self.validate_sibling_rules(path, table, definition)

    def validate_array(self, path: str, array: list, definition: Definition) -> None:
        self.validate_length(path, len(array), definition)
        if definition.unique_items:
            for index in range(len(array)):
                for previous in range(index):
                    if values_equal(array[previous], array[index]):
                        self.add(
                            UNIQUEITEMS,
                            f"{path}[{index}]",
                            self._sp(definition, "uniqueitems"),
                            f"duplicate item equals item at index {previous}",
                        )
                        break
        if definition.items:
            self.validate_tuple_array(path, array, definition)
            return
        if not definition.item_reference:
            if not definition.allowed_values:
                return
            for i, item in enumerate(array):
                self.validate_allowed_values(f"{path}[{i}]", item, definition)
            return
        try:
            item_definition = self.resolve_reference(definition.item_reference, set())
        except SchemaError as exc:
            self.add_exc(path, exc)
            return
        for i, item in enumerate(array):
            item_path = f"{path}[{i}]"
            self.validate_value(item_path, item, item_definition)
            self.validate_member_value_constraints(item_path, item, definition)

    def validate_sibling_rules(self, path: str, table: dict, definition: Definition) -> None:
        # dependentrequired is evaluated on direct presence only: a mapping
        # whose trigger is absent never fires.
        for trigger, dependencies in definition.dependent_required.items():
            if trigger not in table:
                continue
            for dependency in dependencies:
                if dependency not in table:
                    self.add(
                        DEPENDENTREQUIRED,
                        append_path(path, dependency),
                        self._sp(definition, "dependentrequired"),
                        f'required by dependentrequired triggered by sibling "{trigger}"',
                    )
        for group in definition.mutually_exclusive:
            present = _present_group_members(table, group)
            if len(present) > 1:
                self.add(
                    MUTUALLYEXCLUSIVE,
                    path,
                    self._sp(definition, "mutuallyexclusive"),
                    "mutuallyexclusive group has multiple present members: " + ", ".join(present),
                )
        for group in definition.exactly_one:
            present = _present_group_members(table, group)
            if len(present) != 1:
                self.add(
                    EXACTLYONE,
                    path,
                    self._sp(definition, "exactlyone"),
                    "exactlyone group requires exactly one present member from: " + ", ".join(group),
                )

    def validate_tuple_array(self, path: str, array: list, definition: Definition) -> None:
        if len(array) != len(definition.items):
            self.add(
                TUPLE_LENGTH,
                path,
                self._sp(definition, "items"),
                f"expected array length {len(definition.items)} but found {len(array)}",
            )
        upper_bound = min(len(array), len(definition.items))
        for i in range(upper_bound):
            item_path = f"{path}[{i}]"
            try:
                item_definition = self.resolve_reference(definition.items[i], set())
            except SchemaError as exc:
                self.add_exc(item_path, exc)
                continue
            self.validate_value(item_path, array[i], item_definition)

    # -- scalar/common constraint validation -----------------------------------

    def validate_type(
        self, path: str, value: Any, type_name: SchemaType, schema_path: Optional[str] = None
    ) -> None:
        if not is_type(value, type_name):
            self.add(
                TYPE_MISMATCH,
                path,
                schema_path,
                f"expected {type_name} but found {type_name_of(value)}",
            )

    def validate_common_constraints(self, path: str, value: Any, definition: Definition) -> None:
        if isinstance(value, list):
            self.validate_length(path, len(value), definition)
            return
        if isinstance(value, dict) and definition.type_name == SchemaType.COLLECTION:
            return
        self.validate_allowed_values(path, value, definition)
        if definition.allowed_values:
            return
        self.validate_range(path, value, definition)
        if isinstance(value, str):
            self.validate_length(path, len(value), definition)
            if definition.pattern is not None and not definition.pattern.search(value):
                self.add(
                    PATTERN,
                    path,
                    self._sp(definition, "pattern"),
                    f"does not match pattern {definition.pattern.pattern}",
                )
            if definition.format and not matches_format(value, definition.format):
                self.add(
                    FORMAT,
                    path,
                    self._sp(definition, "format"),
                    f"does not match format {definition.format}",
                )

    def validate_allowed_values(self, path: str, value: Any, definition: Definition) -> None:
        if not definition.allowed_values:
            return
        for allowed in definition.allowed_values:
            if values_equal(allowed, value):
                return
        self.add(
            ALLOWEDVALUES,
            path,
            self._sp(definition, "allowedvalues"),
            "value is not in allowedvalues",
        )

    def validate_member_value_constraints(
        self, path: str, value: Any, definition: Definition
    ) -> None:
        self.validate_allowed_values(path, value, definition)
        if not definition.allowed_values:
            self.validate_range(path, value, definition)
        if isinstance(value, str):
            if definition.pattern is not None and not definition.pattern.search(value):
                self.add(
                    PATTERN,
                    path,
                    self._sp(definition, "pattern"),
                    f"does not match pattern {definition.pattern.pattern}",
                )
            if definition.format and not matches_format(value, definition.format):
                self.add(
                    FORMAT,
                    path,
                    self._sp(definition, "format"),
                    f"does not match format {definition.format}",
                )

    def validate_range(self, path: str, value: Any, definition: Definition) -> None:
        if definition.min is not None:
            try:
                comparison = compare(value, definition.min)
            except IncomparableError as exc:
                self.add(MIN, path, self._sp(definition, "min"), str(exc))
            else:
                if comparison < 0:
                    self.add(MIN, path, self._sp(definition, "min"), "value is less than min")
        if definition.max is not None:
            try:
                comparison = compare(value, definition.max)
            except IncomparableError as exc:
                self.add(MAX, path, self._sp(definition, "max"), str(exc))
            else:
                if comparison > 0:
                    self.add(MAX, path, self._sp(definition, "max"), "value is greater than max")

    def validate_length(self, path: str, length: int, definition: Definition) -> None:
        if definition.min_length is not None and length < definition.min_length:
            self.add(
                MINLENGTH,
                path,
                self._sp(definition, "minlength"),
                "length is less than minlength",
            )
        if definition.max_length is not None and length > definition.max_length:
            self.add(
                MAXLENGTH,
                path,
                self._sp(definition, "maxlength"),
                "length is greater than maxlength",
            )

    # -- reference resolution ---------------------------------------------------

    def resolve(self, definition: Definition, seen_references: Set[str]) -> Definition:
        if not definition.reference:
            return definition
        referenced = self.resolve_reference(definition.reference, seen_references)
        referenced = dataclasses.replace(
            referenced,
            name=definition.name,
            description=definition.description if definition.description else referenced.description,
            optional=definition.optional or referenced.optional,
            all_of=referenced.all_of + definition.all_of,
            dependent_required=_merge_dependencies(
                referenced.dependent_required, definition.dependent_required
            ),
            mutually_exclusive=referenced.mutually_exclusive + definition.mutually_exclusive,
            exactly_one=referenced.exactly_one + definition.exactly_one,
            unique_items=(
                definition.unique_items if definition.unique_items is not None else referenced.unique_items
            ),
        )
        if definition.has_default:
            referenced = dataclasses.replace(
                referenced, default_value=definition.default_value, has_default=True
            )
        referenced = dataclasses.replace(
            referenced, deprecated=definition.deprecated or referenced.deprecated
        )
        return referenced

    def resolve_reference(self, reference: str, seen_references: Set[str]) -> Definition:
        normalized = normalize_reference(reference)
        builtin = parse_schema_type(normalized)
        if builtin is not None:
            return Definition(name=normalized, type_name=builtin)
        if normalized in seen_references:
            raise SchemaError(f"cyclic type reference: {normalized}")
        definition = self.schema.types.get(normalized)
        if definition is None:
            raise SchemaError(f"unknown type reference: {reference}")
        seen_references = seen_references | {normalized}
        return self.resolve(definition, seen_references)

    # -- diagnostics --------------------------------------------------------

    def _sp(self, definition: Definition, prop: Optional[str] = None) -> Optional[str]:
        base = definition.schema_path or None
        if base is None:
            return None
        return f"{base}.{prop}" if prop else base

    def add(
        self,
        code: str,
        instance_path: str,
        schema_path: Optional[str],
        message: str,
    ) -> None:
        diagnostic = Diagnostic(
            severity=Severity.ERROR,
            code=code,
            instance_path=instance_path,
            message=message,
            phase=Phase.VALIDATION,
            schema_path=schema_path,
        )
        if not self._is_duplicate(self.errors, diagnostic):
            self.errors.append(diagnostic)

    def add_exc(self, instance_path: str, exc: Exception) -> None:
        code = getattr(exc, "code", SCHEMA_MALFORMED) or SCHEMA_MALFORMED
        schema_path = getattr(exc, "schema_path", None)
        self.add(code, instance_path, schema_path, str(exc))

    def warn(
        self,
        code: str,
        instance_path: str,
        schema_path: Optional[str],
        message: str,
    ) -> None:
        if self.suppress_warnings:
            return
        self.append_warnings(
            [
                Diagnostic(
                    severity=Severity.WARNING,
                    code=code,
                    instance_path=instance_path,
                    message=message,
                    phase=Phase.VALIDATION,
                    schema_path=schema_path,
                )
            ]
        )

    @staticmethod
    def _is_duplicate(existing: List[Diagnostic], candidate: Diagnostic) -> bool:
        return any(
            item.code == candidate.code
            and item.instance_path == candidate.instance_path
            and item.schema_path == candidate.schema_path
            for item in existing
        )

    def append_warnings(self, warnings: List[Diagnostic]) -> None:
        for warning in warnings:
            if not self._is_duplicate(self.warnings, warning):
                self.warnings.append(warning)
