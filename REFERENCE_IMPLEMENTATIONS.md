# Reference Implementations

Build and use the TOML Schema reference libraries in Java, Go, .NET, Python,
Rust, and Node.js/TypeScript. Rust also provides the canonical `tosd`
command-line interface for validation, schema discovery through
`[toml-schema].location`, and starter-schema extraction.

## Status

| Language | Location | Requires | Interfaces |
| --- | --- | --- | --- |
| Java | [`reference-implementations/java`](reference-implementations/java) | Java 25 and Maven | Library, schema discovery |
| Go | [`reference-implementations/go`](reference-implementations/go) | Go 1.27.0 | Library, schema discovery, schema extraction |
| .NET | [`reference-implementations/dotnet`](reference-implementations/dotnet) | .NET 10.0 | Library, schema discovery |
| Python | [`reference-implementations/python`](reference-implementations/python) | Python 3.11+ | Library, schema discovery |
| Rust | [`reference-implementations/rust`](reference-implementations/rust) | Rust 1.97.1 and Cargo | Library, canonical CLI, schema discovery, schema extraction |
| Node.js / TypeScript | [`reference-implementations/typescript`](reference-implementations/typescript) | Node.js 26.7+ and TypeScript 7 | Library, schema discovery, schema extraction |

The implementations use TOML 1.0 parsers and share the same conformance expectations.
They are reference-quality implementations rather than separately versioned,
package-registry releases.

## Java

