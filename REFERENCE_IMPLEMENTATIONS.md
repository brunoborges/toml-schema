# Reference Implementations

This document tracks TOML Schema reference implementations and the expected validation surface for each implementation.

## Status

| Language | Location | Status | Notes |
| --- | --- | --- | --- |
| Java | [`reference-implementations/java`](reference-implementations/java) | Active reference implementation | Java 25 library and CLI using `org.tomlschema:toml-schema` and Tomlj for TOML 1.0 parsing. |
| Go | [`reference-implementations/go`](reference-implementations/go) | Active reference implementation | Go module `tomlschema.org/go` using go-toml for TOML 1.0 parsing. |
| Rust | [`reference-implementations/rust`](reference-implementations/rust) | Active reference implementation | Rust crate `toml-schema` with tomlschema.org package metadata, using the `toml` crate for TOML 1.0 parsing. |
| Other languages | `reference-implementations/<language>` | Not started | Future implementations should follow the same conformance expectations below. |

## Java

The Java 25 reference implementation uses [Tomlj](https://github.com/tomlj/tomlj) to parse TOML and validates the parsed data model against a `.tosd` schema. It can be used as a library or as an executable CLI, and it can extract a starter schema from a sample TOML document.

Run the full Java test suite:

```shell
mvn -f reference-implementations/java/pom.xml test
```

Run one test:

```shell
mvn -f reference-implementations/java/pom.xml -Dtest=TomlSchemaTest#validatesCheckedInExample test
```

Build the CLI jar:

```shell
mvn -f reference-implementations/java/pom.xml package
```

Validate with an explicit schema:

```shell
java -jar reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar validate config.tosd config.toml
```

Validate using `[toml-schema].location` from the TOML document:

```shell
java -jar reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar validate config.toml
```

Validate the example schema against the TOML Schema self-schema:

```shell
java -jar reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar validate toml-schema.tosd config.tosd
```

Validate the TOML Schema self-schema against itself:

```shell
java -jar reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar validate toml-schema.tosd toml-schema.tosd
```

Extract a schema from a sample TOML document:

```shell
java -jar reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar extract config.toml extracted.tosd
```

Use the library API:

```java
import java.nio.file.Path;
import org.tomlschema.TomlSchema;
import org.tomlschema.ValidationResult;

ValidationResult result = TomlSchema
    .load(Path.of("config.tosd"))
    .validate(Path.of("config.toml"));
```

The Java test suite reads `toml-schema.abnf` as a conformance guard and checks that the implementation's supported schema properties and built-in type names match the grammar.

## Go

The Go reference implementation uses [go-toml](https://github.com/pelletier/go-toml) to parse TOML and validates the parsed data model against a `.tosd` schema. It can be used as a library or as an executable CLI, and it can extract a starter schema from a sample TOML document.

Run the Go test suite:

```shell
go -C reference-implementations/go test ./...
```

Validate with an explicit schema:

```shell
go -C reference-implementations/go run ./cmd/toml-schema validate ../../config.tosd ../../config.toml
```

Validate using `[toml-schema].location` from the TOML document:

```shell
go -C reference-implementations/go run ./cmd/toml-schema validate ../../config.toml
```

Validate the example schema against the TOML Schema self-schema:

```shell
go -C reference-implementations/go run ./cmd/toml-schema validate ../../toml-schema.tosd ../../config.tosd
```

Validate the TOML Schema self-schema against itself:

```shell
go -C reference-implementations/go run ./cmd/toml-schema validate ../../toml-schema.tosd ../../toml-schema.tosd
```

Extract a schema from a sample TOML document:

```shell
go -C reference-implementations/go run ./cmd/toml-schema extract ../../config.toml /tmp/config.generated.tosd
```

Use the library API:

```go
package main

import tomlschema "tomlschema.org/go"

func main() {
	schema, err := tomlschema.LoadSchema("config.tosd")
	if err != nil {
		panic(err)
	}
	result := schema.ValidateFile("config.toml")
	if !result.Valid() {
		panic(result.Errors)
	}
}
```

The Go test suite includes an ABNF conformance test (`abnf_conformance_test.go`) that reads `toml-schema.abnf` and asserts that the implementation's supported schema keys and built-in type names match the grammar.

## Rust

The Rust reference implementation uses the [`toml`](https://crates.io/crates/toml) crate to parse TOML and validates the parsed data model against a `.tosd` schema. It can be used as a library or as an executable CLI, and it can extract a starter schema from a sample TOML document.

Run the Rust test suite:

```shell
cargo test --manifest-path reference-implementations/rust/Cargo.toml
```

Build the CLI binary:

```shell
cargo build --manifest-path reference-implementations/rust/Cargo.toml --release
```

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

Extract a schema from a sample TOML document:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml -- extract config.toml /tmp/config.generated.tosd
```

Use the library API:

```rust
use toml_schema::schema::Schema;

let schema = Schema::load("config.tosd").unwrap();
let result = schema.validate_file("config.toml");
assert!(result.valid());
```

The Rust test suite includes an ABNF conformance test (`tests/abnf_conformance.rs`) that reads `toml-schema.abnf` and asserts that the implementation's supported schema keys and built-in type names match the grammar.

## Conformance expectations

Every reference implementation should:

1. Parse TOML documents with a TOML 1.0-compliant parser rather than reimplementing TOML parsing.
1. Treat `.tosd` schemas as valid TOML documents.
1. Require `[toml-schema].version` to be a SemVer string compatible with the implementation's supported TOML Schema version.
1. Validate the checked-in `config.toml` document against `config.tosd`.
1. Support schema lookup through `[toml-schema].location`.
1. Validate `config.tosd` against `toml-schema.tosd`.
1. Validate `toml-schema.tosd` against itself.
1. Keep supported schema vocabulary aligned with `toml-schema.abnf` and `toml-schema.tosd`.

The GitHub Actions workflow in `.github/workflows/reference-implementations.yml` currently enforces these expectations for Java, Go, and Rust.

## TOML version profile

TOML Schema targets the TOML logical value model (string, integer, float, boolean, offset-date-time, local-date-time, local-date, local-time, array, table, inline table, array of tables). That model is unchanged between [TOML 1.0.0](https://toml.io/en/v1.0.0) and [TOML 1.1.0](https://toml.io/en/v1.1.0); the TOML 1.1 changes are mostly parser/input-syntax clarifications and additions (for example `\e` and `\xHH` string escapes, optional seconds in date-times, multi-line inline tables, and trailing commas in inline tables). No new TOML Schema keywords or built-in type names are required to support TOML 1.1.

The current reference implementations parse TOML with libraries that target TOML 1.0:

- Java: [Tomlj](https://github.com/tomlj/tomlj) `1.1.1`, which documents support up to TOML 1.0.0.
- Go: [`pelletier/go-toml`](https://github.com/pelletier/go-toml) `v2.3.1`, which targets TOML 1.0.
- Rust: [`toml`](https://crates.io/crates/toml) `0.8`, which targets TOML 1.0.

For that reason, the reference implementations' current effective parser profile is **TOML 1.0**. TOML 1.1 syntax (for example multi-line inline tables, trailing commas in inline tables, omitted seconds in date-times, or the `\e` and `\xHH` string escapes) is not guaranteed to parse in either reference implementation until the underlying TOML parser declares TOML 1.1 conformance.

Upgrading either reference implementation to a TOML 1.1-conformant parser is tracked separately. When that happens, the expected follow-up changes are:

1. Bump the TOML badge in [`README.md`](README.md) and the parser notes in the status table above to TOML 1.1.
1. Update the ABNF preamble in [`toml-schema.abnf`](toml-schema.abnf) to reference TOML 1.1 as the underlying grammar.
1. Add parser conformance fixtures exercising the new TOML 1.1 syntax (multi-line inline tables, trailing commas, omitted seconds, `\e` and `\xHH` escapes) against the checked-in schemas.

## Adding another implementation

Future implementations should live under `reference-implementations/<language>` and include language-native build and test instructions. When a new implementation is added, update this file and extend `.github/workflows/reference-implementations.yml` with a separate job for that language.

Each implementation should expose the same practical surfaces as Java where possible:

1. A library API that accepts a schema path and a TOML document path.
1. A CLI validation command suitable for automation and editor/tool integration.
1. A CLI extraction command that can generate a starter schema from a sample TOML document.
1. Tests for the checked-in example, self-schema validation, schema-location lookup, unions, arrays, collections, and key-escaping behavior.
1. A vocabulary conformance check against `toml-schema.abnf` or an equivalent generated/derived assertion.
