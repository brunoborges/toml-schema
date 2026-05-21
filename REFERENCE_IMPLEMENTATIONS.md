# Reference Implementations

This document tracks TOSD reference implementations and the expected validation surface for each implementation.

## Status

| Language | Location | Status | Notes |
| --- | --- | --- | --- |
| Java | [`reference-implementations/java`](reference-implementations/java) | Active reference implementation | Java 25 library and CLI using Tomlj for TOML 1.0 parsing. |
| Go | [`reference-implementations/go`](reference-implementations/go) | Active reference implementation | Go CLI using go-toml for TOML 1.0 parsing. |
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
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate config.tosd config.toml
```

Validate using `[toml-schema].location` from the TOML document:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate config.toml
```

Validate the example schema against the TOSD self-schema:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate toml-schema.tosd config.tosd
```

Validate the TOSD self-schema against itself:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate toml-schema.tosd toml-schema.tosd
```

Extract a schema from a sample TOML document:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar extract config.toml extracted.tosd
```

Use the library API:

```java
ValidationResult result = TomlSchema
    .load(Path.of("config.tosd"))
    .validate(Path.of("config.toml"));
```

The Java test suite reads `toml-schema.abnf` as a conformance guard and checks that the implementation's supported schema properties and built-in type names match the grammar.

## Go

The Go reference implementation uses [go-toml](https://github.com/pelletier/go-toml) to parse TOML and validates the parsed data model against a `.tosd` schema. It can validate TOML documents from an executable CLI, and it can extract a starter schema from a sample TOML document.

Run the Go test suite:

```shell
go -C reference-implementations/go test ./...
```

Validate with an explicit schema:

```shell
go -C reference-implementations/go run . validate ../../config.tosd ../../config.toml
```

Validate using `[toml-schema].location` from the TOML document:

```shell
go -C reference-implementations/go run . validate ../../config.toml
```

Validate the example schema against the TOSD self-schema:

```shell
go -C reference-implementations/go run . validate ../../toml-schema.tosd ../../config.tosd
```

Validate the TOSD self-schema against itself:

```shell
go -C reference-implementations/go run . validate ../../toml-schema.tosd ../../toml-schema.tosd
```

Extract a schema from a sample TOML document:

```shell
go -C reference-implementations/go run . extract ../../config.toml /tmp/config.generated.tosd
```

## Conformance expectations

Every reference implementation should:

1. Parse TOML documents with a TOML 1.0-compliant parser rather than reimplementing TOML parsing.
1. Treat `.tosd` schemas as valid TOML documents.
1. Validate the checked-in `config.toml` document against `config.tosd`.
1. Support schema lookup through `[toml-schema].location`.
1. Validate `config.tosd` against `toml-schema.tosd`.
1. Validate `toml-schema.tosd` against itself.
1. Keep supported schema vocabulary aligned with `toml-schema.abnf` and `toml-schema.tosd`.

The GitHub Actions workflow in `.github/workflows/reference-implementations.yml` currently enforces these expectations for Java and Go.

## Adding another implementation

Future implementations should live under `reference-implementations/<language>` and include language-native build and test instructions. When a new implementation is added, update this file and extend `.github/workflows/reference-implementations.yml` with a separate job for that language.

Each implementation should expose the same practical surfaces as Java where possible:

1. A library API that accepts a schema path and a TOML document path.
1. A CLI validation command suitable for automation and editor/tool integration.
1. A CLI extraction command that can generate a starter schema from a sample TOML document.
1. Tests for the checked-in example, self-schema validation, schema-location lookup, unions, arrays, collections, and key-escaping behavior.
1. A vocabulary conformance check against `toml-schema.abnf` or an equivalent generated/derived assertion.
