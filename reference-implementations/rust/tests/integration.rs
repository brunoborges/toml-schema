//! Integration tests mirroring the Go reference implementation's
//! `schema_test.go` to keep behaviour aligned across languages.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use toml_schema::cli::run;
use toml_schema::schema::{schema_from_document, Schema, ValidationResult};
use url::Url;

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
fn loads_checked_in_examples() {
    for name in [
        "cargo.tosd",
        "gitlab-runner.tosd",
        "hugo.tosd",
        "netlify.tosd",
        "pyproject.tosd",
        "wrangler.tosd",
    ] {
        let path = fixture("examples").join(name);
        Schema::load(&path)
            .unwrap_or_else(|error| panic!("failed to load {}: {error}", path.display()));
    }
}

#[test]
fn validates_cargo_manifest_example() {
    let schema = Schema::load(fixture("examples/cargo.tosd")).expect("load cargo.tosd");
    let result = schema.validate_file(fixture("reference-implementations/rust/Cargo.toml"));
    assert!(
        result.valid(),
        "expected valid Cargo.toml, got {:#?}",
        result.errors
    );
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

    for version in ["1", "1.0", "01.0.0", "1.1.0", "1.2.0", "2.0.0"] {
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
        (
            "incompatible-length",
            r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "boolean"
minlength = 1
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
        r#"
type = "string"
allowedvalues = []
"#,
        r#"
type = "string"
allowedvalues = [ 1 ]
"#,
        r#"
type = "array"
itemtype = "integer"
allowedvalues = [ "one" ]
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
"#,
    );
    let valid_document = write_file(
        &directory,
        "valid.toml",
        r#"
values = [ 1, 2 ]
"#,
    );
    let invalid_document = write_file(
        &directory,
        "invalid.toml",
        r#"
values = [ 1, 3 ]
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
fn rejects_invalid_union_structure_and_child_placement() {
    let invalid_definitions = [
        "oneof = []",
        "anyof = []",
        "oneof = [ \"string\" ]\npattern = \"x\"",
        "oneof = [ \"string\" ]\n\n[elements.value.child]\ntype = \"string\"",
        "type = \"string\"\n\n[elements.value.child]\ntype = \"string\"",
        "type = \"array\"\n\n[elements.value.child]\ntype = \"string\"",
    ];

    for (index, definition) in invalid_definitions.iter().enumerate() {
        let directory = tempfile_dir(&format!("invalid-structure-{index}"));
        let schema_path = write_file(
            &directory,
            "schema.tosd",
            &format!(
                r#"
[toml-schema]
version = "1.0.0"

[elements.value]
{definition}
"#
            ),
        );
        Schema::load(&schema_path).expect_err("invalid structure must be rejected");
    }
}

#[test]
fn validates_reference_graph_at_schema_load_time() {
    let invalid_references = [
        "type = \"\"",
        "type = \"types.missing\"",
        "type = \"array\"\nitemtype = \"\"",
        "type = \"array\"\nitemtype = \"types.missing\"",
        "type = \"array\"\nitems = [ \"\" ]",
        "type = \"array\"\nitems = [ \"types.missing\" ]",
        "oneof = [ \"\" ]",
        "oneof = [ \"types.missing\" ]",
        "anyof = [ \"\" ]",
        "anyof = [ \"types.missing\" ]",
        "type = \"table\"\n\n[elements.value.child]\ntype = \"types.missing\"",
    ];
    for (index, definition) in invalid_references.iter().enumerate() {
        let directory = tempfile_dir(&format!("dangling-reference-{index}"));
        let schema_path = write_file(
            &directory,
            "schema.tosd",
            &format!(
                r#"
[toml-schema]
version = "1.0.0"

[elements.value]
{definition}
"#
            ),
        );
        Schema::load(&schema_path).expect_err("dangling reference must be rejected");
    }

    let cycles = [
        "[types.first]\ntype = \"types.second\"\n\n[types.second]\ntype = \"types.first\"",
        "[types.first]\noneof = [ \"types.second\" ]\n\n[types.second]\nanyof = [ \"types.first\" ]",
    ];
    for (index, cycle) in cycles.iter().enumerate() {
        let directory = tempfile_dir(&format!("selector-cycle-{index}"));
        let schema_path = write_file(
            &directory,
            "schema.tosd",
            &format!(
                r#"
[toml-schema]
version = "1.0.0"

{cycle}

[elements.value]
type = "string"
"#
            ),
        );
        Schema::load(&schema_path).expect_err("selector cycle must be rejected");
    }

    let directory = tempfile_dir("recursive-structure");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.node]
type = "table"

    [types.node.children]
    type = "array"
    itemtype = "types.node"

[elements.root]
type = "types.node"
"#,
    );
    Schema::load(&schema_path).expect("structural recursion should load");
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
fn rejects_types_named_with_reference_prefix() {
    let directory = tempfile_dir("reserved-reference-prefix");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types."types.name"]
type = "string"

[elements.value]
type = "name"
"#,
    );

    let error = Schema::load(&schema_path).expect_err("expected reserved reference prefix");
    assert!(error.contains("reserved type-reference prefix"));
}

