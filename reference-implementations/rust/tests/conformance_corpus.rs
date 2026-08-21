//! Executes the shared conformance corpus (`conformance/` at the repository
//! root) against the Rust reference implementation.
//!
//! Each manifest case declares an `expect` outcome:
//!
//! - `schema-load-error` — loading the schema MUST fail.
//! - `validation-failure` — the schema loads and the document reports errors.
//! - `valid` — the schema loads and (when present) the document validates
//!   with no errors. Warnings are permitted.
//!
//! Load failure and validation failure are kept distinct: a `validation-failure`
//! case that fails to load is a mismatch, not a pass.

use std::path::{Path, PathBuf};

use toml::Value;
use toml_schema::schema::Schema;

fn repository_root() -> PathBuf {
    // Walk up from this crate's directory until we find `conformance/`.
    let mut dir = Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf();
    loop {
        if dir.join("conformance").join("manifest.toml").is_file() {
            return dir;
        }
        if !dir.pop() {
            panic!("could not locate repository root containing conformance/manifest.toml");
        }
    }
}

fn outcome_for_case(case_dir: &Path, has_document: bool) -> (String, String) {
    let schema_path = case_dir.join("schema.tosd");
    let schema = match Schema::load(&schema_path) {
        Ok(schema) => schema,
        Err(error) => return ("schema-load-error".to_string(), error),
    };

    if !has_document {
        return ("valid".to_string(), String::new());
    }

    let document_path = case_dir.join("document.toml");
    let result = schema.validate_file(&document_path);
    if result.valid() {
        ("valid".to_string(), String::new())
    } else {
        let messages: Vec<String> = result
            .errors()
            .iter()
            .map(|error| format!("{}: {}", error.path, error.message))
            .collect();
        ("validation-failure".to_string(), messages.join("; "))
    }
}

#[test]
fn conformance_corpus() {
    let root = repository_root();
    let conformance = root.join("conformance");
    let manifest_text =
        std::fs::read_to_string(conformance.join("manifest.toml")).expect("read manifest.toml");
    let manifest: Value = toml::from_str(&manifest_text).expect("parse manifest.toml");

    let cases = manifest
        .get("case")
        .and_then(Value::as_array)
        .expect("manifest [[case]] array");

    let mut mismatches: Vec<String> = Vec::new();
    let mut total = 0usize;

    for case in cases {
        let id = case
            .get("id")
            .and_then(Value::as_str)
            .expect("case id");
        let expect = case
            .get("expect")
            .and_then(Value::as_str)
            .expect("case expect");
        let has_document = case
            .get("document")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        total += 1;
        let case_dir = conformance.join("cases").join(id);
        let (actual, detail) = outcome_for_case(&case_dir, has_document);
        if actual != expect {
            mismatches.push(format!(
                "  {id}: expected {expect}, got {actual}\n      detail: {detail}"
            ));
        }
    }

    if !mismatches.is_empty() {
        panic!(
            "{} of {} conformance cases mismatched:\n{}",
            mismatches.len(),
            total,
            mismatches.join("\n")
        );
    }
}
