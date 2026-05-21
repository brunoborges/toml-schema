//! Vocabulary conformance guard against `toml-schema.abnf`. Mirrors the Java
//! `AbnfConformanceTest` and ensures the Rust implementation's schema keys and
//! built-in types stay aligned with the published grammar.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use toml_schema::schema::{SchemaType, DEFINITION_KEYS};

const NON_SCHEMA_KEYS: &[&str] = &["version"];

fn abnf_path() -> PathBuf {
    let from_repository_root = Path::new("toml-schema.abnf");
    if from_repository_root.exists() {
        return from_repository_root.to_path_buf();
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repository root")
        .join("toml-schema.abnf")
}

fn read_abnf() -> String {
    fs::read_to_string(abnf_path()).expect("read toml-schema.abnf")
}

fn rule_expression(rule: &str, abnf: &str) -> String {
    let mut expression = String::new();
    let mut in_rule = false;
    for line in abnf.lines() {
        if line.starts_with(&format!("{rule} =")) {
            let value = line.split_once('=').map(|(_, right)| right.trim()).unwrap_or("");
            expression.push_str(value);
            in_rule = true;
            continue;
        }
        if in_rule {
            if line.starts_with(' ') || line.starts_with('\t') {
                expression.push(' ');
                expression.push_str(line.trim());
                continue;
            }
            break;
        }
    }
    expression
}

fn alternatives_for(rule: &str, abnf: &str) -> BTreeSet<String> {
    rule_expression(rule, abnf)
        .split('/')
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .filter(|token| !NON_SCHEMA_KEYS.contains(&token.as_str()))
        .collect()
}

fn built_in_type_tokens(abnf: &str) -> BTreeSet<String> {
    let pattern = Regex::new(r#";\s*"([^"]+)""#).expect("compile token pattern");
    abnf.lines()
        .filter_map(|line| pattern.captures(line).map(|captures| captures[1].to_string()))
        .filter(|token| {
            DEFINITION_KEYS
                .iter()
                .all(|definition_key| *definition_key != token.as_str())
        })
        .collect()
}

#[test]
fn schema_loader_definition_keys_match_abnf_schema_keys() {
    let abnf = read_abnf();
    let expected = alternatives_for("schema-key", &abnf);
    let actual: BTreeSet<String> = DEFINITION_KEYS.iter().map(|key| key.to_string()).collect();
    assert_eq!(actual, expected);
}

#[test]
fn schema_types_match_abnf_built_in_types() {
    let abnf = read_abnf();
    let mut implementation_types: BTreeSet<String> = [
        SchemaType::Any,
        SchemaType::String,
        SchemaType::Integer,
        SchemaType::Float,
        SchemaType::Boolean,
        SchemaType::OffsetDateTime,
        SchemaType::LocalDateTime,
        SchemaType::LocalDate,
        SchemaType::LocalTime,
        SchemaType::Array,
        SchemaType::Table,
        SchemaType::Collection,
    ]
    .iter()
    .map(|schema_type| schema_type.schema_name().to_string())
    .collect();
    // The collection type accepts "table-collection" as a legacy alias in the
    // ABNF, matching the Java reference implementation's assertion.
    implementation_types.insert("table-collection".to_string());
    assert_eq!(implementation_types, built_in_type_tokens(&abnf));
}
