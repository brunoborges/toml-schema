# Repository instructions for Copilot

## Build, test, and lint

- Full Java test suite: `mvn -f reference-implementations/java/pom.xml test`
- Single Java test method: `mvn -f reference-implementations/java/pom.xml -Dtest=TomlSchemaTest#validatesCheckedInExample test`
- Full Go test suite: `go -C reference-implementations/go test ./...`
- Full Rust test suite: `cargo test --manifest-path reference-implementations/rust/Cargo.toml`
- Build the canonical Rust CLI: `cargo build --manifest-path reference-implementations/rust/Cargo.toml --release --bin tosd`
- Validate with an explicit schema: `cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml --bin tosd -- validate config.tosd config.toml`
- Validate using `[toml-schema].location`: `cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml --bin tosd -- validate config.toml`

No separate lint command is defined.

## Architecture

This repository contains the TOML Schema specification/proposal plus reference implementations.

- `SPEC.md` is the primary human-readable specification. It defines the TOML schema language, validation semantics, parser expectations, file extension, MIME types, and schema-reference metadata.
- `README.md` is the project overview and quickstart. Keep it concise and link to `SPEC.md` for detailed language semantics and `REFERENCE_IMPLEMENTATIONS.md` for implementation usage.
- `REFERENCE_IMPLEMENTATIONS.md` tracks reference implementation status, canonical Rust CLI usage, library usage, and cross-implementation conformance expectations.
- `toml-schema.abnf` is the formal TOML Schema-layer grammar companion for schema vocabulary and document shape. Reference implementation tests include ABNF conformance guards to prevent vocabulary drift.
- `toml-schema.tosd` is a TOML schema for schema documents themselves. It models allowed schema metadata, reusable type definitions, and top-level elements.
- `config.tosd` and `config.toml` are the worked example pair: `config.toml` declares `[toml-schema] location = "config.tosd"`, and `config.tosd` describes the allowed document shape.
- `reference-implementations/java/src/main/java/org/tomlschema` contains the Java reference implementation under the `org.tomlschema` package with Maven coordinate `org.tomlschema:toml-schema`.
- `reference-implementations/go` is the `tomlschema.org/go` importable Go package.
- `reference-implementations/rust` provides both the `toml_schema` Rust library and the canonical `tosd` CLI.
- `reference-implementations/java/src/test/java/org/tomlschema/TomlSchemaTest.java` covers the checked-in examples, self-schema validation, and validation errors.
- Java, Go, .NET, and Rust ABNF conformance tests read `toml-schema.abnf` and check implementation schema properties and built-in type names against it.

## Key conventions

- Schema documents are intended to be valid TOML documents. The required top-level tables are `[toml-schema]` and `[elements]`; `[types]` is optional and exists for reusable definitions.
- Use full SemVer strings for `[toml-schema].version`; the current TOML Schema version is `1.0.0`, and shorthand values like `"1"` or `"1.0"` are invalid.
- TOML Schema `1.0.0` has not been released yet. Do not bump the schema-language version in the specification, self-schema, examples, loaders, extraction output, or documentation beyond `1.0.0` until the final release is actually published. Keep reference-implementation artifact versions at `1.0.0-rc.2` unless a release explicitly changes them.
- Custom metadata belongs under `[toml-schema.meta]`; do not add arbitrary keys or subtables directly under `[toml-schema]`.
- Reusable definitions live under `[types.<name>]` and are referenced from `[elements]` or nested type definitions rather than duplicating structures.
- Use `type` for built-in and named type references, `collection` for dynamic-key tables, and `itemtype` for homogeneous array or collection members.
- Use `itemtype = "types.<name>"` on `type = "array"` definitions when array items need structural validation, including TOML arrays of tables (`[[name]]`) and arrays of inline tables.
- Use `oneof` for exactly-one alternative type validation and `anyof` for at-least-one validation; both select the current node's type. For array or collection members, reference a reusable alternative definition through `itemtype`.
- `min`/`max` are inclusive and only valid for numeric/date-time types, or arrays whose `itemtype` resolves to one comparable kind; NaN is not a valid boundary. When both are present `min` must be less than or equal to `max`, and `inf`/`-inf` are rejected as boundaries on an integer-kind definition; both are schema-load errors.
- String `minlength`/`maxlength` count Unicode scalar values after TOML parsing, not UTF-8 bytes, UTF-16 code units, or grapheme clusters.
- Use quoted TOML key/table paths only when TOML syntax needs quoting, e.g. literal dotted or empty keys. Schema-key-colliding child paths like `[elements.plugin.pattern]` do not require quotes.
- Root `[toml-schema]` in TOML documents is reserved metadata and ignored during application validation unless the schema explicitly defines `[elements.toml-schema]`.
- Optionality defaults to required behavior. Only mark a schema node optional with `optional = true` when the TOML document may omit that structure.
- Tables with no defined child structure are intentionally open-ended; tables with defined child properties are intended to validate exactly against those children.
- `pattern` applies to string validation, and the specification defines the portable RE2 regular-expression profile required of parsers.
- The schema definition properties are a closed set (`type`, `description`, `format`, `itemtype`, `items`, `oneof`, `anyof`, `if`, `then`, `else`, `allof`, `allowedvalues`, `pattern`, `keypattern`, `optional`, `min`, `max`, `minlength`, `maxlength`, `uniqueitems`, `dependentrequired`, `mutuallyexclusive`, `exactlyone`, `default`, `deprecated`). Schema loaders reject any unrecognized property name (e.g. a misspelled `patttern`) at schema-load time rather than ignoring it; custom, tool-specific, or experimental keys belong under `[toml-schema.meta]`, not inside a definition. This closure binds schema vocabulary only, never the key names a validated document may contain.
- `allof` composes an effective definition: assertions merge conjunctively (both constraints apply, never last-wins) and fixed children merge by union. `allowedvalues` never short-circuits other assertions — a document value is checked for TOML kind first, then all other applicable assertions, then enumeration membership. A schema-load duplicate-reference check on `oneof`/`anyof`/`allof` (resolved identity after stripping the `types.` prefix) rejects repeated components; `items` may repeat entries.
- Distinguish the *determinate fixed-child set* (schema-load time; `oneof`/`anyof` and `if`/`then`/`else` selectors contribute nothing; read by sibling rules, `exactlyone` applicability, and the collection `itemtype` requirement) from the *effective closure set* (validation time; adds the children of the matched alternative or branch; read by unknown-key rejection, requiredness, and openness).
