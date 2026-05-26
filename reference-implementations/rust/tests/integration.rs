//! Integration tests mirroring the Go reference implementation's
//! `schema_test.go` to keep behaviour aligned across languages.

use std::env;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use toml_schema::cli::run;
use toml_schema::schema::{Schema, ValidationResult};

fn repository_root() -> PathBuf {
    // Tests run from `reference-implementations/rust`.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repository root")
        .to_path_buf()
}

fn fixture(name: &str) -> PathBuf {
    repository_root().join(name)
}

fn write_file(directory: &Path, name: &str, content: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, content).expect("write fixture");
    path
}

fn has_path(result: &ValidationResult, path: &str) -> bool {
    result.errors.iter().any(|error| error.path == path)
}

fn capture(args: &[&str]) -> (u8, String, String) {
    let owned: Vec<String> = args.iter().map(|argument| (*argument).to_string()).collect();
    let mut out = Cursor::new(Vec::new());
    let mut err = Cursor::new(Vec::new());
    let exit_code = run(&owned, &mut out, &mut err);
    (
        exit_code,
        String::from_utf8(out.into_inner()).expect("stdout utf-8"),
        String::from_utf8(err.into_inner()).expect("stderr utf-8"),
    )
}

#[test]
fn validates_checked_in_example() {
    let schema = Schema::load(fixture("config.tosd")).expect("load config.tosd");
    let result = schema.validate_file(fixture("config.toml"));
    assert!(
        result.valid(),
        "expected valid document, got {:#?}",
        result.errors
    );
}

#[test]
fn enforces_semver_schema_versions() {
    let directory = tempfile_dir("schema-versions");
    let compatible_schema = write_file(
        &directory,
        "compatible-version.tosd",
        r#"
[toml-schema]
version = "1.0.1+build.1"

[elements.title]
type = "string"
"#,
    );
    Schema::load(&compatible_schema).expect("compatible patch version");

    for version in ["1", "1.0", "01.0.0", "1.1.0", "2.0.0"] {
        let schema_path = write_file(
            &directory,
            &format!("invalid-version-{}.tosd", version.replace('.', "-")),
            &format!(
                r#"
[toml-schema]
version = "{version}"

[elements.title]
type = "string"
"#
            ),
        );
        assert!(
            Schema::load(&schema_path).is_err(),
            "expected version {version:?} to be rejected"
        );
    }
}

#[test]
fn validates_self_schema_against_itself() {
    let schema = Schema::load(fixture("toml-schema.tosd")).expect("load toml-schema.tosd");
    let result = schema.validate_file(fixture("toml-schema.tosd"));
    assert!(
        result.valid(),
        "expected valid document, got {:#?}",
        result.errors
    );
}

#[test]
fn validates_config_schema_against_self_schema() {
    let schema = Schema::load(fixture("toml-schema.tosd")).expect("load toml-schema.tosd");
    let result = schema.validate_file(fixture("config.tosd"));
    assert!(
        result.valid(),
        "expected valid document, got {:#?}",
        result.errors
    );
}

#[test]
fn reports_validation_errors() {
    let directory = tempfile_dir("reports-errors");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
minlength = 2
pattern = "^[a-z]+$"

[elements.port]
type = "integer"
min = 1
max = 65535
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
name = "A"
port = 70000
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    let result = schema.validate_file(&document_path);

    assert!(!result.valid(), "expected validation errors");
    assert_eq!(
        result.errors.len(),
        3,
        "expected 3 errors, got {:#?}",
        result.errors
    );
    assert!(has_path(&result, "$.name"));
    assert!(has_path(&result, "$.port"));
}

#[test]
fn rejects_malformed_boundary_schemas() {
    let directory = tempfile_dir("malformed-boundaries");
    let cases = [
        (
            "any-min",
            r#"
[toml-schema]
version = "1.0.0"

[elements.payload]
type = "any"
min = 1
"#,
        ),
        (
            "nan-min",
            r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "float"
min = nan
"#,
        ),
        (
            "string-min",
            r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
min = "1"
"#,
        ),
        (
            "date-time-min",
            r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "local-date"
min = 2026-01-01T00:00:00Z
"#,
        ),
    ];

    for (name, content) in cases {
        let schema_path = write_file(&directory, &format!("{name}.tosd"), content);
        Schema::load(&schema_path).expect_err("expected malformed boundary schema");
    }
}

