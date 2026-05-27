# TOML Schema — Go reference implementation

Go reference implementation of [TOML Schema](../../SPEC.md). It parses TOML with [`pelletier/go-toml`](https://github.com/pelletier/go-toml) `v2.3.1` (TOML 1.0) and validates the parsed data model against a `.tosd` schema. It can be used as a library or as an executable CLI, and it can extract a starter schema from a sample TOML document.

- Module path: `tomlschema.org/go`
- CLI package: `tomlschema.org/go/cmd/toml-schema`

All commands below assume you run them from the repository root.

## Build and test

Run the test suite:

```shell
go -C reference-implementations/go test ./...
```

Build the CLI binary:

```shell
go -C reference-implementations/go build -o target/toml-schema ./cmd/toml-schema
```

## CLI usage

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

Extract a starter schema from a sample TOML document:

```shell
go -C reference-implementations/go run ./cmd/toml-schema extract ../../config.toml /tmp/config.generated.tosd
```

## Library usage

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

## Conformance

The test suite includes `abnf_conformance_test.go`, which reads [`toml-schema.abnf`](../../toml-schema.abnf) and asserts that the implementation's supported schema keys and built-in type names match the grammar.

See [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for the conformance expectations shared by all reference implementations.
