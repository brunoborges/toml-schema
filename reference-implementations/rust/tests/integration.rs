//! Integration tests mirroring the Go reference implementation's
//! `schema_test.go` to keep behaviour aligned across languages.

use std::env;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use toml_schema::cli::run;
use toml_schema::schema::{
    resolve_schema_from_document, schema_from_document, Schema, ValidationResult,
};

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
    let owned: Vec<String> = args
        .iter()
        .map(|argument| (*argument).to_string())
        .collect();
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
fn loads_examples_migrated_from_reference_specialization() {
    let examples = fixture("examples");
    let mut paths: Vec<PathBuf> = fs::read_dir(&examples)
        .expect("read examples directory")
        .map(|entry| entry.expect("read example entry").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "tosd")
        })
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "expected checked-in schema examples");
    for path in paths {
        Schema::load(&path)
            .unwrap_or_else(|error| panic!("failed to load {}: {error}", path.display()));
    }
}

#[test]
fn enforces_closed_root_element_semantics() {
    let directory = tempfile_dir("closed-root");
    let schema_path = write_file(
        &directory,
        "closed-root.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types]

[elements]
"#,
    );
    let empty_document = write_file(&directory, "empty.toml", "");
    let metadata_only_document = write_file(
        &directory,
        "metadata-only.toml",
        r#"
[toml-schema]
location = "closed-root.tosd"
"#,
    );
    let application_document = write_file(&directory, "application.toml", "extra = true");
    let defined_root_schema = write_file(
        &directory,
        "defined-root.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.allowed]
type = "string"
"#,
    );
    let document_with_extra_key = write_file(
        &directory,
        "extra-key.toml",
        r#"
allowed = "value"
extra = true
"#,
    );
    let schema = Schema::load(&schema_path).expect("load closed-root schema");

    for document in [&empty_document, &metadata_only_document] {
        let result = schema.validate_file(document);
        assert!(
            result.valid(),
            "expected {} to be valid, got {:#?}",
            document.display(),
            result.errors
        );
    }

    let result = schema.validate_file(&application_document);
    assert!(
        !result.valid() && has_path(&result, "$.extra"),
        "expected an unexpected-key error at $.extra, got {:#?}",
        result.errors
    );

    let defined_schema = Schema::load(&defined_root_schema).expect("load defined-root schema");
    let result = defined_schema.validate_file(&document_with_extra_key);
    assert!(
        !result.valid() && has_path(&result, "$.extra"),
        "expected an unexpected-key error beside a declared root key, got {:#?}",
        result.errors
    );

    let schema_schema = Schema::load(fixture("toml-schema.tosd")).expect("load toml-schema.tosd");
    let result = schema_schema.validate_file(&schema_path);
    assert!(
        result.valid(),
        "expected self-schema to accept empty [elements], got {:#?}",
        result.errors
    );
}

#[test]
fn validates_reserved_metadata_when_the_schema_defines_it() {
    let directory = tempfile_dir("defined-metadata");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.toml-schema]
type = "table"

[elements.toml-schema.location]
type = "string"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
[toml-schema]
location = 42
"#,
    );

    let schema = Schema::load(schema_path).expect("load metadata schema");
    let result = schema.validate_file(document_path);

    assert!(
        has_path(&result, "$.toml-schema.location"),
        "expected reserved metadata to be validated, got {:#?}",
        result.errors
    );
}

#[test]
fn accepts_string_descriptions_and_rejects_other_values() {
    let directory = tempfile_dir("descriptions");
    let described_schema = write_file(
        &directory,
        "described.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.game]
type = "table"
description = "A game object."

[types.game.id]
type = "string"
description = "Unique identifier for the game."

[elements.game]
type = "array"
description = "A list of games."
itemtype = "types.game"
"#,
    );
    Schema::load(&described_schema).expect("descriptions should load");

    let invalid_schema = write_file(
        &directory,
        "invalid-description.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.game]
type = "string"
description = 42
"#,
    );
    Schema::load(&invalid_schema).expect_err("non-string description should be rejected");
}

#[test]
fn treats_default_as_advisory_without_changing_validation() {
    let directory = tempfile_dir("advisory-default");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.port]
