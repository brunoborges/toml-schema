# Repository instructions for Copilot

## Build, test, and lint

- Full Java test suite: `mvn -f reference-implementations/java/pom.xml test`
- Single Java test method: `mvn -f reference-implementations/java/pom.xml -Dtest=TomlSchemaTest#validatesCheckedInExample test`
- Build executable Java CLI jar: `mvn -f reference-implementations/java/pom.xml package`
- Validate the checked-in example with an explicit schema after packaging: `java -jar reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar validate config.tosd config.toml`
- Validate using `[toml-schema].location` from the TOML document after packaging: `java -jar reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar validate config.toml`

No separate lint command is defined.

## Architecture

This repository contains the TOML Schema specification/proposal plus reference implementations.

- `SPEC.md` is the primary human-readable specification. It defines the TOML schema language, validation semantics, parser expectations, file extension, MIME types, and schema-reference metadata.
- `README.md` is the project overview and quickstart. Keep it concise and link to `SPEC.md` for detailed language semantics and `REFERENCE_IMPLEMENTATIONS.md` for implementation usage.
- `REFERENCE_IMPLEMENTATIONS.md` tracks reference implementation status, Java CLI/library usage, and cross-implementation conformance expectations.
- `toml-schema.abnf` is the formal TOML Schema-layer grammar companion for schema vocabulary and document shape. Reference implementation tests include ABNF conformance guards to prevent vocabulary drift.
- `toml-schema.tosd` is a TOML schema for schema documents themselves. It models allowed schema metadata, reusable type definitions, and top-level elements.
- `config.tosd` and `config.toml` are the worked example pair: `config.toml` declares `[toml-schema] location = "config.tosd"`, and `config.tosd` describes the allowed document shape.
- `reference-implementations/java/src/main/java/org/tomlschema` contains the Java reference implementation under the `org.tomlschema` package with Maven coordinate `org.tomlschema:toml-schema`.
- `reference-implementations/go` is the `tomlschema.org/go` importable Go package, and its CLI entrypoint lives under `reference-implementations/go/cmd/toml-schema`.
- `reference-implementations/java/src/test/java/org/tomlschema/TomlSchemaTest.java` covers the checked-in examples, self-schema validation, validation errors, and CLI schema-location lookup.
- Java, Go, and Rust ABNF conformance tests read `toml-schema.abnf` and check implementation schema properties and built-in type names against it.

## Key conventions

- Schema documents are intended to be valid TOML documents. The required top-level tables are `[toml-schema]` and `[elements]`; `[types]` is optional and exists for reusable definitions.
- Use full SemVer strings for `[toml-schema].version`; the current TOML Schema version is `1.0.0`, and shorthand values like `"1"` or `"1.0"` are invalid.
- Custom metadata belongs under `[toml-schema.meta]`; do not add arbitrary keys or subtables directly under `[toml-schema]`.
- Reusable definitions live under `[types.<name>]` and are referenced from `[elements]` or nested type definitions rather than duplicating structures.
- Use canonical `typeof` and `collection` in schema examples.
- Use `itemtype = "types.<name>"` on `type = "array"` definitions when array items need structural validation, including TOML arrays of tables (`[[name]]`) and arrays of inline tables.
- Use `oneof` for exactly-one alternative type validation and `anyof` for at-least-one validation; both reference reusable `[types]` definitions and can apply to fields or array item types.
- `min`/`max` are inclusive and only valid for numeric/date-time types, or arrays with comparable `arraytype`; NaN is not a valid boundary.
- String `minlength`/`maxlength` count Unicode scalar values after TOML parsing, not UTF-8 bytes, UTF-16 code units, or grapheme clusters.
- Use quoted TOML key/table paths only when TOML syntax needs quoting, e.g. literal dotted or empty keys. Schema-key-colliding child paths like `[elements.plugin.pattern]` do not require quotes.
- Root `[toml-schema]` in TOML documents is reserved metadata and ignored during application validation unless the schema explicitly defines `[elements.toml-schema]`.
- Optionality defaults to required behavior. Only mark a schema node optional with `optional = true` when the TOML document may omit that structure.
- Tables with no defined child structure are intentionally open-ended; tables with defined child properties are intended to validate exactly against those children.
- `pattern` applies to string validation, and the README specifies Perl/PCRE-compatible regular expressions for parsers.
