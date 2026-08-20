# TOML Schema for Python

A Python 3.11+ reference implementation of [TOML Schema](../../SPEC.md). It
loads `.tosd` schema documents and validates parsed TOML documents against
them, using only the standard library
[`tomllib`](https://docs.python.org/3/library/tomllib.html) parser at
runtime — there are no runtime dependencies.

See [`SPEC.md`](../../SPEC.md) for the full TOML Schema language definition
and [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for
cross-implementation conformance expectations.

## Requirements

Python 3.11 or later (for `tomllib`). No third-party runtime dependencies.

## Installation

```shell
pip install -e reference-implementations/python
```

Or use the package directly from source by adding
`reference-implementations/python/src` to `PYTHONPATH`.

## Usage

Load a schema and validate a TOML file against it:

```python
from toml_schema import load_schema

schema = load_schema("config.tosd")
result = schema.validate_file("config.toml")

if not result.valid:
    for error in result.errors:
        print(f"{error.path}: {error.message}")
```

Validate an already-parsed document (e.g. loaded elsewhere), or use
`load_document` for a thin wrapper around `tomllib`:

```python
from toml_schema import load_document, load_schema

schema = load_schema("config.tosd")
document = load_document("config.toml")
result = schema.validate(document)
```

Discover a document's own schema through its `[toml-schema].location`
metadata, and validate in one step:

```python
from toml_schema import validate_document

result = validate_document("config.toml")
```

Or do it in two steps to keep the resolved `Schema` object (e.g. to inspect
`schema.warnings` for discovery-time version-compatibility warnings):

```python
from toml_schema import schema_from_document

schema, document = schema_from_document("config.toml")
result = schema.validate(document)
print(schema.warnings)  # e.g. schema-version compatibility notices
```

Extract a starter schema from a TOML document:

```python
from toml_schema import extract_schema_file

extract_schema_file("config.toml", "config.generated.tosd")
```

Extraction infers structure and built-in types, uses `any` for empty or
heterogeneous array item types, skips reserved root `[toml-schema]` metadata,
and never invents defaults.

Schema discovery resolves relative `location` values against the document's
own directory, accepts absolute local paths, and accepts hierarchical
`file://` URIs (rejecting opaque `file:` URIs, non-local hosts, and
query/fragment components). If the document declares
`[toml-schema].version`, a differing-but-compatible (same major version)
value produces a warning; an incompatible major version raises
`toml_schema.DiscoveryError`.

Inspect a schema's definitions and their effective (inherited) annotations:

```python
element = schema.element("database")
print(element.description)
print(element.default())        # (value, has_default)
print(element.deprecated)
child = element.child("host")    # nested Definition, or None
```

## Public API

- `load_schema(path) -> Schema` — parses and fully validates a `.tosd`
  schema file, raising `toml_schema.SchemaError` on any structural or
  semantic problem.
- `load_document(path) -> dict` — parses a TOML document with `tomllib`.
- `generate_schema(document: dict) -> str` — infers starter-schema source text.
- `extract_schema_file(document_path, schema_path)` — writes an inferred schema.
- `Schema.validate(document: dict) -> ValidationResult`
- `Schema.validate_file(path) -> ValidationResult`
- `Schema.element(name) / Schema.type(name) -> Definition | None` — schema
  element/named-type lookup with inherited annotations (`description`,
  `deprecated`, `default()`) resolved.
- `schema_from_document(document_path) -> (Schema, dict)` — schema
  discovery via `[toml-schema].location`.
- `validate_document(document_path) -> ValidationResult` — discovery +
  validation in one call.
- `ValidationResult` — `.valid`, `.errors`, `.warnings`, `.diagnostics`
  (all diagnostics, errors and warnings, in the order produced).
- `Diagnostic` (aliased as `ValidationError`) — `.severity`, `.code`,
  `.path`, `.message`.
- `Definition` — `.name`, `.type_name`, `.description`, `.deprecated`,
  `.optional`, `.default()`, `.child(name)`, `.child_names()`, and the full
  set of parsed constraints (`allowed_values`, `pattern`, `min`/`max`,
  `min_length`/`max_length`, `one_of`/`any_of`/`all_of`, `condition`, sibling
  rules, etc.) for programmatic inspection.
- `SchemaError` / `DiscoveryError` — raised for schema-load and
  discovery failures, respectively (both subclass `ValueError`).

## Running the tests

The test suite uses only the standard library `unittest` module (no
`pytest` dependency):

```shell
python3 -m unittest discover -s reference-implementations/python/tests -v
```

The suite covers: the checked-in `config.tosd`/`config.toml` example, the
self-schema (`toml-schema.tosd` validating itself and `config.tosd`),
loading every schema under `examples/`, schema discovery (including `file://`
URI edge cases and version-compatibility warnings), `allof`/`oneof`/`anyof`
composition and closure rules, conditional (`if`/`then`/`else`) selectors,
effective-annotation resolution across recursive and mutually-recursive
named types, structured diagnostics, and an ABNF vocabulary-alignment
conformance check against `toml-schema.abnf`.

## Building

The package uses a standard `setuptools`-based `pyproject.toml` (`src/`
layout). If the `build` package is already installed:

```shell
python3 -m build reference-implementations/python
```

## Known limitations

- `local-time` values are represented with Python's `datetime.time`, which
  has microsecond precision. Go's reference implementation preserves
  nanosecond precision. This does not affect any checked-in fixture (none
  use sub-microsecond precision), but is noted here for completeness.
- Pattern matching uses Python's `re` module rather than RE2. The patterns
  used throughout this repository's schemas and tests are RE2/`re`
  syntax-compatible (no lookaround, backreferences, or other RE2-incompatible
  constructs), so this does not affect conformance in practice.
