"""Starter-schema extraction from parsed TOML documents."""

from __future__ import annotations

import datetime
import json
import re
from pathlib import Path
from typing import Any

from ._schema import CURRENT_TOML_SCHEMA_VERSION, load_document

_BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def generate_schema(document: dict[str, Any]) -> str:
    """Generates a draft TOML Schema describing a parsed TOML document."""
    lines = [
        "[toml-schema]",
        f'version = "{CURRENT_TOML_SCHEMA_VERSION}"',
        "",
        "[elements]",
    ]
    for key in sorted(document):
        if key != "toml-schema":
            _append_definition(lines, ("elements", key), document[key])
    return "\n".join(lines) + "\n"


def extract_schema_file(document_path: str, schema_path: str) -> None:
    """Reads a TOML document and writes its inferred draft schema."""
    schema = generate_schema(load_document(document_path))
    Path(schema_path).write_text(schema, encoding="utf-8")


def _append_definition(lines: list[str], path: tuple[str, ...], value: Any) -> None:
    lines.extend(("", f"[{'.'.join(_encode_key(part) for part in path)}]"))
    type_name = _schema_type(value)
    lines.append(f'type = "{type_name}"')
    if type_name == "array":
        lines.append(f'itemtype = "{_infer_item_type(value)}"')
    if isinstance(value, dict):
        for key in sorted(value):
            _append_definition(lines, path + (key,), value[key])


def _schema_type(value: Any) -> str:
    if isinstance(value, str):
        return "string"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    if isinstance(value, datetime.datetime):
        return "offset-date-time" if value.utcoffset() is not None else "local-date-time"
    if isinstance(value, datetime.date):
        return "local-date"
    if isinstance(value, datetime.time):
        return "local-time"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "table"
    return "any"


def _infer_item_type(items: list[Any]) -> str:
    if not items:
        return "any"
    first = _schema_type(items[0])
    return first if all(_schema_type(item) == first for item in items[1:]) else "any"


def _encode_key(key: str) -> str:
    if _BARE_KEY.fullmatch(key):
        return key
    return json.dumps(key, ensure_ascii=False)