#[test]
fn pattern_must_match_entire_string() {
    let directory = tempfile_dir("pattern-entire-string");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.id]
type = "string"
pattern = "\\d+"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
id = "abc123"
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    let result = schema.validate_file(&document_path);

    assert!(
        !result.valid(),
        "expected unanchored pattern not to match the entire string"
    );
    assert!(has_path(&result, "$.id"));
}

#[test]
fn validates_unions_and_array_item_schemas() {
    let directory = tempfile_dir("unions-and-arrays");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.stringId]
type = "string"
pattern = "^[a-z]+$"

[types.intId]
type = "integer"
min = 1

[types.named]
type = "table"

    [types.named.name]
    type = "string"

[types.numbered]
type = "table"

    [types.numbered.id]
    type = "integer"

[types.namedOrNumbered]
oneof = [ "types.named", "types.numbered" ]

[elements.id]
anyof = [ "types.stringId", "types.intId" ]

[elements.entries]
type = "array"
arraytype = "table"
itemtype = "types.namedOrNumbered"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
id = "abc"
entries = [
  { name = "alpha" },
  { id = 1 }
]
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    let result = schema.validate_file(&document_path);

    assert!(
        result.valid(),
        "expected valid document, got {:#?}",
        result.errors
    );
}

#[test]
fn supports_built_in_type_references() {
    let directory = tempfile_dir("built-in-references");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.name]
typeof = "string"

[elements.flags]
type = "array"
itemtype = "boolean"

[elements.tuple]
type = "array"
items = [ "string", "integer" ]

[elements.identity]
oneof = [ "string", "integer" ]

[elements.flex]
anyof = [ "string", "integer" ]
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
name = "Alice"
flags = [ true, false ]
tuple = [ "port", 8080 ]
identity = 42
flex = "abc"
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    let result = schema.validate_file(&document_path);
    assert!(
        result.valid(),
        "expected valid document, got {:#?}",
        result.errors
    );
}

#[test]
fn rejects_types_named_after_built_ins() {
    let directory = tempfile_dir("reserved-built-in");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.string]
type = "integer"

[elements.value]
type = "string"
"#,
    );

    let error = Schema::load(&schema_path).expect_err("expected reserved built-in name");
    assert!(error.contains("reserved built-in type name"));
}

#[test]
fn rejects_table_collection_alias() {
    let directory = tempfile_dir("table-collection-alias");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.item]
type = "table"

    [types.item.name]
    type = "string"

[elements.items]
type = "table-collection"
typeof = "types.item"
"#,
    );

    let error = Schema::load(&schema_path).expect_err("expected table-collection alias rejection");
    assert!(error.contains("unsupported schema type"));
}

#[test]
fn rejects_occurrence_aliases() {
    let directory = tempfile_dir("occurrence-aliases");
    for alias in ["minoccurs", "maxoccurs"] {
        let schema_path = write_file(
            &directory,
            &format!("{alias}.tosd"),
            &format!(
                r#"
[toml-schema]
version = "1.0.0"

[elements.values]
type = "array"
arraytype = "string"
{alias} = 1
"#
            ),
        );

        let error = Schema::load(&schema_path).expect_err("expected occurrence alias rejection");
        assert!(error.contains("unsupported property"));
    }
}

#[test]
fn validates_tuple_arrays_by_position() {
    let directory = tempfile_dir("tuple-arrays");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[types.label]
type = "string"

[types.coordinateLabel]
type = "array"
items = [ "types.coordinate", "types.label" ]

[elements.value]
type = "array"
items = [ "types.coordinateLabel", "types.coordinate" ]
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
value = [ [ 1.5, "Hello" ], 2.0 ]
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    let result = schema.validate_file(&document_path);
    assert!(
        result.valid(),
        "expected valid document, got {:#?}",
        result.errors
    );
}

#[test]
fn rejects_invalid_tuple_arrays() {
    let directory = tempfile_dir("tuple-arrays-invalid");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[types.label]
type = "string"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
"#,
    );
    let wrong_order = write_file(
        &directory,
        "wrong-order.toml",
        r#"
value = [ "Hello", 1.5 ]
"#,
    );
    let too_short = write_file(
        &directory,
        "too-short.toml",
        r#"
value = [ 1.5 ]
"#,
    );
    let too_long = write_file(
        &directory,
        "too-long.toml",
        r#"
value = [ 1.5, "Hello", true ]
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    let wrong_order_result = schema.validate_file(&wrong_order);
    assert!(!wrong_order_result.valid());
    assert!(has_path(&wrong_order_result, "$.value[0]"));
    assert!(has_path(&wrong_order_result, "$.value[1]"));

    let too_short_result = schema.validate_file(&too_short);
    assert!(!too_short_result.valid());
    assert!(has_path(&too_short_result, "$.value"));

    let too_long_result = schema.validate_file(&too_long);
    assert!(!too_long_result.valid());
    assert!(has_path(&too_long_result, "$.value"));
}

