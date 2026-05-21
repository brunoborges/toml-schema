# Repository instructions for Copilot

## Build, test, and lint

- Full Java test suite: `mvn -f reference-implementations/java/pom.xml test`
- Single Java test method: `mvn -f reference-implementations/java/pom.xml -Dtest=TomlSchemaTest#validatesCheckedInExample test`
- Build executable Java CLI jar: `mvn -f reference-implementations/java/pom.xml package`
- Validate the checked-in example with an explicit schema after packaging: `java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate config.tosd config.toml`
- Validate using `[toml-schema].location` from the TOML document after packaging: `java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate config.toml`

No separate lint command is defined.

## Architecture

This repository contains the TOML Schema Definition (TOSD) specification/proposal plus a Java reference implementation.

- `README.md` is the primary human-readable specification. It defines the purpose of TOML schema validation, the required top-level schema structure, the metadata table, reusable types, elements, block/simple types, collections, references, optionality, patterns, parser expectations, file extension, and MIME types.
- `toml-schema.abnf` is the formal TOSD-layer grammar companion for schema vocabulary and document shape. The Java tests include an ABNF conformance guard to prevent vocabulary drift.
- `toml-schema.tosd` is a TOML schema for schema documents themselves. It models allowed schema metadata, reusable type definitions, and top-level elements.
- `config.tosd` and `config.toml` are the worked example pair: `config.toml` declares `[toml-schema] location = "config.tosd"`, and `config.tosd` describes the allowed document shape.
- `reference-implementations/java/src/main/java/io/github/brunoborges/tomlschema` contains the Java reference implementation: schema loading/modeling, validation, result/error records, and `TomlSchemaCli`.
- `reference-implementations/java/src/test/java/io/github/brunoborges/tomlschema/TomlSchemaTest.java` covers the checked-in examples, self-schema validation, legacy aliases, validation errors, and CLI schema-location lookup.
- `reference-implementations/java/src/test/java/io/github/brunoborges/tomlschema/AbnfConformanceTest.java` reads `toml-schema.abnf` and checks Java schema properties and built-in type names against it.

## Key conventions

- Schema documents are intended to be valid TOML documents. The required top-level tables are `[toml-schema]` and `[elements]`; `[types]` is optional and exists for reusable definitions.
- Custom metadata belongs under `[toml-schema.meta]`; do not add arbitrary keys or subtables directly under `[toml-schema]`.
- Reusable definitions live under `[types.<name>]` and are referenced from `[elements]` or nested type definitions rather than duplicating structures.
- Prefer canonical `typeof` and `collection` in schema examples. The Java implementation still accepts legacy aliases `typeref` and `table-collection` for compatibility.
- Use `itemtype = "types.<name>"` on `type = "array"` definitions when array items need structural validation, including TOML arrays of tables (`[[name]]`) and arrays of inline tables.
- Use `oneof` for exactly-one alternative type validation and `anyof` for at-least-one validation; both reference reusable `[types]` definitions and can apply to fields or array item types.
- `min`/`max` are inclusive and only valid for numeric/date-time types, or arrays with comparable `arraytype`; NaN is not a valid boundary.
- String `minlength`/`maxlength` count Unicode scalar values after TOML parsing, not UTF-8 bytes, UTF-16 code units, or grapheme clusters.
- Use `[...children]` with inline table entries for literal dotted, quoted, empty, or built-in-colliding TOML keys, e.g. `"google.com" = { type = "boolean" }`.
- Root `[toml-schema]` in TOML documents is reserved metadata and ignored during application validation unless the schema explicitly defines `[elements.toml-schema]`.
- Optionality defaults to required behavior. Only mark a schema node optional with `optional = true` when the TOML document may omit that structure.
- Tables with no defined child structure are intentionally open-ended; tables with defined child properties are intended to validate exactly against those children.
- `pattern` applies to string validation, and the README specifies Perl/PCRE-compatible regular expressions for parsers.
