# TOML Schema Definition (TOSD)

TOML Schema Definition (TOSD) is a TOML-based schema language for describing and validating the structure, names, and value types of TOML configuration files.

A TOSD schema is itself a valid TOML document. Validators can use it to catch misconfiguration before production and tooling can use it for editor validation, completion, and hints.

## Documentation

- [Specification](SPEC.md) - the TOSD language, validation semantics, file extension, MIME types, and TOML schema-reference metadata.
- [ABNF grammar](toml-schema.abnf) - a compact grammar for the TOSD vocabulary and document shape, layered on top of TOML 1.0.
- [Self-schema](toml-schema.tosd) - a TOSD schema for TOSD schema documents.
- [Example schema](config.tosd) and [example TOML document](config.toml) - a worked example used by the reference implementation tests.

## Quick example

TOML document:

```toml
title = "TOML Example"

[database]
enabled = true
ports = [8000, 8001, 8002]
```

TOSD schema:

```toml
[toml-schema]
version = "1"

[elements.title]
type = "string"

[elements.database]
type = "table"

    [elements.database.enabled]
    type = "boolean"

    [elements.database.ports]
    type = "array"
    arraytype = "integer"
```

## Repository layout

```text
SPEC.md                         Human-readable TOSD specification
toml-schema.abnf                TOSD-layer ABNF grammar
toml-schema.tosd                Self-schema for TOSD documents
config.tosd / config.toml       Example schema and TOML document
reference-implementations/java  Java reference implementation and CLI
```

## Java reference implementation

The Java 17 reference implementation lives in `reference-implementations/java`. It uses Tomlj to parse TOML, validates parsed data against a `.tosd` schema, and includes an executable CLI.

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

## Schema reference from TOML

A TOML document can point to a schema with reserved metadata:

```toml
[toml-schema]
version = "1"
location = "config.tosd"
```

See [SPEC.md](SPEC.md#toml-reference-of-a-toml-schema) for the full behavior.

## Discussion

If you want to share your thoughts on this proposal, please use the [project discussions](https://github.com/brunoborges/toml-schema/discussions/2).

## Related work

There is an ongoing effort to bring schema support for TOML under [toml-lang/toml#116](https://github.com/toml-lang/toml/pull/116). This proposal intentionally focuses on a smaller TOML-native schema language.

## Contributors

Thanks to my friends!

- Andres Almiray [@aalmiray](https://twitter.com/aalmiray)
