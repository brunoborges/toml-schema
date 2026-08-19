# TOML Schema — Go reference implementation

Go reference library for [TOML Schema](../../SPEC.md). It targets the current,
unreleased TOML Schema language version 1.0.0. It parses TOML with
[`pelletier/go-toml`](https://github.com/pelletier/go-toml) `v2.3.1` (TOML
1.0), validates the parsed data model against a `.tosd` schema, and can extract
a starter schema from a sample TOML document.

- Module path: `tomlschema.org/go`

All commands below assume you run them from the repository root.

## Build and test

Run the test suite:

```shell
go -C reference-implementations/go test ./...
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
    for _, warning := range result.Warnings {
        println(string(warning.Severity), warning.Code, warning.Path, warning.Message)
    }

    if err := tomlschema.ExtractSchemaFile("config.toml", "config.generated.tosd"); err != nil {
        panic(err)
    }
}
```

Validation never applies `default` annotations to documents. Use `schema.Element(name)` or
`schema.Type(name)`, followed by `definition.Default()`, to inspect an effective default.

## Conformance

The test suite includes `abnf_conformance_test.go`, which reads [`toml-schema.abnf`](../../toml-schema.abnf) and asserts that the implementation's supported schema keys and built-in type names match the grammar.

See [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for the conformance expectations shared by all reference implementations.
