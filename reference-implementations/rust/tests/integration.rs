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
    for name in ["hugo.tosd", "netlify.tosd"] {
        let path = fixture("examples").join(name);
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
fn requires_array_items_when_arraytype_is_array() {
    let directory = tempfile_dir("nested-arrays");
    let schema_path = write_file(
        &directory,
        "nested-arrays.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.nested]
type = "array"
arraytype = "array"

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
        r#"arraytype = "string""#,
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
fn rejects_type_with_alternative_type_selector() {
    let directory = tempfile_dir("type-and-oneof");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
oneof = [ "string", "integer" ]
"#,
    );

    let error =
        Schema::load(&schema_path).expect_err("expected type and oneof on one node rejection");
    assert!(error.contains("more than one of type, oneof, and anyof"));
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
