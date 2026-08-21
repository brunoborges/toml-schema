use std::fs;
use std::path::{Path, PathBuf};

use toml_schema::schema::Schema;

fn workspace(name: &str) -> PathBuf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("test-workspaces")
        .join(format!("resolved-duplicates-{name}-{}", std::process::id()));
    fs::create_dir_all(&path).expect("create test workspace");
    path
}

fn write(directory: &Path, name: &str, content: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, content).expect("write fixture");
    path
}

#[test]
fn rejects_duplicate_composition_references_by_resolved_identity() {
    let directory = workspace("negative");
    for property in ["oneof", "anyof", "allof"] {
        let local_type = if property == "allof" {
            "type = \"string\"\n"
        } else {
            ""
        };
        let schema_path = write(
            &directory,
            &format!("{property}.tosd"),
            &format!(
                r#"[toml-schema]
version = "1.0.0"

[types.foo]
type = "string"

[elements.value]
{local_type}{property} = ["types.foo", "foo"]
"#
            ),
        );

        let error = Schema::load(schema_path).expect_err("duplicate reference must fail to load");
        assert_eq!(error.code, "duplicate-reference");
        assert_eq!(
            error.message,
            format!(
                "elements.value {property} contains duplicate type references \"types.foo\" and \"foo\"; both resolve to foo"
            )
        );
    }
}

#[test]
fn allows_repeated_tuple_item_references() {
    let directory = workspace("tuple");
    let schema_path = write(
        &directory,
        "tuple.tosd",
        r#"[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[elements.point]
type = "array"
items = ["types.coordinate", "types.coordinate"]
"#,
    );
    let document_path = write(&directory, "tuple.toml", "point = [1.0, 2.0]\n");

    let schema = Schema::load(schema_path).expect("repeated tuple items must load");
    let result = schema.validate_file(document_path).expect("document parses as TOML");
    assert!(result.valid(), "{:?}", result.errors);
}