#[test]
fn resolves_quoted_dotted_type_names_in_both_reference_forms() {
    let directory = tempfile_dir("dotted-type-name");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types."network.endpoint"]
type = "string"

[elements.short]
type = "network.endpoint"

[elements.qualified]
type = "types.network.endpoint"
"#,
    );
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
short = "one"
qualified = "two"
"#,
    );

    let schema = Schema::load(&schema_path).expect("load dotted type schema");
    let result = schema.validate_file(&document_path);
    assert!(result.valid(), "{:?}", result.errors);
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
    Schema::load(&schema_path).expect_err("unknown reference must fail at schema load time");
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
fn rejects_pattern_on_non_string() {
    let directory = tempfile_dir("invalid-pattern");
    let schema_path = write_file(
        &directory,
        "pattern-integer.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
pattern = "^[0-9]+$"
"#,
    );
    Schema::load(&schema_path).expect_err("expected malformed schema");
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
fn rejects_kind_specific_siblings_on_named_references_and_unions() {
    let prohibited = [
        r#"itemtype = "string""#,
        r#"items = [ "string" ]"#,
        r#"allowedvalues = [ "name" ]"#,
        r#"pattern = "^[a-z]+$""#,
        r#"keypattern = "^[a-z]+$""#,
        "min = 1",
        "max = 1",
        "minlength = 1",
        "maxlength = 1",
        r#"dependentrequired = { a = [ "b" ] }"#,
        r#"mutuallyexclusive = [[ "a", "b" ]]"#,
        r#"exactlyone = [[ "a", "b" ]]"#,
        "uniqueitems = true",
    ];

    for (site, selector) in [
        ("named-reference", r#"type = "types.base""#),
        ("union", r#"anyof = [ "types.base", "types.alternative" ]"#),
    ] {
        for (index, sibling) in prohibited.iter().enumerate() {
            let directory = tempfile_dir(&format!("{site}-sibling-{index}"));
            let schema_path = write_file(
                &directory,
                "schema.tosd",
                &format!(
                    r#"
[toml-schema]
version = "1.0.0"

[types.base]
type = "string"

[types.alternative]
type = "integer"

[elements.value]
{selector}
{sibling}
"#
                ),
            );
            let error =
                Schema::load(schema_path).expect_err("kind-specific sibling must be rejected");
            let expected = if site == "named-reference" {
                "named type reference"
            } else {
                "union cannot define"
            };
            assert!(
                error.contains(expected),
                "{site} unexpectedly accepted/reported {sibling}: {error}"
            );
        }
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
        r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "string", "integer" ]
allowedvalues = [ 1 ]
"#,
        r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "string", "integer" ]
min = 1
"#,
    ];
    for (index, content) in conflicts.iter().enumerate() {
        let schema_path = write_file(&directory, &format!("schema-{index}.tosd"), content);
        let error = Schema::load(&schema_path).expect_err("expected schema conflict error");
        assert!(error.contains("items"));
    }
}

#[test]
fn rejects_allowed_values_on_table_and_collection() {
    let directory = tempfile_dir("container-allowedvalues");
    let definitions = [
        "type = \"table\"\nallowedvalues = [ 1 ]",
        "type = \"collection\"\nitemtype = \"string\"\nallowedvalues = [ 1 ]",
    ];
    for (index, definition) in definitions.iter().enumerate() {
        let schema_path = write_file(
            &directory,
            &format!("schema-{index}.tosd"),
            &format!(
                r#"
[toml-schema]
version = "1.0.0"

[elements.value]
{definition}
"#
            ),
        );
        Schema::load(&schema_path).expect_err("expected allowedvalues container error");
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
fn preserves_numeric_precision_and_defines_temporal_ordering() {
    let directory = tempfile_dir("value-semantics");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.precise]
type = "integer"
allowedvalues = [ 9007199254740992 ]

[elements.mixed]
type = "integer"
max = 9007199254740992.0

[elements.nanValue]
type = "float"
allowedvalues = [ nan ]

[elements.nanRange]
type = "float"
min = 0.0

[elements.zero]
type = "float"
allowedvalues = [ -0.0 ]

[elements.instant]
type = "offset-date-time"
min = 2024-01-01T00:00:00Z
max = 2024-01-01T00:00:00Z

[elements.instantMember]
type = "offset-date-time"
allowedvalues = [ 2024-01-01T00:00:00Z ]

[elements.localMember]
type = "local-time"
allowedvalues = [ 12:00:00.1 ]

[elements.localDateTime]
type = "local-date-time"
max = 2024-01-01T00:00:00.100

[elements.localDate]
type = "local-date"
max = 2024-01-01

[elements.localTime]
type = "local-time"
max = 12:00:00.100
"#,
    );
    let valid_path = write_file(
        &directory,
        "valid.toml",
        r#"
precise = 9007199254740992
mixed = 9007199254740992
nanValue = nan
nanRange = 0.0
zero = 0.0
instant = 2023-12-31T19:00:00-05:00
instantMember = 2024-01-01T00:00:00+00:00
localMember = 12:00:00.100
localDateTime = 2024-01-01T00:00:00.100
localDate = 2024-01-01
localTime = 12:00:00.100
"#,
    );
    let invalid_path = write_file(
        &directory,
        "invalid.toml",
        r#"
precise = 9007199254740993
mixed = 9007199254740993
nanValue = 0.0
nanRange = nan
zero = 1.0
instant = 2024-01-01T00:00:00.001Z
instantMember = 2023-12-31T19:00:00-05:00
localMember = 12:00:00.101
localDateTime = 2024-01-01T00:00:00.101
localDate = 2024-01-02
localTime = 12:00:00.101
"#,
    );

    let schema = Schema::load(&schema_path).expect("load schema");
    let valid = schema.validate_file(&valid_path);
    assert!(
        valid.valid(),
        "expected valid value semantics: {:#?}",
        valid.errors
    );
    let invalid = schema.validate_file(&invalid_path);
    for path in [
        "$.precise",
        "$.mixed",
        "$.nanValue",
        "$.nanRange",
        "$.zero",
        "$.instant",
        "$.instantMember",
        "$.localMember",
        "$.localDateTime",
        "$.localDate",
        "$.localTime",
    ] {
        assert!(
            has_path(&invalid, path),
            "expected error at {path}: {:#?}",
            invalid.errors
        );
    }

    let malformed_path = write_file(
        &directory,
        "malformed.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
allowedvalues = [ 9007199254740993 ]
max = 9007199254740992.0
"#,
    );
    Schema::load(&malformed_path)
        .expect_err("imprecise allowed value comparison must fail at schema load");
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
fn rejects_non_scalar_schema_reference_metadata() {
    let directory = tempfile_dir("non-scalar-schema-reference-metadata");
    let document_path = write_file(
        &directory,
        "document.toml",
        r#"
[toml-schema]
location = ["schema.tosd"]
"#,
    );

    let error = schema_from_document(&document_path)
        .expect_err("expected non-scalar schema-reference metadata error");
    assert!(error.contains("must be a scalar value"), "{error}");
}

#[test]
fn cli_resolves_file_uri_and_enforces_document_schema_version() {
    let directory = tempfile_dir("cli-schema-reference-semantics");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.1"

[elements.title]
type = "string"
"#,
    );
    let file_uri = Url::from_file_path(&schema_path)
        .expect("schema file URI")
        .to_string();
    let cases = [
        (
            "file-uri-warning",
            r#"version = "1.0.0""#,
            file_uri.as_str(),
            0,
            "Warning: document expects TOML Schema version 1.0.0, but resolved schema uses 1.0.1",
        ),
        (
            "major-version-mismatch",
            r#"version = "2.0.0""#,
            file_uri.as_str(),
            2,
            "document expects TOML Schema major version 2.0.0, but resolved schema uses 1.0.1",
        ),
        (
            "unsupported-scheme",
            "",
            "https://example.com/schema.tosd",
            2,
            "unsupported schema location URI scheme: https",
        ),
        (
            "opaque-file-uri",
            "",
            "file:schema.tosd",
            2,
            "invalid file schema location",
        ),
        (
            "file-uri-query",
            "",
            "file:///schema.tosd?version=1",
            2,
            "invalid file schema location",
        ),
    ];

    for (name, version, location, expected_code, expected_error) in cases {
        let document_path = write_file(
            &directory,
            &format!("{name}.toml"),
            &format!(
                r#"
title = "Example"

[toml-schema]
{version}
location = {location:?}
"#
            ),
        );
        let (exit_code, _stdout, stderr) = capture(&["validate", document_path.to_str().unwrap()]);

        assert_eq!(exit_code, expected_code, "{name}: {stderr}");
        assert!(
            stderr.contains(expected_error),
            "expected {expected_error:?}, got {stderr:?}"
        );
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
    assert!(
        !schema_text.contains("default ="),
        "extraction must not invent defaults:\n{schema_text}"
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
fn validates_sibling_presence_rules_and_fixed_collection_children() {
    let directory = tempfile_dir("sibling-rules");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
    [toml-schema]
    version = "1.0.0"

    [types.source]
    type = "table"
    dependentrequired = { branch = [ "git" ], tag = [ "git" ] }
    mutuallyexclusive = [ [ "git", "path" ], [ "branch", "tag" ] ]
    exactlyone = [ [ "git", "path" ] ]

    [types.source.git]
    type = "string"
    optional = true
    [types.source.path]
    type = "string"
    optional = true
    [types.source.branch]
    type = "string"
    optional = true
    [types.source.tag]
    type = "string"
    optional = true

    [elements.source]
    type = "types.source"

    [elements.env]
    type = "collection"
    itemtype = "string"
    dependentrequired = { mode = [ "enabled" ] }
    [elements.env.mode]
    type = "string"
    optional = true
    [elements.env.enabled]
    type = "boolean"
    optional = true
    "#,
    );
    let schema = Schema::load(&schema_path).expect("load sibling-rule schema");

    let valid = toml::from_str(
        r#"
    [source]
    git = "https://example.invalid/repo"
    branch = "main"
    [env]
    mode = "strict"
    enabled = true
    dynamic = "value"
    "#,
    )
    .unwrap();
    assert!(schema.validate(&valid).valid());

    let invalid = toml::from_str(
        r#"
    [source]
    branch = "main"
    path = "../local"
    [env]
    mode = "strict"
    "#,
    )
    .unwrap();
    let result = schema.validate(&invalid);
    assert!(!result.valid());
    assert!(has_path(&result, "$.source.git"));
    assert!(has_path(&result, "$.env.enabled"));

    let malformed_cases = [
        ("empty-map", "dependentrequired = {}"),
        ("empty-deps", "dependentrequired = { a = [] }"),
        ("empty-groups", "mutuallyexclusive = []"),
        ("short-group", "exactlyone = [[ \"a\" ]]"),
        ("duplicate", "mutuallyexclusive = [[ \"a\", \"a\" ]]"),
        ("unknown", "exactlyone = [[ \"a\", \"missing\" ]]"),
    ];
    for (name, rule) in malformed_cases {
        let malformed = write_file(
            &directory,
            &format!("{name}.tosd"),
            &format!(
                r#"
    [toml-schema]
    version = "1.0.0"
    [elements.value]
    type = "table"
    {rule}
    [elements.value.a]
    type = "string"
    optional = true
    [elements.value.b]
    type = "string"
    optional = true
    "#
            ),
        );
        Schema::load(malformed).expect_err(name);
    }

    let wrong_applicability = write_file(
        &directory,
        "wrong-applicability.tosd",
        r#"
[toml-schema]
version = "1.0.0"
[elements.value]
type = "string"
dependentrequired = { a = [ "b" ] }
"#,
    );
    Schema::load(wrong_applicability).expect_err("sibling rule on scalar");

    let dynamic_operand = write_file(
        &directory,
        "dynamic-operand.tosd",
        r#"
[toml-schema]
version = "1.0.0"
[elements.value]
type = "collection"
itemtype = "string"
exactlyone = [[ "fixed", "dynamic" ]]
[elements.value.fixed]
type = "string"
optional = true
"#,
    );
    Schema::load(dynamic_operand).expect_err("dynamic collection key operand");
}

#[test]
fn validates_additive_allof_and_composed_closure() {
    let directory = tempfile_dir("allof");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
    [toml-schema]
    version = "1.0.0"

    [types.base]
    type = "table"
    [types.base.name]
    type = "string"
    minlength = 3

    [types.limits]
    type = "table"
    [types.limits.name]
    type = "string"
    pattern = "^[a-z]+$"
    [types.limits.count]
    type = "integer"

    [types.short]
    type = "string"
    maxlength = 4

    [types.keys]
    type = "collection"
    itemtype = "string"
    keypattern = "^x"

    [elements.package]
    type = "table"
    allof = [ "types.base", "types.limits" ]
    [elements.package.local]
    type = "boolean"

    [elements.score]
    type = "integer"
    min = 0
    allof = [ "integer" ]

    [elements.values]
    type = "collection"
    itemtype = "types.short"
    allof = [ "types.keys" ]
    "#,
    );
    let schema = Schema::load(&schema_path).expect("load allof schema");
    let valid = toml::from_str(
        r#"
    score = 2
    [package]
    name = "crate"
    count = 1
    local = true
    [values]
    xone = "four"
    "#,
    )
    .unwrap();
    assert!(schema.validate(&valid).valid());

    let invalid = toml::from_str(
        r#"
    score = -1
    [package]
    name = "A"
    count = 1
    unknown = true
    [values]
    bad = "longer"
    "#,
    )
    .unwrap();
    let result = schema.validate(&invalid);
    assert!(!result.valid());
    for path in [
        "$.score",
        "$.package.name",
        "$.package.unknown",
        "$.values.bad",
    ] {
        assert!(
            has_path(&result, path),
            "missing error at {path}: {:?}",
            result.errors
        );
    }

    for (name, allof, component) in [
        ("empty", "[]", ""),
        ("unknown", "[ \"types.missing\" ]", ""),
        (
            "incompatible",
            "[ \"types.other\" ]",
            "[types.other]\ntype = \"string\"",
        ),
        (
            "cycle",
            "[ \"types.other\" ]",
            "[types.other]\ntype = \"table\"\nallof = [ \"types.root\" ]",
        ),
    ] {
        let malformed = write_file(
            &directory,
            &format!("malformed-{name}.tosd"),
            &format!(
                r#"
    [toml-schema]
    version = "1.0.0"
    [types.root]
    type = "table"
    allof = {allof}
    {component}
    [elements.value]
    type = "types.root"
    "#
            ),
        );
        Schema::load(malformed).expect_err(name);
    }
}

#[test]
fn validates_recursive_uniqueitems_equality() {
    let directory = tempfile_dir("uniqueitems");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
    [toml-schema]
    version = "1.0.0"
    [elements.values]
    type = "array"
    itemtype = "any"
    uniqueitems = true
    "#,
    );
    let schema = Schema::load(&schema_path).expect("load uniqueitems schema");
    let valid: toml::Table = toml::from_str(
        r#"values = [1, 2.0, [1, 2], [2, 1], { id = 1, value = "a" }, { id = 1, value = "b" }]"#,
    )
    .unwrap();
    assert!(schema.validate(&valid).valid());

    for (name, document) in [
        ("numeric", "values = [1, 1.0]"),
        ("zero", "values = [0.0, -0.0]"),
        ("nan", "values = [nan, nan]"),
        ("nested", "values = [[1, 2], [1, 2]]"),
        (
            "tables",
            "values = [{ a = 1, b = 2 }, { b = 2.0, a = 1.0 }]",
        ),
        (
            "temporal",
            "values = [1979-05-27T07:32:00Z, 1979-05-27T07:32:00+00:00]",
        ),
    ] {
        let parsed: toml::Table = toml::from_str(document).unwrap();
        assert!(
            !schema.validate(&parsed).valid(),
            "{name} duplicates should be rejected"
        );
    }

    for (name, definition) in [
        ("wrong-type", "type = \"string\"\nuniqueitems = true"),
        ("wrong-value", "type = \"array\"\nuniqueitems = \"yes\""),
    ] {
        let malformed = write_file(
            &directory,
            &format!("{name}.tosd"),
            &format!("[toml-schema]\nversion = \"1.0.0\"\n[elements.value]\n{definition}\n"),
        );
        Schema::load(malformed).expect_err(name);
    }
}

#[test]
fn validates_and_exposes_defaults_without_mutation() {
    let directory = tempfile_dir("defaults");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
    [toml-schema]
    version = "1.0.0"

    [types.count]
    type = "integer"
    min = 1
    default = 2

    [types.options]
    type = "table"
    default = { enabled = true }
    [types.options.enabled]
    type = "boolean"

    [types.same]
    type = "integer"
    default = 2

    [elements.count]
    type = "types.count"
    default = 3
    [elements.options]
    type = "types.options"
    optional = true
    [elements.composed]
    type = "integer"
    allof = [ "types.count", "types.same" ]
    optional = true
    [elements.required]
    type = "string"
    [elements.text]
    type = "string"
    default = "text"
    optional = true
    [elements.ratio]
    type = "float"
    default = 1.5
    optional = true
    [elements.flag]
    type = "boolean"
    default = true
    optional = true
    [elements.when]
    type = "offset-date-time"
    default = 1979-05-27T07:32:00Z
    optional = true
    [elements.list]
    type = "array"
    itemtype = "integer"
    default = [ 1, 2 ]
    optional = true
    "#,
    );
    let schema = Schema::load(&schema_path).expect("load defaults schema");
    let count = schema.element_definition("count").unwrap();
    assert_eq!(
        schema.effective_default(count).unwrap(),
        Some(toml::Value::Integer(3))
    );
    let options = schema.element_definition("options").unwrap();
    assert!(matches!(
        schema.effective_default(options).unwrap(),
        Some(toml::Value::Table(_))
    ));

    let document: toml::Table = toml::from_str("count = 5\nrequired = \"present\"\n").unwrap();
    let before = document.clone();
    assert!(schema.validate(&document).valid());
    assert_eq!(document, before, "validation must not materialize defaults");
    let missing: toml::Table = toml::from_str("").unwrap();
    assert!(!schema.validate(&missing).valid());

    let invalid_default = write_file(
        &directory,
        "invalid-default.tosd",
        r#"
    [toml-schema]
    version = "1.0.0"
    [elements.value]
    type = "integer"
    min = 2
    default = 1
    "#,
    );
    Schema::load(invalid_default).expect_err("invalid default");

    let conflicting = write_file(
        &directory,
        "conflicting-default.tosd",
        r#"
    [toml-schema]
    version = "1.0.0"
    [types.a]
    type = "integer"
    default = 1
    [types.b]
    type = "integer"
    default = 2
    [elements.value]
    type = "integer"
    allof = [ "types.a", "types.b" ]
    "#,
    );
    Schema::load(conflicting).expect_err("conflicting inherited defaults");

    let resolved_conflict = write_file(
        &directory,
        "resolved-default-conflict.tosd",
        r#"
[toml-schema]
version = "1.0.0"
[types.a]
type = "integer"
default = 1
[types.b]
type = "integer"
default = 2
[elements.value]
type = "integer"
allof = [ "types.a", "types.b" ]
default = 3
"#,
    );
    Schema::load(resolved_conflict).expect("local default resolves inherited conflict");
}

