//! Rust reference implementation for TOML Schema.
//!
//! See `REFERENCE_IMPLEMENTATIONS.md` and `SPEC.md` at the repository root for the
//! TOML Schema language and the conformance expectations every reference implementation
//! must meet.

pub mod cli;
pub mod extract;
pub mod schema;

pub use schema::{
    resolve_schema_from_document, schema_from_document, Definition, DocumentSchemaResolution,
    Schema, SchemaType, ValidationError, ValidationResult, DEFINITION_KEYS,
};