type = "integer"
default = 8080
"#,
    );
    let omitted = write_file(&directory, "omitted.toml", "");
    let invalid_present = write_file(&directory, "invalid-present.toml", r#"port = "8080""#);
    let valid_present = write_file(&directory, "valid-present.toml", "port = 9000");

    let schema = Schema::load(schema_path).expect("schema with default should load");
    let omitted_result = schema.validate_file(omitted);
    assert!(
        has_path(&omitted_result, "$.port"),
        "default must not insert an omitted required value: {:#?}",
        omitted_result.errors
    );
    let invalid_result = schema.validate_file(invalid_present);
    assert!(
        has_path(&invalid_result, "$.port"),
        "default must not replace an invalid present value: {:#?}",
        invalid_result.errors
    );
    assert!(
        schema.validate_file(valid_present).valid(),
        "a valid present value should be validated normally"
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
fn rejects_malformed_length_schemas() {
    let directory = tempfile_dir("malformed-lengths");
    let cases = [
        (
            "negative-minlength",
            r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
minlength = -1
"#,
        ),
        (
            "negative-maxlength",
            r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
maxlength = -1
"#,
        ),
        (
            "inverted-length",
            r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
minlength = 5
maxlength = 2
"#,
        ),
    ];

    for (name, content) in cases {
        let schema_path = write_file(&directory, &format!("{name}.tosd"), content);
        Schema::load(&schema_path).expect_err("expected malformed length schema");
    }
}

#[test]
fn enforces_constraints_on_scalar_allowed_values_at_schema_load_time() {
    let directory = tempfile_dir("scalar-allowedvalues");
    let malformed_definitions = [
        r#"
type = "string"
allowedvalues = [ "valid", "INVALID" ]
pattern = "^[a-z]+$"
"#,
        r#"
type = "integer"
allowedvalues = [ 1, 2 ]
min = 2
"#,
        r#"
type = "integer"
allowedvalues = [ 2, 3 ]
max = 2
"#,
        r#"
type = "string"
allowedvalues = [ "a", "ok" ]
minlength = 2
"#,
        r#"
type = "string"
allowedvalues = [ "ok", "long" ]
maxlength = 2
"#,
    ];

    for (index, definition) in malformed_definitions.iter().enumerate() {
        let content = format!(
            r#"
[toml-schema]
version = "1.0.0"

[elements.value]
{definition}
"#
        );
        let schema_path = write_file(
            &directory,
            &format!("invalid-allowedvalues-{index}.tosd"),
            &content,
        );
        Schema::load(&schema_path).expect_err("expected malformed allowedvalues schema");
    }

    let schema_path = write_file(
        &directory,
        "valid-allowedvalues.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
allowedvalues = [ "ab", "cd" ]
pattern = "^[a-z]+$"
minlength = 2
maxlength = 2
"#,
    );
    let valid_document = write_file(&directory, "valid-allowedvalues.toml", r#"value = "ab""#);
    let invalid_document = write_file(&directory, "invalid-allowedvalues.toml", r#"value = "ef""#);
    let schema = Schema::load(&schema_path).expect("load conforming allowedvalues schema");

    assert!(schema.validate_file(valid_document).valid());
    let result = schema.validate_file(invalid_document);
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].message, "value is not in allowedvalues");
}

#[test]
fn validates_array_allowedvalues_without_itemtype() {
    let directory = tempfile_dir("array-allowedvalues");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.values]
type = "array"
allowedvalues = [ 1, 2 ]

[elements.unrestricted]
type = "array"
allowedvalues = []
"#,
    );
    let valid_document = write_file(
        &directory,
        "valid.toml",
        r#"
values = [ 1, 2 ]
unrestricted = [ 1, "two", true ]
"#,
    );
    let invalid_document = write_file(
        &directory,
        "invalid.toml",
        r#"
values = [ 1, 3 ]
unrestricted = [ 1, "two", true ]
"#,
    );

    let schema = Schema::load(&schema_path).expect("load array allowedvalues schema");
    assert!(schema.validate_file(valid_document).valid());

    let result = schema.validate_file(invalid_document);
    assert_eq!(result.errors.len(), 1, "{:#?}", result.errors);
    assert_eq!(result.errors[0].path, "$.values[1]");
    assert_eq!(result.errors[0].message, "value is not in allowedvalues");
}

