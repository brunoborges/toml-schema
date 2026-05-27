# TOML Schema — Java reference implementation

Java 25 reference implementation of [TOML Schema](../../SPEC.md). It parses TOML with [Tomlj](https://github.com/tomlj/tomlj) `1.1.1` (TOML 1.0) and validates the parsed data model against a `.tosd` schema. It can be used as a library or as an executable CLI, and it can extract a starter schema from a sample TOML document.

- Coordinates: `org.tomlschema:toml-schema`
- Java package: `org.tomlschema`
- Main class: `org.tomlschema.TomlSchemaCli`

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

Build the CLI jar (shaded, executable):

```shell
mvn -f reference-implementations/java/pom.xml package
```

The packaged artifact is written to `reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar`.

## CLI usage

Validate with an explicit schema:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate config.tosd config.toml
```

Validate using `[toml-schema].location` from the TOML document:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate config.toml
```

Validate the example schema against the TOML Schema self-schema:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate toml-schema.tosd config.tosd
```

Validate the TOML Schema self-schema against itself:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar validate toml-schema.tosd toml-schema.tosd
```

Extract a starter schema from a sample TOML document:

```shell
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar extract config.toml extracted.tosd
```

## Library usage

```java
import java.nio.file.Path;
import org.tomlschema.TomlSchema;
import org.tomlschema.ValidationResult;

ValidationResult result = TomlSchema
    .load(Path.of("config.tosd"))
    .validate(Path.of("config.toml"));
```

## Conformance

The test suite includes `AbnfConformanceTest`, which reads [`toml-schema.abnf`](../../toml-schema.abnf) and asserts that the implementation's supported schema keys and built-in type names match the grammar.

See [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for the conformance expectations shared by all reference implementations.
