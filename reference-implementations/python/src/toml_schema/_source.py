"""Schema-source syntax recovery.

TOML Schema disambiguates an annotation property from a child definition by
syntax rather than by member name: ``default = { ... }`` is always the
annotation, while a ``[elements.options.default]`` table header is always a
child definition named ``default``. Once TOML is parsed into plain Python
values that distinction is lost, so this module re-scans the original schema
source text to record which table-valued keys were written using inline-table
syntax.

Python's standard-library ``tomllib`` does not expose a syntax tree, so this
module implements a small purpose-built scanner. It only needs to recover
enough structure to answer one question for a given dotted key path: was the
value at this path written as ``key = { ... }`` (an inline table)? Inline
tables in TOML 1.0 always appear on a single logical value span (they cannot
contain top-level newlines), and this implementation never needs to look
inside arrays (annotations such as ``default`` are never disambiguated through
array elements), which keeps the scanner intentionally narrow.
"""

from __future__ import annotations

import json
from typing import FrozenSet, List, Tuple

Path = Tuple[str, ...]


class SchemaSource:
    """Tracks which schema keys were written as inline tables."""

    __slots__ = ("_inline_tables",)

    def __init__(self, content: str = "") -> None:
        self._inline_tables: FrozenSet[Path] = _scan_inline_table_paths(content)

    def is_property(self, table: dict, path: Path, key: str) -> bool:
        """Whether ``key`` in ``table`` (located at ``path``) is an annotation
        property rather than a nested child definition.

        A non-table value is always a property. A table value is a property
        only when the schema source wrote it as an inline table.
        """
        if key not in table:
            return False
        value = table[key]
        if not isinstance(value, dict):
            return True
        return (path + (key,)) in self._inline_tables


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _scan_inline_table_paths(content: str) -> FrozenSet[Path]:
    text = _normalize_newlines(content)
    inline_paths: set[Path] = set()
    try:
        _scan_document(text, inline_paths)
    except Exception:
        # Best-effort recovery: a scanner mishap must never break schema
        # loading. Falling back to "nothing is an inline table" only means
        # ambiguous definition-key/child-definition collisions are resolved
        # as child definitions, which is safe (parsing continues and simply
        # cannot special-case those inline annotations).
        return frozenset()
    return frozenset(inline_paths)


def _skip_ws(text: str, i: int) -> int:
    n = len(text)
    while i < n and text[i] in " \t":
        i += 1
    return i


def _skip_ws_and_newlines(text: str, i: int) -> int:
    n = len(text)
    while i < n and text[i] in " \t\n":
        i += 1
    return i


def _skip_blank_and_comment_lines(text: str, i: int) -> int:
    n = len(text)
    while True:
        i = _skip_ws_and_newlines(text, i)
        if i < n and text[i] == "#":
            while i < n and text[i] != "\n":
                i += 1
            continue
        return i


def _skip_string(text: str, i: int) -> int:
    """text[i] is an opening quote character; returns the index after the
    matching closing quote."""
    n = len(text)
    quote = text[i]
    if text[i : i + 3] == quote * 3:
        closing = quote * 3
        j = i + 3
        while j < n:
            if quote == '"' and text[j] == "\\":
                j += 2
                continue
            if text[j : j + 3] == closing:
                return j + 3
            j += 1
        return j
    j = i + 1
    while j < n:
        if quote == '"' and text[j] == "\\":
            j += 2
            continue
        if text[j] == quote:
            return j + 1
        if text[j] == "\n":
            return j
        j += 1
    return j


def _scan_value(text: str, i: int, stop_chars: str) -> int:
    """Scans a value starting at i; returns the index of the first stop
    character reached at nesting depth 0 (relative to i), or of an unmatched
    closing bracket/brace that belongs to an enclosing structure, or EOF."""
    n = len(text)
    depth = 0
    j = i
    while j < n:
        c = text[j]
        if c in "\"'":
            j = _skip_string(text, j)
            continue
        if depth == 0 and c in stop_chars:
            break
        if c in "[{":
            depth += 1
        elif c in "]}":
            if depth == 0:
                break
            depth -= 1
        j += 1
    return j


def _read_quoted_key(text: str, i: int) -> Tuple[str, int]:
    end = _skip_string(text, i)
    raw = text[i:end]
    if raw[0] == '"':
        return json.loads(raw), end
    return raw[1:-1], end


def _read_key_path(text: str, i: int) -> Tuple[List[str], int]:
    keys: List[str] = []
    j = _skip_ws(text, i)
    n = len(text)
    while True:
        if j < n and text[j] in "\"'":
            key, j = _read_quoted_key(text, j)
        else:
            start = j
            while j < n and (text[j].isalnum() or text[j] in "_-"):
                j += 1
            key = text[start:j]
        keys.append(key)
        save = j
        j = _skip_ws(text, j)
        if j < n and text[j] == ".":
            j = _skip_ws(text, j + 1)
            continue
        j = save
        break
    return keys, j


def _record_inline_table(text: str, brace_index: int, path: Path, inline_paths: set) -> int:
    n = len(text)
    j = brace_index + 1
    while True:
        j = _skip_ws_and_newlines(text, j)
        if j >= n or text[j] == "}":
            return j + 1 if j < n else j
        keys, j = _read_key_path(text, j)
        j = _skip_ws(text, j)
        if j >= n or text[j] != "=":
            return j
        j = _skip_ws(text, j + 1)
        child_path = path + tuple(keys)
        if j < n and text[j] == "{":
            inline_paths.add(child_path)
            j = _record_inline_table(text, j, child_path, inline_paths)
        else:
            j = _scan_value(text, j, ",")
        j = _skip_ws_and_newlines(text, j)
        if j < n and text[j] == ",":
            j += 1
            continue
        if j < n and text[j] == "}":
            return j + 1
        return j


def _scan_document(text: str, inline_paths: set) -> None:
    n = len(text)
    i = 0
    prefix: Path = ()
    while True:
        i = _skip_blank_and_comment_lines(text, i)
        if i >= n:
            return
        if text[i] == "[":
            is_array_table = i + 1 < n and text[i + 1] == "["
            j = i + (2 if is_array_table else 1)
            j = _skip_ws(text, j)
            keys, j = _read_key_path(text, j)
            j = _skip_ws(text, j)
            if is_array_table and text[j : j + 2] == "]]":
                j += 2
            elif not is_array_table and j < n and text[j] == "]":
                j += 1
            while j < n and text[j] != "\n":
                j += 1
            prefix = tuple(keys)
            i = j
            continue
        keys, j = _read_key_path(text, i)
        j = _skip_ws(text, j)
        if j >= n or text[j] != "=":
            # Malformed for our purposes; skip forward defensively.
            i = j + 1 if j >= i else i + 1
            continue
        j = _skip_ws(text, j + 1)
        full_path = prefix + tuple(keys)
        if j < n and text[j] == "{":
            inline_paths.add(full_path)
            j = _record_inline_table(text, j, full_path, inline_paths)
            while j < n and text[j] != "\n":
                j += 1
        else:
            j = _scan_value(text, j, "\n#")
            if j < n and text[j] == "#":
                while j < n and text[j] != "\n":
                    j += 1
        i = j