#[test]
fn pattern_matches_unanchored() {
    let directory = tempfile_dir("pattern-unanchored");
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
    // "abc123" contains digits, so unanchored pattern "\d+" should match
    let matching_path = write_file(
        &directory,
        "matching.toml",
        r#"
id = "abc123"
"#,
    );
    // "abcdef" contains no digits, so pattern "\d+" should not match
    let non_matching_path = write_file(
        &directory,
        "nonmatching.toml",
        r#"
id = "abcdef"
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");

    let match_result = schema.validate_file(&matching_path);
    assert!(
        match_result.valid(),
        "expected unanchored pattern to accept a superstring"
    );

    let no_match_result = schema.validate_file(&non_matching_path);
    assert!(
        !no_match_result.valid(),
        "expected pattern to reject string with no matching substring"
    );
    assert!(has_path(&no_match_result, "$.id"));
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
fn validates_nested_arrays_with_itemtype() {
    let directory = tempfile_dir("nested-arrays");
    let schema_path = write_file(
        &directory,
        "nested-arrays.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.nested]
type = "array"
itemtype = "array"

[elements.mixed]
type = "array"
"#,
    );
    let valid_path = write_file(
        &directory,
        "valid-nested-arrays.toml",
        r#"
nested = [[1, "two"], [true, false]]
mixed = [1, "two", [true]]
"#,
    );
    let invalid_path = write_file(
        &directory,
        "invalid-nested-arrays.toml",
        r#"
nested = [[1], "not-an-array"]
mixed = [1, "two", [true]]
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");

    let valid_result = schema.validate_file(&valid_path);
    assert!(
        valid_result.valid(),
        "expected nested arrays and unconstrained mixed items to be valid, got {:#?}",
        valid_result.errors
    );

    let invalid_result = schema.validate_file(&invalid_path);
    assert!(!invalid_result.valid());
    assert!(has_path(&invalid_result, "$.nested[1]"));
}

#[test]
fn validates_array_ranges_with_comparable_itemtypes() {
    let directory = tempfile_dir("array-ranges");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.boundedInteger]
type = "integer"
min = 3
max = 8

[types.lowInteger]
type = "integer"
max = 6

[types.integerAlternative]
anyof = [ "types.boundedInteger", "types.lowInteger" ]

[elements.direct]
type = "array"
itemtype = "integer"
min = 2
max = 4

[elements.named]
type = "array"
itemtype = "types.boundedInteger"
min = 0
max = 20

[elements.alternative]
type = "array"
itemtype = "types.integerAlternative"
min = 4
max = 5
"#,
    );
    let valid_path = write_file(
        &directory,
        "valid.toml",
        r#"
direct = [2, 4]
named = [3, 8]
alternative = [4, 5]
"#,
    );
    let invalid_path = write_file(
        &directory,
        "invalid.toml",
        r#"
direct = [1, 5]
named = [2]
alternative = [3, 6]
"#,
    );

    let schema = Schema::load(&schema_path).expect("load comparable array ranges");
    assert!(schema.validate_file(&valid_path).valid());

    let result = schema.validate_file(&invalid_path);
    for path in [
        "$.direct[0]",
        "$.direct[1]",
        "$.named[0]",
        "$.alternative[0]",
        "$.alternative[1]",
    ] {
        assert!(
            has_path(&result, path),
            "expected error at {path}: {:#?}",
            result.errors
        );
    }
}

#[test]
fn rejects_array_ranges_with_mixed_itemtype_alternatives() {
    let directory = tempfile_dir("mixed-array-ranges");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.mixed]
oneof = [ "integer", "string" ]

[elements.values]
type = "array"
itemtype = "types.mixed"
min = 1
"#,
    );

    let error = Schema::load(&schema_path).expect_err("reject mixed array range itemtype");
    assert!(
        error.contains("mixed alternatives"),
        "unexpected error: {error}"
    );
}