The Java 25 reference library uses [Tomlj](https://github.com/tomlj/tomlj) to
parse TOML and validates the parsed data model against a `.tosd` schema. Its
library API also supports document-driven schema discovery through
`[toml-schema].location`.

Run the full Java test suite:

```shell
mvn -f reference-implementations/java/pom.xml test
```

Run one test:

```shell
mvn -f reference-implementations/java/pom.xml -Dtest=TomlSchemaTest#validatesCheckedInExample test
```

Build the library jar:

```shell
mvn -f reference-implementations/java/pom.xml package
```

Use the library API:

```java
import java.nio.file.Path;
import org.tomlschema.TomlSchema;
import org.tomlschema.ValidationResult;

ValidationResult result = TomlSchema
    .load(Path.of("config.tosd"))
    .validate(Path.of("config.toml"));
```

Validate using `[toml-schema].location` from the TOML document:

```java
import java.nio.file.Path;
import org.tomlschema.TomlSchema;
import org.tomlschema.ValidationResult;

ValidationResult result = TomlSchema.validateDocument(Path.of("config.toml"));
```

`TomlSchema.discover(...)` resolves a relative `[toml-schema].location` from the
document's parent directory, also accepts an absolute local path or a
hierarchical `file` URI, and rejects unsupported URI schemes, opaque `file`
URIs, non-local hosts, and query/fragment components. The document's
`[toml-schema].version` is optional; when present, discovery rejects a
major-version mismatch and reports other unequal versions as warnings on the
returned `DiscoveredSchema`.

The Java test suite reads `toml-schema.abnf` as a conformance guard and checks that the implementation's supported schema properties and built-in type names match the grammar.

## Go

The Go reference library uses [go-toml](https://github.com/pelletier/go-toml)
to parse TOML and validates the parsed data model against a `.tosd` schema. Its
library API also supports document-driven schema discovery and starter-schema
extraction.

Run the Go test suite:

```shell
go -C reference-implementations/go test ./...
```

Use the library API:

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

The Go test suite includes an ABNF conformance test (`abnf_conformance_test.go`) that reads `toml-schema.abnf` and asserts that the implementation's supported schema keys and built-in type names match the grammar.

## .NET

The .NET 10.0 reference library uses [Tomlyn](https://github.com/xoofx/Tomlyn)
to parse TOML and validates the parsed data model against a `.tosd` schema.
Its library API also supports document-driven schema discovery through
`[toml-schema].location`.

Run the full .NET test suite:

```shell
dotnet test reference-implementations/dotnet
```

Run one test:

```shell
dotnet test reference-implementations/dotnet --filter "ValidatesCheckedInExample"
```

Build the library:

```shell
dotnet build reference-implementations/dotnet
```

Use the library API:

```csharp
using TomlSchema;

var schema = TomlSchema.TomlSchema.Load("config.tosd");
var result = schema.Validate("config.toml");

if (!result.IsValid)
{
    foreach (var error in result.Errors)
        Console.WriteLine($"{error.Path}: {error.Message}");
}
```

Validate using `[toml-schema].location` from the TOML document:

```csharp
using TomlSchema;

var result = TomlSchema.TomlSchema.ValidateDocument("config.toml");
```

`TomlSchema.Discover(...)` resolves a relative `[toml-schema].location` from
the document's parent directory, also accepts an absolute local path or a
hierarchical `file` URI, and rejects unsupported URI schemes, opaque `file`
URIs, non-local hosts, and query/fragment components. The document's
`[toml-schema].version` is optional; when present, discovery rejects a
major-version mismatch and reports other unequal versions as warnings on the
returned `DiscoveredSchema`.

The .NET test suite reads `toml-schema.abnf` as a conformance guard and checks that the implementation's supported schema properties and built-in type names match the grammar.

## Python

The Python 3.11+ reference library uses the standard-library
[`tomllib`](https://docs.python.org/3/library/tomllib.html) parser to validate
parsed TOML documents against a `.tosd` schema. Its library API also supports
document-driven schema discovery through `[toml-schema].location`.

Run the full Python test suite:

```shell
python3 -m unittest discover -s reference-implementations/python/tests -v
```

Use the library API:

```python
from toml_schema import load_schema

schema = load_schema("config.tosd")
result = schema.validate_file("config.toml")

if not result.valid:
    for error in result.errors:
        print(f"{error.path}: {error.message}")
```

Validate using `[toml-schema].location` from the TOML document:

```python
from toml_schema import validate_document

result = validate_document("config.toml")
```

Schema discovery resolves relative locations from the document's parent
directory, accepts absolute local paths and hierarchical `file` URIs, and
rejects unsupported schemes, opaque `file` URIs, non-local hosts, and
query/fragment components. An optional document `[toml-schema].version` must
have a compatible major version; other version differences are reported as
warnings.

The Python test suite reads `toml-schema.abnf` as a conformance guard and checks
that the implementation's supported schema properties and built-in type names
match the grammar.

## Rust

The Rust reference implementation uses the [`toml`](https://crates.io/crates/toml)
crate to parse TOML and validates the parsed data model against a `.tosd` schema.
It provides both a library and the canonical `tosd` CLI.

Run the Rust test suite:

```shell
cargo test --manifest-path reference-implementations/rust/Cargo.toml
```

Build the CLI binary:

```shell
cargo build --manifest-path reference-implementations/rust/Cargo.toml --release --bin tosd
```

Install CLI artifact version `1.0.0-rc.2` on Linux x86_64, Linux arm64, or
Apple Silicon macOS from GitHub Releases:

```shell
curl -fsSL https://tomlschema.org/cli/releases/rust-v1.0.0-rc.2/install-tosd.sh | bash
```

The installer verifies the release checksum and writes to `$HOME/.local/bin`;
set `TOSD_INSTALL_DIR` to override the destination. Windows x86_64 users can
download `tosd-1.0.0-rc.2-windows-x86_64.tar.gz` directly. All four platform
archives and `tosd-1.0.0-rc.2-SHA256SUMS.txt` are attached to the
`rust-v1.0.0-rc.2` GitHub Release. See the
[Rust README](reference-implementations/rust/README.md#install-the-cli) for
archive names, checksum verification, and inspect-before-run instructions.

The CLI artifact version is `1.0.0-rc.2`; the TOML Schema language version
embedded in schema documents remains `1.0.0`.

For document-driven lookup, the CLI resolves a relative
`[toml-schema].location` from the TOML document's directory. The document's
`[toml-schema].version` is optional; when present, the CLI rejects a major-version
mismatch and warns about other unequal versions. The CLI currently supports local
files and explicitly rejects unsupported URI schemes.

Validate with an explicit schema:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml --bin tosd -- validate config.tosd config.toml
```

Validate using `[toml-schema].location` from the TOML document:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml --bin tosd -- validate config.toml
```

Validate the example schema against the TOML Schema self-schema:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml --bin tosd -- validate toml-schema.tosd config.tosd
```

Validate the TOML Schema self-schema against itself:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml --bin tosd -- validate toml-schema.tosd toml-schema.tosd
```

Extract a schema from a sample TOML document:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml --bin tosd -- extract config.toml /tmp/config.generated.tosd
```

Use the library API:

```rust
use toml_schema::schema::Schema;

let schema = Schema::load("config.tosd").unwrap();
let result = schema.validate_file("config.toml");
assert!(result.valid());
```

The Rust test suite includes an ABNF conformance test (`tests/abnf_conformance.rs`) that reads `toml-schema.abnf` and asserts that the implementation's supported schema keys and built-in type names match the grammar.

## Node.js / TypeScript

The Node.js reference library is written in TypeScript 7 and uses
[`smol-toml`](https://github.com/squirrelchat/smol-toml) to parse TOML. It
preserves TOML integer, float, and temporal type distinctions and supports
document-driven schema discovery and starter-schema extraction.

Install dependencies and run its checks:

```shell
npm --prefix reference-implementations/typescript ci
npm --prefix reference-implementations/typescript run typecheck
npm --prefix reference-implementations/typescript test
npm --prefix reference-implementations/typescript run build
```

Use the ESM library API:

```typescript
import { loadSchema, validateDocument } from "@tomlschema/toml-schema";

const schema = await loadSchema("config.tosd");
const result = await schema.validateFile("config.toml");

const discoveredResult = await validateDocument("config.toml");
```

The TypeScript test suite reads `toml-schema.abnf` and checks that the
implementation's supported schema properties and built-in type names match the
grammar.

## Conformance expectations

Every reference implementation should:

1. Parse TOML documents with a TOML 1.0-compliant parser rather than reimplementing TOML parsing.
1. Treat `.tosd` schemas as valid TOML documents.
1. Require a schema document's `[toml-schema].version` to be a SemVer string compatible with the implementation's supported TOML Schema version.
1. Validate the checked-in `config.toml` document against `config.tosd`.
1. Validate `config.tosd` against `toml-schema.tosd`.
1. Validate `toml-schema.tosd` against itself.
1. Keep supported schema vocabulary aligned with `toml-schema.abnf` and `toml-schema.tosd`.
1. Implement the TOML Schema 1.0 semantic vocabulary, including sibling
   presence rules, conjunctive composition, array uniqueness, defaults, and
   deprecation warnings.
1. Keep validation non-mutating and expose warnings separately from errors;
   warning-only validation remains valid.

The canonical CLI must additionally support schema lookup through
`[toml-schema].location`, enforce the document schema-reference URI and optional
language-version compatibility rules from `SPEC.md`, and expose validation and
schema extraction commands suitable for automation and editor integration.

The GitHub Actions workflow in `.github/workflows/reference-implementations.yml`
enforces these expectations for Java, Go, .NET, Python, Rust, and TypeScript.
Rust additionally exercises the canonical CLI end to end.

## TOML version profile

TOML Schema targets the TOML logical value model (string, integer, float, boolean, offset-date-time, local-date-time, local-date, local-time, array, table, inline table, array of tables). That model is unchanged between [TOML 1.0.0](https://toml.io/en/v1.0.0) and [TOML 1.1.0](https://toml.io/en/v1.1.0); the TOML 1.1 changes are mostly parser/input-syntax clarifications and additions (for example `\e` and `\xHH` string escapes, optional seconds in date-times, multi-line inline tables, and trailing commas in inline tables). No new TOML Schema keywords or built-in type names are required to support TOML 1.1.

The current reference implementations parse TOML with libraries that target TOML 1.0:

- Java: [Tomlj](https://github.com/tomlj/tomlj) `1.1.1`, which documents support up to TOML 1.0.0.
- Go: [`pelletier/go-toml`](https://github.com/pelletier/go-toml) `v2.3.1`, which targets TOML 1.0.
- .NET: [Tomlyn](https://github.com/xoofx/Tomlyn) `2.10.1`, which targets TOML 1.0.
- Python: [`tomllib`](https://docs.python.org/3/library/tomllib.html), which targets TOML 1.0.
- Rust: [`toml`](https://crates.io/crates/toml) `1`, which targets TOML 1.0.
- TypeScript: [`smol-toml`](https://github.com/squirrelchat/smol-toml) `1.8.0`,
  which supports TOML 1.1 while remaining compatible with TOML 1.0 documents.

The shared baseline parser profile remains **TOML 1.0**. The TypeScript
implementation also accepts TOML 1.1 syntax through its parser, but TOML 1.1
syntax is not yet guaranteed across all reference implementations.

Upgrading a reference implementation to a TOML 1.1-conformant parser is tracked separately. When that happens, the expected follow-up changes are:

1. Bump the TOML badge in [`README.md`](README.md) and the parser notes in the status table above to TOML 1.1.
1. Update the ABNF preamble in [`toml-schema.abnf`](toml-schema.abnf) to reference TOML 1.1 as the underlying grammar.
1. Add parser conformance fixtures exercising the new TOML 1.1 syntax (multi-line inline tables, trailing commas, omitted seconds, `\e` and `\xHH` escapes) against the checked-in schemas.

## Adding another implementation

Future implementations should live under `reference-implementations/<language>` and include language-native build and test instructions. When a new implementation is added, update this file and extend `.github/workflows/reference-implementations.yml` with a separate job for that language.

Each implementation should expose a library API that accepts a schema path and a
TOML document path. Every implementation should include:

1. Tests for the checked-in example, self-schema validation, schema-location
   lookup, unions, composition, arrays, collections, sibling rules,
   annotations, diagnostics, and key-escaping behavior.
1. A vocabulary conformance check against `toml-schema.abnf` or an equivalent generated/derived assertion.
