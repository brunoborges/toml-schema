# TOML Schema

[![License](https://img.shields.io/github/license/brunoborges/toml-schema)](LICENSE)
[![TOML 1.0](https://img.shields.io/badge/TOML-1.0-9c4121)](https://toml.io/en/v1.0.0)

[![Reference implementations](https://github.com/brunoborges/toml-schema/actions/workflows/reference-implementations.yml/badge.svg)](https://github.com/brunoborges/toml-schema/actions/workflows/reference-implementations.yml)
[![Rust 1.97.1](https://img.shields.io/badge/Rust-1.97.1-dea584)](REFERENCE_IMPLEMENTATIONS.md#rust)
[![Java 25](https://img.shields.io/badge/Java-25-007396)](REFERENCE_IMPLEMENTATIONS.md#java)
[![Go 1.27.0](https://img.shields.io/badge/Go-1.27.0-00ADD8)](REFERENCE_IMPLEMENTATIONS.md#go)
[![.NET 9](https://img.shields.io/badge/.NET-9.0-512BD4)](REFERENCE_IMPLEMENTATIONS.md#net)
[![Python 3.11](https://img.shields.io/badge/Python-3.11+-3776AB)](REFERENCE_IMPLEMENTATIONS.md#python)
[![TypeScript 6](https://img.shields.io/badge/TypeScript-6-3178C6)](REFERENCE_IMPLEMENTATIONS.md#nodejs--typescript)

TOML Schema is a TOML-based schema language for describing and validating the structure, names, value types, and common semantic relationships of TOML configuration files.

A TOML Schema document is itself a valid TOML document. Validators can use it to catch misconfiguration before production and tooling can use it for editor validation, completion, and hints.

## Documentation

- [Specification](SPEC.md) - the TOML Schema language, validation semantics, file extension, MIME type, and TOML schema-reference metadata.
- [ABNF grammar](toml-schema.abnf) - a compact grammar for the TOML Schema vocabulary and document shape, layered on top of TOML 1.0.
- [Self-schema](toml-schema.tosd) - a structural schema for TOML Schema documents;
  schema loaders enforce property types and conditional applicability.
- [Example schema](config.tosd) and [example TOML document](config.toml) - a worked example used by the reference implementation tests.
- [Examples](examples/) - conditional validation examples and representative
  schemas for Cargo, `pyproject.toml`, Hugo, Netlify, GitLab Runner, and
  Cloudflare Wrangler.
- [Validation report](https://tomlschema.org/validation-report/) - results from
  validating representative real-world TOML documents.
- [Reference implementations](REFERENCE_IMPLEMENTATIONS.md) - canonical CLI and reference library usage, status, and conformance expectations.

## Editor tooling

- [TOML Schema Editor](https://tomlschema.org/editor/) - a visual editor canvas
  for creating and editing `.tosd` schemas in the GitHub Copilot App.
- [TOML Schema LSP](https://github.com/jcbyte/toml-schema-lsp) - a third-party
  language server and VS Code extension providing real-time validation with
  local `.tosd` schemas.

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
    itemtype = "integer"
    uniqueitems = true
```

## Reference implementations

Java, Go, .NET, Python, Rust, and Node.js/TypeScript reference libraries live
under `reference-implementations/`. The Rust implementation provides the
canonical `tosd` CLI. See
[Reference implementations](REFERENCE_IMPLEMENTATIONS.md) for implementation
status, CLI usage, schema extraction, and conformance expectations.

Install the `1.0.0-rc.2` CLI on Linux or Apple Silicon macOS from GitHub
Releases:

```shell
curl --proto '=https' --tlsv1.2 -sSfL \
  https://github.com/brunoborges/toml-schema/releases/download/rust-v1.0.0-rc.2/install-tosd.sh |
  bash -s -- --version 1.0.0-rc.2
```

The installer verifies the release checksum and writes to `$HOME/.local/bin`
by default. Direct downloads, Windows installation, supported platforms, and
installer options are documented in the
[Rust reference implementation README](reference-implementations/rust/README.md#install-the-cli).

## Schema reference from TOML

A TOML document can point to a schema with reserved metadata:

```toml
[toml-schema]
location = "config.tosd"
version = "1.0.0" # optional expected schema-language version
```

See [SPEC.md](SPEC.md#toml-reference-of-a-toml-schema) for the full behavior.

## Related work

There is an ongoing effort to bring schema support for TOML under [toml-lang/toml#792](https://github.com/toml-lang/toml/pull/792). This proposal intentionally focuses on a smaller TOML-native schema language.

## Contributors

Thanks to my friends!

- Andres Almiray [@aalmiray](https://twitter.com/aalmiray)

## License

TOML Schema is licensed under the [MIT License](LICENSE).