#[test]
fn emits_deprecation_warnings_only_for_successful_definitions() {
    let directory = tempfile_dir("deprecated");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
    [toml-schema]
    version = "1.0.0"
    [types.old]
    type = "string"
    deprecated = true
    [types.number]
    type = "integer"
    [types.oldNumber]
    type = "integer"
    deprecated = true
    [types.composed]
    type = "string"
    allof = [ "types.old" ]
    [elements.direct]
    type = "string"
    deprecated = true
    optional = true
    [elements.reference]
    type = "types.old"
    optional = true
    [elements.composed]
    type = "types.composed"
    optional = true
    [elements.choice]
    oneof = [ "types.old", "types.number" ]
    optional = true
    [elements.any]
    anyof = [ "types.old", "types.composed" ]
    optional = true
    [elements.current]
    type = "string"
    deprecated = false
    optional = true
    "#,
    );
    let schema = Schema::load(&schema_path).expect("load deprecated schema");
    let document_path = write_file(
        &directory,
        "document.toml",
        "direct = \"x\"\nreference = \"x\"\ncomposed = \"x\"\nchoice = 1\nany = \"x\"\ncurrent = \"x\"\n",
    );
    let result = schema.validate_file(&document_path);
    assert!(result.valid());
    let warning_paths: Vec<&str> = result
        .warnings()
        .iter()
        .map(|warning| warning.path.as_str())
        .collect();
    assert_eq!(
        warning_paths,
        ["$.any", "$.composed", "$.direct", "$.reference"]
    );
    assert!(result
        .warnings()
        .iter()
        .all(|warning| warning.code == "deprecated"));

    let (exit, stdout, stderr) = capture(&[
        "validate",
        schema_path.to_str().unwrap(),
        document_path.to_str().unwrap(),
    ]);
    assert_eq!(exit, 0);
    assert!(stdout.contains("is valid"));
    assert!(stderr.contains("warning [deprecated]"));

    let invalid: toml::Table = toml::from_str("direct = 1\n").unwrap();
    let invalid_result = schema.validate(&invalid);
    assert!(!invalid_result.valid());
    assert!(invalid_result.warnings().is_empty());
}

