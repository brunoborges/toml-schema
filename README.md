# TOML Schema Definition (TOSD)

[![Reference implementations](https://github.com/brunoborges/toml-schema/actions/workflows/reference-implementations.yml/badge.svg)](https://github.com/brunoborges/toml-schema/actions/workflows/reference-implementations.yml)
[![License](https://img.shields.io/github/license/brunoborges/toml-schema)](LICENSE)
[![TOML 1.0](https://img.shields.io/badge/TOML-1.0-9c4121)](https://toml.io/en/v1.0.0)
[![Java 17](https://img.shields.io/badge/Java-17-007396)](REFERENCE_IMPLEMENTATIONS.md#java)

TOML Schema Definition (TOSD) is a TOML-based schema language for describing and validating the structure, names, and value types of TOML configuration files.

A TOSD schema is itself a valid TOML document. Validators can use it to catch misconfiguration before production and tooling can use it for editor validation, completion, and hints.

## Documentation

- [Specification](SPEC.md) - the TOSD language, validation semantics, file extension, MIME types, and TOML schema-reference metadata.
- [ABNF grammar](toml-schema.abnf) - a compact grammar for the TOSD vocabulary and document shape, layered on top of TOML 1.0.
- [Self-schema](toml-schema.tosd) - a TOSD schema for TOSD schema documents.
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

TOSD schema:

```toml
[toml-schema]
version = "1"

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
SPEC.md                         Human-readable TOSD specification
REFERENCE_IMPLEMENTATIONS.md    Reference implementation status and usage
toml-schema.abnf                TOSD-layer ABNF grammar
toml-schema.tosd                Self-schema for TOSD documents
config.tosd / config.toml       Example schema and TOML document
reference-implementations/java  Java reference implementation and CLI
```

## Reference implementations

The Java 17 reference implementation is available as a library and CLI under `reference-implementations/java`. See [Reference implementations](REFERENCE_IMPLEMENTATIONS.md) for build, test, validation, and future implementation details.

## Schema reference from TOML

A TOML document can point to a schema with reserved metadata:

```toml
[toml-schema]
version = "1"
location = "config.tosd"
```

See [SPEC.md](SPEC.md#toml-reference-of-a-toml-schema) for the full behavior.

## Discussion

If you want to share your thoughts on this proposal, please use the [project discussions](https://github.com/brunoborges/toml-schema/discussions/2).

## Related work

There is an ongoing effort to bring schema support for TOML under [toml-lang/toml#116](https://github.com/toml-lang/toml/pull/116). This proposal intentionally focuses on a smaller TOML-native schema language.

## Contributors

Thanks to my friends!

- Andres Almiray [@aalmiray](https://twitter.com/aalmiray)
