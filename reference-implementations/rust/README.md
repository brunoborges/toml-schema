# TOML Schema — Rust reference implementation

Rust reference implementation of [TOML Schema](../../SPEC.md). It parses TOML with the [`toml`](https://crates.io/crates/toml) crate (`0.8`, TOML 1.0) and validates the parsed data model against a `.tosd` schema. It can be used as a library or as an executable CLI, and it can extract a starter schema from a sample TOML document.

- Crate: `toml-schema`
- Library name: `toml_schema`
- Binary name: `toml-schema`

All commands below assume you run them from the repository root.

## Build and test

Run the test suite:

```shell
cargo test --manifest-path reference-implementations/rust/Cargo.toml
```

Build the CLI binary (release):

```shell
cargo build --manifest-path reference-implementations/rust/Cargo.toml --release
```

## CLI usage

Validate with an explicit schema:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml -- validate config.tosd config.toml
```

Validate using `[toml-schema].location` from the TOML document:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml -- validate config.toml
```

Validate the example schema against the TOML Schema self-schema:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml -- validate toml-schema.tosd config.tosd
```

Validate the TOML Schema self-schema against itself:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml -- validate toml-schema.tosd toml-schema.tosd
```

Extract a starter schema from a sample TOML document:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml -- extract config.toml /tmp/config.generated.tosd
```

## Library usage

```rust
use toml_schema::schema::Schema;

let schema = Schema::load("config.tosd").unwrap();
let result = schema.validate_file("config.toml");
assert!(result.valid());
```

## Conformance

The test suite includes an ABNF conformance test (`tests/abnf_conformance.rs`) that reads [`toml-schema.abnf`](../../toml-schema.abnf) and asserts that the implementation's supported schema keys and built-in type names match the grammar.

See [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for the conformance expectations shared by all reference implementations.