#[test]
fn rejects_malformed_annotation_values() {
    let directory = tempfile_dir("malformed-annotation-values");
    for (name, property) in [
        ("deprecated", "deprecated = \"yes\""),
        ("default", "type = \"integer\"\ndefault = \"wrong\""),
        ("allof-any", "allof = [ \"any\" ]"),
        ("allof-shape", "allof = \"string\""),
    ] {
        let schema_path = write_file(
                &directory,
                &format!("{name}.tosd"),
                &format!(
                    "[toml-schema]\nversion = \"1.0.0\"\n[elements.value]\ntype = \"string\"\n{property}\n"
                ),
            );
        Schema::load(schema_path).expect_err(name);
    }
}

#[test]
fn distinguishes_inline_default_from_child_definition() {
    let directory = tempfile_dir("default-syntax");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.bounds]
type = "table"
default = { min = 1, max = 10 }
[types.bounds.min]
type = "integer"
[types.bounds.max]
type = "integer"

[elements.limits]
type = "types.bounds"
optional = true

[elements.holder]
type = "table"
[elements.holder.default]
type = "integer"
min = 1
"#,
    );
    let schema = Schema::load(&schema_path).expect("load default-syntax schema");

    let limits = schema
        .element_definition("limits")
        .expect("limits element definition");
    let inline_default = schema
        .effective_default(limits)
        .expect("effective default")
        .expect("inline default is an annotation property");
    let inline_default = inline_default
        .as_table()
        .expect("inline default is a table value");
    assert_eq!(inline_default.get("min"), Some(&toml::Value::Integer(1)));
    assert_eq!(inline_default.get("max"), Some(&toml::Value::Integer(10)));

    let holder = schema
        .element_definition("holder")
        .expect("holder element definition");
    assert!(
        schema
            .effective_default(holder)
            .expect("no default")
            .is_none(),
        "a child table named default must not become the default annotation"
    );

    let valid: toml::Table = toml::from_str("[holder]\ndefault = 4\n").unwrap();
    assert!(
        schema.validate(&valid).valid(),
        "child table named default must validate document keys"
    );
    let invalid: toml::Table = toml::from_str("[holder]\ndefault = 0\n").unwrap();
    let result = schema.validate(&invalid);
    assert!(!result.valid());
    assert!(has_path(&result, "$.holder.default"));

    let inline_conflict = write_file(
        &directory,
        "inline-conflict.tosd",
        r#"
[toml-schema]
version = "1.0.0"
[elements.limits]
type = "table"
default = { min = "one" }
[elements.limits.min]
type = "integer"
"#,
    );
    let error =
        Schema::load(inline_conflict).expect_err("inline default must be validated as a value");
    assert!(
        error.contains("invalid effective default"),
        "unexpected error: {error}"
    );
}