#[test]
fn rejects_removed_arraytype_property() {
    let directory = tempfile_dir("removed-arraytype");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.values]
type = "array"
arraytype = "integer"
"#,
    );

    let error = Schema::load(&schema_path).expect_err("arraytype must be unsupported");
    assert!(
        error.contains("unsupported property"),
        "unexpected error: {error}"
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
type = "string"

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
fn rejects_removed_table_collection_alias_as_unknown_reference() {
    let directory = tempfile_dir("table-collection-alias");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.items]
type = "table-collection"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
[items]
name = "example"
"#,
    );

    let schema = Schema::load(&schema_path).expect("schema should parse the named reference");
    let result = schema.validate_file(&document_path);
    assert!(result
        .errors
        .iter()
        .any(|error| error.message.contains("unknown type reference")));
}

#[test]
fn validates_collection_keys_against_key_pattern() {
    let directory = tempfile_dir("keypattern");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.serverType]
type = "table"

    [types.serverType.ip]
    type = "string"

[elements.servers]
type = "collection"
itemtype = "types.serverType"
keypattern = "^server_[0-9]+$"
"#,
    );
    let valid_document = write_file(
        &directory,
        "valid.toml",
        r#"
[servers.server_01]
ip = "10.0.0.1"

[servers.server_02]
ip = "10.0.0.2"
"#,
    );
    let invalid_document = write_file(
        &directory,
        "invalid.toml",
        r#"
[servers.server_01]
ip = "10.0.0.1"

[servers.alpha]
ip = "10.0.0.2"
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    assert!(
        schema.validate_file(&valid_document).valid(),
        "expected matching keys to pass"
    );
    let result = schema.validate_file(&invalid_document);
    assert!(!result.valid(), "expected non-matching key to be rejected");
    assert!(has_path(&result, "$.servers.alpha"));
    assert!(!has_path(&result, "$.servers.server_01"));
}

#[test]
fn rejects_key_pattern_on_non_collection() {
    let directory = tempfile_dir("keypattern-scalar");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
keypattern = "^[a-z]+$"
"#,
    );

    let error = Schema::load(&schema_path).expect_err("expected keypattern on scalar rejection");
    assert!(error.contains("keypattern"));
}

#[test]
fn rejects_retired_typeof_property() {
    let directory = tempfile_dir("typeof");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.nameType]
type = "string"

[elements.name]
typeof = "types.nameType"
"#,
    );

    let error = Schema::load(&schema_path).expect_err("expected retired typeof rejection");
    assert!(error.contains("typeof"));
}

#[test]
fn allows_optional_and_description_on_named_type_reference() {
    let directory = tempfile_dir("named-reference-metadata");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.nameType]
type = "string"
pattern = "^[a-z]+$"

[elements.name]
type = "types.nameType"
description = "Optional display name."
optional = true
"#,
    );
    let document_path = write_file(&directory, "document.toml", "# name is optional\n");

    let schema = Schema::load(&schema_path).expect("expected named reference metadata to load");
    let result = schema.validate_file(&document_path);
    assert!(
        result.valid(),
        "expected optional named reference to validate: {:?}",
        result.errors
    );
}

#[test]
fn rejects_constraints_and_children_on_named_type_reference() {
    let invalid_siblings = [
        r#"itemtype = "string""#,
        r#"items = [ "string" ]"#,
        r#"allowedvalues = [ "name" ]"#,
        r#"pattern = "^[a-z]+$""#,
        r#"keypattern = "^[a-z]+$""#,
        "min = 1",
        "max = 1",
        "minlength = 1",
        "maxlength = 1",
        r#"default = "name""#,
        "[elements.name.child]\ntype = \"string\"",
    ];

    for (index, invalid_sibling) in invalid_siblings.iter().enumerate() {
        let directory = tempfile_dir(&format!("named-reference-constraint-{index}"));
        let schema_path = write_file(
            &directory,
            "schema.tosd",
            &format!(
                r#"
[toml-schema]
version = "1.0.0"

[types.nameType]
type = "string"

[elements.name]
type = "types.nameType"
{invalid_sibling}
"#
            ),
        );

        let error = Schema::load(&schema_path).expect_err("expected named reference rejection");
        assert!(
            error.contains("named type reference"),
            "unexpected error for {invalid_sibling}: {error}"
        );
    }
}

