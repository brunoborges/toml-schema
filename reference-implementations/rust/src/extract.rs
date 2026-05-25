//! Schema extraction: turns a sample TOML document into a starter `.tosd`
//! schema. Mirrors the Java and Go implementations.

use std::fmt::Write as _;

use toml::value::Datetime;
use toml::{Table, Value};

use crate::schema::{encode_path_key, SchemaType, CURRENT_TOML_SCHEMA_VERSION};

/// Renders a TOML Schema document as a TOML string from the parsed sample document. Keys
/// are emitted in the natural order of the parsed [`Table`] (which is sorted
/// because the `toml` crate uses a `BTreeMap` by default).
pub fn generate_schema(document: &Table) -> String {
    let mut schema = String::new();
    schema.push_str("[toml-schema]\n");
    writeln!(schema, "version = \"{CURRENT_TOML_SCHEMA_VERSION}\"\n").expect("write to String");
    schema.push_str("[elements]\n");
    for (key, value) in document.iter() {
        if key == "toml-schema" {
            continue;
        }
        append_definition(&mut schema, &["elements", key], value);
    }
    schema
}

fn append_definition(schema: &mut String, path: &[&str], value: &Value) {
    schema.push_str("\n[");
    for (index, part) in path.iter().enumerate() {
        if index > 0 {
            schema.push('.');
        }
        schema.push_str(&encode_toml_key(part));
    }
    schema.push_str("]\n");
    let type_name = schema_type_of(value);
    writeln!(schema, "type = \"{}\"", type_name.schema_name()).expect("write to String");
    if type_name == SchemaType::Array {
        if let Value::Array(array) = value {
            writeln!(
                schema,
                "arraytype = \"{}\"",
                infer_array_type(array).schema_name()
            )
            .expect("write to String");
        }
    }
    if let Value::Table(table) = value {
        for (child_key, child_value) in table.iter() {
            let mut child_path: Vec<&str> = path.iter().copied().collect();
            child_path.push(child_key);
            append_definition(schema, &child_path, child_value);
        }
    }
}

fn schema_type_of(value: &Value) -> SchemaType {
    match value {
        Value::String(_) => SchemaType::String,
        Value::Integer(_) => SchemaType::Integer,
        Value::Float(_) => SchemaType::Float,
        Value::Boolean(_) => SchemaType::Boolean,
        Value::Datetime(datetime) => schema_type_of_datetime(datetime),
        Value::Array(_) => SchemaType::Array,
        Value::Table(_) => SchemaType::Table,
    }
}

fn schema_type_of_datetime(datetime: &Datetime) -> SchemaType {
    match (
        datetime.date.is_some(),
        datetime.time.is_some(),
        datetime.offset.is_some(),
    ) {
        (true, true, true) => SchemaType::OffsetDateTime,
        (true, true, false) => SchemaType::LocalDateTime,
        (true, false, false) => SchemaType::LocalDate,
        (false, true, false) => SchemaType::LocalTime,
        _ => SchemaType::Any,
    }
}

fn infer_array_type(array: &[Value]) -> SchemaType {
    let Some(first) = array.first() else {
        return SchemaType::Any;
    };
    let first_type = schema_type_of(first);
    for item in &array[1..] {
        if schema_type_of(item) != first_type {
            return SchemaType::Any;
        }
    }
    first_type
}

fn encode_toml_key(key: &str) -> String {
    if !key.is_empty()
        && key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return key.to_string();
    }
    // Reuse the path-key encoder because it produces TOML-compatible quoted keys.
    encode_path_key(key)
}