#[test]
fn allows_composed_collection_item_constraints() {
    let directory = tempfile_dir("composed-collection-itemtype");
    let schema_path = write_file(
        &directory,
        "schema.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.entries]
type = "collection"
itemtype = "string"

[types.prefixed]
type = "collection"
keypattern = "^x"
allof = [ "types.entries" ]

[elements.values]
type = "collection"
allof = [ "types.entries" ]
"#,
    );
    let schema = Schema::load(&schema_path).expect("composed itemtype should load");

    let valid: toml::Table = toml::from_str("[values]\nfirst = \"one\"\n").unwrap();
    assert!(
        schema.validate(&valid).valid(),
        "composed itemtype should accept matching entries"
    );

    let invalid: toml::Table = toml::from_str("[values]\nfirst = 1\n").unwrap();
    let result = schema.validate(&invalid);
    assert!(!result.valid());
    assert!(has_path(&result, "$.values.first"));

    let missing = write_file(
        &directory,
        "missing-itemtype.tosd",
        r#"
[toml-schema]
version = "1.0.0"

[types.keys]
type = "collection"
allof = [ "types.other" ]

[types.other]
type = "collection"
allof = [ "types.keys" ]

[elements.values]
type = "types.keys"
"#,
    );
    Schema::load(missing).expect_err("no component supplies an itemtype");

    let local_only = write_file(
        &directory,
        "no-itemtype.tosd",
        r#"
[toml-schema]
version = "1.0.0"
[elements.values]
type = "collection"
"#,
    );
    Schema::load(local_only).expect_err("collection without itemtype or allof");
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
    let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("test-workspaces")
        .join(format!(
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
