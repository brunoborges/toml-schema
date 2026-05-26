# TOML Schema

[![Reference implementations](https://github.com/brunoborges/toml-schema/actions/workflows/reference-implementations.yml/badge.svg)](https://github.com/brunoborges/toml-schema/actions/workflows/reference-implementations.yml)
[![License](https://img.shields.io/github/license/brunoborges/toml-schema)](LICENSE)
[![TOML 1.0](https://img.shields.io/badge/TOML-1.0-9c4121)](https://toml.io/en/v1.0.0)
[![Java 25](https://img.shields.io/badge/Java-25-007396)](REFERENCE_IMPLEMENTATIONS.md#java)
[![Go 1.23](https://img.shields.io/badge/Go-1.23-00ADD8)](REFERENCE_IMPLEMENTATIONS.md#go)
[![Rust 1.75](https://img.shields.io/badge/Rust-1.75-dea584)](REFERENCE_IMPLEMENTATIONS.md#rust)

TOML Schema is a TOML-based schema language for describing and validating the structure, names, and value types of TOML configuration files.

A TOML Schema document is itself a valid TOML document. Validators can use it to catch misconfiguration before production and tooling can use it for editor validation, completion, and hints.

## Documentation

- [Specification](SPEC.md) - the TOML Schema language, validation semantics, file extension, MIME type, and TOML schema-reference metadata.
- [ABNF grammar](toml-schema.abnf) - a compact grammar for the TOML Schema vocabulary and document shape, layered on top of TOML 1.0.
- [Self-schema](toml-schema.tosd) - a TOML Schema document for TOML Schema documents.
- [Example schema](config.tosd) and [example TOML document](config.toml) - a worked example used by the reference implementation tests.
- [Reference implementations](REFERENCE_IMPLEMENTATIONS.md) - implementation status, Java CLI/library usage, and conformance expectations.

## Quick example

TOML document:

```toml
title = "TOML Example"

[database]
enabled = true
ports = [8000, 8001, 8002]
```

TOML Schema document:

```toml
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"

[elements.database]
type = "table"

    [elements.database.enabled]
    type = "boolean"

    [elements.database.ports]
    type = "array"
    arraytype = "integer"
```

## Repository layout

```text
SPEC.md                         Human-readable TOML Schema specification
REFERENCE_IMPLEMENTATIONS.md    Reference implementation status and usage
toml-schema.abnf                TOML Schema-layer ABNF grammar
toml-schema.tosd                Self-schema for TOML Schema documents
config.tosd / config.toml       Example schema and TOML document
reference-implementations/java  Java reference implementation and CLI
reference-implementations/go    Go library and CLI reference implementation
reference-implementations/rust  Rust reference implementation and CLI
```

## Reference implementations

Java, Go, and Rust reference implementations live under `reference-implementations/`. See [Reference implementations](REFERENCE_IMPLEMENTATIONS.md) for implementation status, build/test commands, CLI usage, schema extraction, and conformance expectations.

For array tuple/positional validation (`items`), see [SPEC.md: Tuple / Positional Array Validation](SPEC.md#tuple-positional-array-validation---items).

Type references such as `typeof`, `itemtype`, `items`, `oneof`, and `anyof` can point directly at reserved built-in type names (`"string"`, `"boolean"`, `"integer"`, etc.) or at reusable `[types]` definitions.

## Schema reference from TOML

A TOML document can point to a schema with reserved metadata:

```toml
[toml-schema]
version = "1.0.0"
location = "config.tosd"
```

See [SPEC.md](SPEC.md#toml-reference-of-a-toml-schema) for the full behavior.

## Related work

There is an ongoing effort to bring schema support for TOML under [toml-lang/toml#792](https://github.com/toml-lang/toml/pull/792). This proposal intentionally focuses on a smaller TOML-native schema language.

## Contributors

Thanks to my friends!

- Andres Almiray [@aalmiray](https://twitter.com/aalmiray)

## License

TOML Schema is licensed under the [MIT License](LICENSE).