#[test]
fn allows_itemtype_on_collection() {
    let directory = tempfile_dir("collection-itemtype");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.stringItem]
type = "string"

[types.integerItem]
type = "integer"

[types.itemType]
oneof = [ "types.stringItem", "types.integerItem" ]

[elements.items]
type = "collection"
itemtype = "types.itemType"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
[items]
name = "example"
port = 8080
"#,
    );

    let schema = Schema::load(&schema_path).expect("expected collection with itemtype to load");
    let result = schema.validate_file(&document_path);
    assert!(
        result.valid(),
        "expected collection itemtype union to validate: {:?}",
        result.errors
    );
}

#[test]
fn rejects_bare_collection_and_any_alternative_references() {
    let directory = tempfile_dir("invalid-bare-references");
    let invalid_definitions = [
        (
            "collection-without-itemtype.tosd",
            r#"
type = "collection"
"#,
        ),
        (
            "prefixed-collection.tosd",
            r#"
type = "types.collection"
"#,
        ),
        (
            "collection-itemtype.tosd",
            r#"
type = "array"
itemtype = "collection"
"#,
        ),
        (
            "collection-items.tosd",
            r#"
type = "array"
items = [ "collection" ]
"#,
        ),
        (
            "collection-oneof.tosd",
            r#"
oneof = [ "collection", "string" ]
"#,
        ),
        (
            "collection-anyof.tosd",
            r#"
anyof = [ "collection", "string" ]
"#,
        ),
        (
            "any-oneof.tosd",
            r#"
oneof = [ "any", "string" ]
"#,
        ),
        (
            "any-anyof.tosd",
            r#"
anyof = [ "any", "string" ]
"#,
        ),
    ];

    for (file_name, definition) in invalid_definitions {
        let schema_path = write_file(
            &directory,
            file_name,
            &format!(
                r#"
[toml-schema]
version = "1.0.0"

[elements.value]
{definition}
"#
            ),
        );

        Schema::load(&schema_path).expect_err("expected bare reference rejection");
    }
}

#[test]
fn allows_any_outside_alternatives_and_named_collections() {
    let directory = tempfile_dir("valid-special-references");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.stringMap]
type = "collection"
itemtype = "string"

[elements.direct]
type = "any"

[elements.values]
type = "array"
itemtype = "any"

[elements.tuple]
type = "array"
items = [ "any" ]

[elements.maps]
type = "array"
itemtype = "types.stringMap"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
direct = { key = 1 }
values = [ 1, "two" ]
tuple = [ true ]
maps = [ { one = "1", two = "2" } ]
"#,
    );

    let schema = Schema::load(&schema_path).expect("expected valid special references");
    let result = schema.validate_file(&document_path);
    assert!(
        result.valid(),
        "expected valid special references, got {:?}",
        result.errors
    );
}

#[test]
fn rejects_invalid_type_selector_cardinality() {
    let directory = tempfile_dir("invalid-type-selectors");
    let invalid_definitions = [
        (
            "type-and-oneof.tosd",
            r#"
type = "string"
oneof = [ "string", "integer" ]
"#,
        ),
        (
            "type-and-anyof.tosd",
            r#"
type = "string"
anyof = [ "string", "integer" ]
"#,
        ),
        (
            "oneof-and-anyof.tosd",
            r#"
oneof = [ "string", "integer" ]
anyof = [ "string", "integer" ]
"#,
        ),
        (
            "selectorless-leaf.tosd",
            r#"
description = "selector-less leaf"
"#,
        ),
    ];

    for (file_name, definition) in invalid_definitions {
        let schema_path = write_file(
            &directory,
            file_name,
            &format!(
                r#"
[toml-schema]
version = "1.0.0"

[elements.value]
{definition}
"#
            ),
        );

        Schema::load(&schema_path).expect_err("expected invalid type selector cardinality");
    }
}

#[test]
fn infers_table_for_selectorless_definition_with_children() {
    let directory = tempfile_dir("implicit-table");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.parent]

    [elements.parent.child]
    type = "string"