#[test]
fn rejects_tuple_schema_with_conflicting_properties() {
    let directory = tempfile_dir("tuple-arrays-conflicts");
    let conflicts = [
        r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
arraytype = "string"
"#,
        r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
minlength = 2
"#,
    ];
    for (index, content) in conflicts.iter().enumerate() {
        let schema_path = write_file(&directory, &format!("schema-{index}.tosd"), content);
        let error = Schema::load(&schema_path).expect_err("expected schema conflict error");
        assert!(error.contains("items"));
    }
}

#[test]
fn supports_quoted_dotted_and_empty_keys_with_children_table() {
    let directory = tempfile_dir("children-keys");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.site]
type = "table"

    [elements.site.children]
    "google.com" = { type = "boolean" }

[elements.children]
"" = { type = "string" }
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
"" = "blank"

[site]
"google.com" = true
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    let result = schema.validate_file(&document_path);
    assert!(
        result.valid(),
        "expected valid document, got {:#?}",
        result.errors
    );
}

#[test]
fn cli_locates_schema_from_document_metadata() {
    let directory = tempfile_dir("cli-locates-schema");
    write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
title = "Example"

[toml-schema]
version = "1.0.0"
location = "schema.tosd"
"#,
    );

    let (exit_code, stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);

    assert_eq!(exit_code, 0, "expected exit code 0, got {exit_code}: {stderr}");
    assert!(stdout.contains("is valid"), "expected valid output, got {stdout:?}");
}

#[test]
fn cli_extracts_schema_from_toml_document() {
    let directory = tempfile_dir("cli-extracts-schema");
    let document_path = write_file(
        &directory,
        "extract-source.toml",
        r#"
title = "Example"
enabled = true
ports = [8080, 8081]

[owner]
name = "Alice"

[site]
"google.com" = true

[toml-schema]
version = "1.0.0"
location = "ignored.tosd"
"#,
    );
    let extracted_schema = directory.join("extract-output.tosd");
    let (exit_code, stdout, stderr) = capture(&[
        "extract",
        document_path.to_str().unwrap(),
        extracted_schema.to_str().unwrap(),
    ]);

    assert_eq!(exit_code, 0, "expected exit code 0, got {exit_code}: {stderr}");
    assert!(
        stdout.contains("Extracted schema to"),
        "expected extract output, got {stdout:?}"
    );

    let schema_text = fs::read_to_string(&extracted_schema).expect("read extracted schema");
    for expected in [
        "version = \"1.0.0\"",
        "[elements.title]",
        "type = \"string\"",
        "[elements.owner]",
        "[elements.owner.name]",
        "[elements.site.\"google.com\"]",
        "arraytype = \"integer\"",
    ] {
        assert!(
            schema_text.contains(expected),
            "expected extracted schema to contain {expected:?}:\n{schema_text}"
        );
    }
    assert!(
        !schema_text.contains("[elements.toml-schema]"),
        "extracted schema should not include reserved metadata:\n{schema_text}"
    );

    let schema = Schema::load(&extracted_schema).expect("load extracted schema");
    let result = schema.validate_file(&document_path);
    assert!(
        result.valid(),
        "expected extracted schema to validate source document, got {:#?}",
        result.errors
    );
}

#[test]
fn cli_help_returns_zero() {
    for argument in ["--help", "-h"] {
        let (exit_code, stdout, _stderr) = capture(&[argument]);
        assert_eq!(exit_code, 0);
        assert!(stdout.contains("Usage"));
    }
}

#[test]
fn cli_reports_unknown_command() {
    let (exit_code, _stdout, stderr) = capture(&["wat"]);
    assert_eq!(exit_code, 2);
    assert!(stderr.contains("Unknown command"));
}

fn tempfile_dir(name: &str) -> PathBuf {
    let directory = env::temp_dir().join(format!(
        "toml-schema-rust-{}-{}-{}",
        name,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&directory).expect("create temp directory");
    directory
}
