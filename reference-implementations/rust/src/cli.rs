//! Command-line front-end shared by the binary and the integration tests.

use std::fs;
use std::io::Write;
use std::path::Path;

use crate::extract::generate_schema;
use crate::schema::{schema_from_document, Schema, ValidationResult};

/// Executes a single CLI invocation. Returns the desired process exit code
/// (`0` on success, `1` for validation failures, `2` for usage/IO errors).
pub fn run(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> u8 {
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        usage(out);
        return 0;
    }
    match args[0].as_str() {
        "validate" => match args.len() {
            2 => validate_with_embedded_schema(&args[1], out, err),
            3 => validate_explicit(&args[1], &args[2], out, err),
            _ => {
                usage(err);
                2
            }
        },
        "extract" => {
            if args.len() != 3 {
                usage(err);
                return 2;
            }
            extract(&args[1], &args[2], out, err)
        }
        unknown => {
            let _ = writeln!(err, "Unknown command: {unknown}");
            usage(err);
            2
        }
    }
}

fn validate_with_embedded_schema(
    document_path: &str,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    match schema_from_document(document_path) {
        Ok((schema, document)) => report(schema.validate(&document), document_path, out, err),
        Err(error) => {
            let _ = writeln!(err, "{error}");
            2
        }
    }
}

fn validate_explicit(
    schema_path: &str,
    document_path: &str,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    match Schema::load(schema_path) {
        Ok(schema) => report(schema.validate_file(document_path), document_path, out, err),
        Err(error) => {
            let _ = writeln!(err, "{error}");
            2
        }
    }
}

fn extract(
    document_path: &str,
    schema_path: &str,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let path = Path::new(document_path);
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) => {
            let _ = writeln!(err, "{}: {}", path.display(), error);
            return 1;
        }
    };
    let document: toml::Table = match toml::from_str(&content) {
        Ok(table) => table,
        Err(error) => {
            let _ = writeln!(err, "{}: {}", path.display(), error);
            return 1;
        }
    };
    let schema_text = generate_schema(&document);
    if let Err(error) = fs::write(schema_path, schema_text) {
        let _ = writeln!(err, "{schema_path}: {error}");
        return 2;
    }
    let _ = writeln!(out, "Extracted schema to {schema_path}");
    0
}

fn report(
    result: ValidationResult,
    document_path: &str,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    if result.valid() {
        let _ = writeln!(out, "{document_path} is valid");
        return 0;
    }
    let _ = writeln!(err, "{document_path} is invalid:");
    for error in &result.errors {
        let _ = writeln!(err, "  - {}: {}", error.path, error.message);
    }
    1
}

fn usage(stream: &mut dyn Write) {
    let _ = writeln!(stream, "Usage:");
    let _ = writeln!(stream, "  toml-schema validate <schema.tosd> <document.toml>");
    let _ = writeln!(stream, "  toml-schema validate <document.toml>");
    let _ = writeln!(stream, "  toml-schema extract <document.toml> <schema.tosd>");
}