"#,
    );

    Schema::load(&schema_path).expect("expected child definitions to imply table type");
}

#[test]
fn rejects_invalid_key_pattern_regex() {
    let directory = tempfile_dir("keypattern-invalid-regex");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.itemType]
type = "table"

    [types.itemType.value]
    type = "string"

[elements.items]
type = "collection"
itemtype = "types.itemType"
keypattern = "("
"#,
    );

    let error =
        Schema::load(&schema_path).expect_err("expected invalid keypattern regex rejection");
    assert!(error.contains("invalid keypattern"));
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
itemtype = "string"
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
itemtype = "string"
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
fn supports_quoted_dotted_empty_and_schema_keyword_keys() {
    let directory = tempfile_dir("special-keys");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.""]
type = "string"

[elements.children]
type = "string"

[elements.site."google.com"]
type = "boolean"

[elements.plugin.type]
type = "string"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
"" = "blank"
children = "literal"

[site]
"google.com" = true

[plugin]
type = "npm"
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

    assert_eq!(
        exit_code, 0,
        "expected exit code 0, got {exit_code}: {stderr}"
    );
    assert!(
        stdout.contains("is valid"),
        "expected valid output, got {stdout:?}"
    );
}

#[test]
fn schema_discovery_accepts_relative_absolute_and_file_uri_locations() {
    let directory = tempfile_dir("schema-location-forms");
    let schemas = directory.join("schemas");
    let documents = directory.join("documents");
    fs::create_dir_all(&schemas).expect("create schemas directory");
    fs::create_dir_all(&documents).expect("create documents directory");
    let schema_path = write_file(
        &schemas,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
"#,
    );
    let file_uri = url::Url::from_file_path(&schema_path).expect("schema file URI");
    let locations = [
        "../schemas/schema.tosd".to_string(),
        "%2e%2e/schemas/schema.tosd".to_string(),
        schema_path.display().to_string(),
        file_uri.to_string(),
    ];

    for (index, location) in locations.iter().enumerate() {
        let document_path = write_file(
            &documents,
            &format!("document-{index}.toml"),
            &format!(
                r#"
title = "Example"

[toml-schema]
location = "{location}"
"#
            ),
        );
        let (schema, document) =
            schema_from_document(&document_path).expect("discover schema from document");
        assert_eq!(schema.version(), "1.0.0");
        assert!(schema.validate(&document).valid());
    }
}

#[test]
fn cli_allows_document_schema_version_to_be_omitted() {
    let directory = tempfile_dir("omitted-document-version");
    write_simple_schema(&directory, "1.0.0");
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
title = "Example"

[toml-schema]
location = "schema.tosd"
"#,
    );

    let (exit_code, _stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);

    assert_eq!(exit_code, 0, "{stderr}");
    assert_eq!(stderr, "");
}

#[test]
fn schema_discovery_exposes_non_major_version_warning_to_the_cli() {
    let directory = tempfile_dir("document-version-warning");
    write_simple_schema(&directory, "1.0.1");
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

    let resolution =
        resolve_schema_from_document(&document_path).expect("resolve schema with warning");
    assert_eq!(resolution.schema.version(), "1.0.1");
    assert_eq!(
        resolution.warnings,
        ["Warning: document expects TOML Schema version 1.0.0, but resolved schema uses 1.0.1"]
    );
    schema_from_document(&document_path).expect("legacy discovery API remains successful");

    let (exit_code, stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);
    assert_eq!(exit_code, 0, "{stderr}");
    assert!(stdout.contains("is valid"));
    assert!(stderr.contains(
        "Warning: document expects TOML Schema version 1.0.0, but resolved schema uses 1.0.1"
    ));
}

#[test]
fn schema_discovery_rejects_major_version_mismatch() {
    let directory = tempfile_dir("document-major-version");
    write_simple_schema(&directory, "1.0.0");
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
title = "Example"

[toml-schema]
version = "2.0.0"
location = "schema.tosd"
"#,
    );

    let error = schema_from_document(&document_path).expect_err("reject major mismatch");
    assert!(error.contains(
        "Document expects TOML Schema major version 2.0.0, but resolved schema uses 1.0.0"
    ));

    let (exit_code, _stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);
    assert_eq!(exit_code, 2);
    assert!(stderr.contains(&error));
}

