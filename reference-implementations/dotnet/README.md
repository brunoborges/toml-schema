# TOML Schema — .NET reference implementation

.NET 9.0 reference library targeting the current, unreleased
[TOML Schema 1.0.0](../../SPEC.md). It parses TOML with
[Tomlyn](https://github.com/xoofx/Tomlyn) `2.10.1` (TOML 1.0) and validates the
parsed data model against a `.tosd` schema, including document-driven schema
discovery through `[toml-schema].location`.

- Assembly: `TomlSchema`
- Namespace: `TomlSchema`

All commands below assume you run them from the repository root.

## Build and test

Run the full test suite:

```shell
dotnet test reference-implementations/dotnet
```

Run a single test:

```shell
dotnet test reference-implementations/dotnet -k "ValidatesCheckedInExample"
```

Build the library:

```shell
dotnet build reference-implementations/dotnet
```

The compiled assembly is written to
`reference-implementations/dotnet/bin/Debug/net9.0/TomlSchema.dll`.

## Library usage

```csharp
using TomlSchema;

var schema = TomlSchema.TomlSchema.Load("config.tosd");
var result = schema.Validate("config.toml");

if (!result.IsValid)
{
    foreach (var error in result.Errors)
    {
        Console.WriteLine($"{error.Path}: {error.Message}");
    }
}

foreach (var warning in result.Warnings)
{
    Console.WriteLine($"Warning at {warning.Path}: {warning.Message}");
}

// Get default value for an element
var defaultValue = schema.DefaultValue("field_name");
```

`DefaultValue(...)` exposes effective default annotations. Validation never
inserts defaults or mutates parsed TOML.

## Schema discovery

`TomlSchema.Discover(string)` and `TomlSchema.ValidateDocument(string)` load
the schema referenced by a TOML document's reserved `[toml-schema].location`,
following the resolution rules in [`SPEC.md`](../../SPEC.md#toml-reference-of-a-toml-schema):

```csharp
using TomlSchema;

// Discover the schema and validate the document in one step, without parsing it twice.
var result = TomlSchema.TomlSchema.ValidateDocument("config.toml");

// Or inspect the discovered schema, parsed document, and any version warnings first.
var discovered = TomlSchema.TomlSchema.Discover("config.toml");
foreach (var warning in discovered.Warnings)
{
    Console.WriteLine($"Warning: {warning.Message}");
}
```

A relative `location` resolves against the document's parent directory, not
the current working directory. An absolute local path and a hierarchical
`file` URI are also supported; unsupported URI schemes, opaque `file` URIs,
non-local hosts, and query/fragment components are rejected. The optional
document `[toml-schema].version` is compared against the resolved schema's
declared version: a major-version mismatch fails discovery, while any other
difference is reported as a warning rather than an error.

## Conformance

The test suite includes `AbnfConformanceTests`, which reads [`toml-schema.abnf`](../../toml-schema.abnf) and asserts that the implementation's supported schema keys and built-in type names match the grammar.

See [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for the conformance expectations shared by all reference implementations.
