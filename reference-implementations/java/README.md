# TOML Schema — Java reference implementation

Java 25 reference library targeting the current, unreleased
[TOML Schema 1.0.0](../../SPEC.md). It parses TOML with
[Tomlj](https://github.com/tomlj/tomlj) `1.1.1` (TOML 1.0) and validates the
parsed data model against a `.tosd` schema.

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

## Conformance

The test suite includes `AbnfConformanceTest`, which reads [`toml-schema.abnf`](../../toml-schema.abnf) and asserts that the implementation's supported schema keys and built-in type names match the grammar.

See [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for the conformance expectations shared by all reference implementations.
