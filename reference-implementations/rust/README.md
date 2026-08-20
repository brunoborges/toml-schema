# TOML Schema — Rust reference implementation

Rust reference implementation targeting the current, unreleased
[TOML Schema 1.0.0](../../SPEC.md). It parses TOML with the
[`toml`](https://crates.io/crates/toml) crate (`1`, TOML 1.0), provides the
canonical `tosd` CLI, and can be used as a library.

- Crate: `toml-schema`
- Library name: `toml_schema`
- Binary name: `tosd`

All commands below assume you run them from the repository root.

## Install the CLI

The canonical CLI is distributed through the
[TOML Schema CLI releases page](https://toml-schema.org/cli/releases/) and
[GitHub Releases](https://github.com/brunoborges/toml-schema/releases).
Install `1.0.0-rc.2` on Linux or Apple Silicon macOS:

```shell
curl --proto '=https' --tlsv1.2 -sSfL \
  https://toml-schema.org/cli/releases/rust-v1.0.0-rc.2/install-tosd.sh |
  bash -s -- --version 1.0.0-rc.2
```

The installer downloads the matching release archive, verifies its SHA-256
checksum, and atomically installs `tosd` to `$HOME/.local/bin/tosd`. Ensure that
directory is on `PATH`. Override the destination when needed:

```shell
curl --proto '=https' --tlsv1.2 -sSfL \
  https://toml-schema.org/cli/releases/rust-v1.0.0-rc.2/install-tosd.sh |
  TOSD_INSTALL_DIR="$HOME/bin" bash -s -- --version 1.0.0-rc.2
```

To inspect the installer before running it:

```shell
curl --proto '=https' --tlsv1.2 -sSfLo install-tosd.sh \
  https://toml-schema.org/cli/releases/rust-v1.0.0-rc.2/install-tosd.sh
less install-tosd.sh
bash install-tosd.sh --version 1.0.0-rc.2
```

Release assets use these names:

| Platform | Archive |
| --- | --- |
| Linux x86_64 | `tosd-1.0.0-rc.2-linux-x86_64.tar.gz` |
| Linux arm64 | `tosd-1.0.0-rc.2-linux-arm64.tar.gz` |
| macOS arm64 | `tosd-1.0.0-rc.2-macos-arm64.tar.gz` |
| Windows x86_64 | `tosd-1.0.0-rc.2-windows-x86_64.tar.gz` |

Windows users download and extract the Windows archive directly, then place
`tosd.exe` on `PATH`. Every release includes
`tosd-1.0.0-rc.2-SHA256SUMS.txt`; verify the selected archive before extracting
it. For example, on Windows PowerShell:

```powershell
$archive = "tosd-1.0.0-rc.2-windows-x86_64.tar.gz"
$expected = ((Select-String " $archive$" tosd-1.0.0-rc.2-SHA256SUMS.txt).Line -split "\s+")[0]
$actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Checksum verification failed" }
tar -xzf $archive
```

On Linux:

```shell
grep ' tosd-1.0.0-rc.2-linux-x86_64.tar.gz$' \
  tosd-1.0.0-rc.2-SHA256SUMS.txt > selected-SHA256SUMS.txt
sha256sum -c selected-SHA256SUMS.txt
```

CLI releases use `rust-v<version>` tags. The CLI artifact version
`1.0.0-rc.2` identifies this implementation prerelease; schemas continue to
declare the TOML Schema language version `1.0.0`.

## Build and test

Run the test suite:

```shell
cargo test --manifest-path reference-implementations/rust/Cargo.toml
```

Build the CLI binary (release):

```shell
cargo build --manifest-path reference-implementations/rust/Cargo.toml --release --bin tosd
```

## CLI usage

Display the installed CLI version:

```shell
tosd --version
```

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

Extract a starter schema from a sample TOML document:

```shell
cargo run --quiet --manifest-path reference-implementations/rust/Cargo.toml --bin tosd -- extract config.toml config.generated.tosd
```

## Library usage

```rust
use toml_schema::schema::Schema;

let schema = Schema::load("config.tosd").unwrap();
let result = schema.validate_file("config.toml");
assert!(result.valid());
for warning in result.warnings() {
    eprintln!("{} {}: {}", warning.code, warning.path, warning.message);
}

if let Some(definition) = schema.element_definition("port") {
    let effective_default = schema.effective_default(definition).unwrap();
    // Defaults are annotations only; validation never inserts them.
    println!("{effective_default:?}");
}
```

Validation warnings (currently `deprecated`) are structured and never make
`valid()` false. The CLI prints them while retaining a successful exit status.
Schema extraction emits version 1.0.0 and never invents defaults.

## Conformance

The test suite includes an ABNF conformance test (`tests/abnf_conformance.rs`) that reads [`toml-schema.abnf`](../../toml-schema.abnf) and asserts that the implementation's supported schema keys and built-in type names match the grammar.

See [`REFERENCE_IMPLEMENTATIONS.md`](../../REFERENCE_IMPLEMENTATIONS.md) for the conformance expectations shared by all reference implementations.
