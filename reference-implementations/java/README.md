# TOML Schema — Java reference implementation

Java 25 reference library targeting the current, unreleased
[TOML Schema 1.0.0](../../SPEC.md). It parses TOML with
[Tomlj](https://github.com/tomlj/tomlj) `1.1.1` (TOML 1.0) and validates the
parsed data model against a `.tosd` schema, including document-driven schema
discovery through `[toml-schema].location`.

- Coordinates: `org.tomlschema:toml-schema`
- Java package: `org.tomlschema`

All commands below assume you run them from the repository root.

## Build and test

Run the full test suite:

```shell
mvn -f reference-implementations/java/pom.xml test
```

Run a single test:

```shell
mvn -f reference-implementations/java/pom.xml -Dtest=TomlSchemaTest#validatesCheckedInExample test
```

Build the library jar:

```shell
mvn -f reference-implementations/java/pom.xml package
```

The packaged artifact is written to
`reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar`.

## Library usage

```java
import java.nio.file.Path;
import org.tomlschema.TomlSchema;
import org.tomlschema.ValidationResult;

ValidationResult result = TomlSchema
    .load(Path.of("config.tosd"))
    .validate(Path.of("config.toml"));

result.errors();   // structured validation errors
result.warnings(); // warning-only diagnostics, including deprecations
```

`TomlSchema.defaultValue(...)` and `typeDefaultValue(...)` expose effective
default annotations. Validation never inserts defaults or mutates parsed TOML.

### Schema discovery

`TomlSchema.discover(Path)` and `TomlSchema.validateDocument(Path)` load the
schema referenced by a TOML document's reserved `[toml-schema].location`,
following the resolution rules in [`SPEC.md`](../../SPEC.md#toml-reference-of-a-toml-schema):

```java
import java.nio.file.Path;
import org.tomlschema.DiscoveredSchema;
import org.tomlschema.TomlSchema;
import org.tomlschema.ValidationResult;

// Discover the schema and validate the document in one step, without parsing it twice.
ValidationResult result = TomlSchema.validateDocument(Path.of("config.toml"));

// Or inspect the discovered schema, parsed document, and any version warnings first.
DiscoveredSchema discovered = TomlSchema.discover(Path.of("config.toml"));
discovered.warnings(); // non-fatal [toml-schema].version compatibility warnings
```

A relative `location` resolves against the document's parent directory, not
the current working directory. An absolute local path and a hierarchical
`file` URI are also supported; unsupported URI schemes, opaque `file` URIs,
non-local hosts, and query/fragment components are rejected. The optional
document `[toml-schema].version` is compared against the resolved schema's
declared version: a major-version mismatch fails discovery, while any other
difference is reported as a warning rather than an error.

### Schema extraction

```java
TomlSchema.extractSchemaFile(
    Path.of("config.toml"),
    Path.of("config.generated.tosd")
);
```

`TomlSchema.generateSchema(TomlTable)` provides the same inference for an
already parsed document. Extraction infers structure and built-in types, uses
`any` for empty or heterogeneous array item types, skips reserved root
`[toml-schema]` metadata, and never invents defaults.

## Conformance

The test suite includes `AbnfConformanceTest`, which reads [`toml-schema.abnf`](../../toml-schema.abnf) and asserts that the implementation's supported schema keys and built-in type names match the grammar.

See [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for the conformance expectations shared by all reference implementations.