#[test]
fn schema_discovery_rejects_malformed_document_versions() {
    let directory = tempfile_dir("malformed-document-version");
    write_simple_schema(&directory, "1.0.0");
    for (name, version) in [("shorthand", "\"1.0\""), ("non-string", "1")] {
        let document_path = write_file(
            &directory,
            &format!("{name}.toml"),
            &format!(
                r#"
title = "Example"

[toml-schema]
version = {version}
location = "schema.tosd"
"#
            ),
        );

        let error = schema_from_document(&document_path).expect_err("reject invalid version");
        assert!(
            error.starts_with("Document [toml-schema].version must"),
            "{error}"
        );
        let (exit_code, _stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);
        assert_eq!(exit_code, 2);
        assert!(stderr.contains("Document [toml-schema].version must"));
    }
}

#[test]
fn schema_discovery_rejects_unsupported_and_malformed_location_uris() {
    let directory = tempfile_dir("invalid-location-uri");
    for (name, location, expected) in [
        (
            "unsupported",
            "https://example.com/schema.tosd",
            "Unsupported schema location URI scheme: https",
        ),
        (
            "malformed",
            "http://[invalid/schema.tosd",
            "Invalid [toml-schema].location URI",
        ),
    ] {
        let document_path = write_file(
            &directory,
            &format!("{name}.toml"),
            &format!(
                r#"
[toml-schema]
location = "{location}"
"#
            ),
        );

        let error = schema_from_document(&document_path).expect_err("reject invalid location");
        assert!(error.contains(expected), "{error}");
        let (exit_code, _stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);
        assert_eq!(exit_code, 2);
        assert!(stderr.contains(expected), "{stderr}");
    }
}

#[test]
fn schema_discovery_rejects_unsafe_schema_location_separators() {
    let directory = tempfile_dir("unsafe-location-separators");
    for (name, document, expected) in [
        (
            "backslash",
            "[toml-schema]\nlocation = 'schemas\\schema.tosd'\n",
            "Invalid [toml-schema].location URI",
        ),
        (
            "encoded-slash",
            "[toml-schema]\nlocation = \"schemas%2Fschema.tosd\"\n",
            "Invalid file schema location",
        ),
        (
            "encoded-backslash",
            "[toml-schema]\nlocation = \"schemas%5cschema.tosd\"\n",
            "Invalid file schema location",
        ),
    ] {
        let document_path = write_file(&directory, &format!("{name}.toml"), document);

        let error = schema_from_document(&document_path).expect_err("reject unsafe separator");
        assert!(error.contains(expected), "{error}");
        let (exit_code, _stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);
        assert_eq!(exit_code, 2);
        assert!(stderr.contains(expected), "{stderr}");
    }
}

#[test]
fn schema_discovery_rejects_non_hierarchical_file_locations() {
    let directory = tempfile_dir("non-hierarchical-file-location");
    for (index, location) in [
        "file:schema.tosd",
        "file:../schema.tosd",
        "FiLe:schema.tosd",
    ]
    .iter()
    .enumerate()
    {
        let document_path = write_file(
            &directory,
            &format!("document-{index}.toml"),
            &format!(
                r#"
[toml-schema]
location = "{location}"
"#
            ),
        );

        let error =
            schema_from_document(&document_path).expect_err("reject non-hierarchical file URI");
        assert!(error.contains("Invalid file schema location"), "{error}");
        let (exit_code, _stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);
        assert_eq!(exit_code, 2);
        assert!(stderr.contains("Invalid file schema location"), "{stderr}");
    }
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

    assert_eq!(
        exit_code, 0,
        "expected exit code 0, got {exit_code}: {stderr}"
    );
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
        "itemtype = \"integer\"",
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

fn write_simple_schema(directory: &Path, version: &str) -> PathBuf {
    write_file(
        directory,
        "schema.tosd",
        &format!(
            r#"
[toml-schema]
version = "{version}"

[elements.title]
type = "string"
"#
        ),
    )
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
