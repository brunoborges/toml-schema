//! Rust reference implementation for TOML Schema Definition (TOSD).
//!
//! See `REFERENCE_IMPLEMENTATIONS.md` and `SPEC.md` at the repository root for the
//! TOSD language and the conformance expectations every reference implementation
//! must meet.

pub mod cli;
pub mod extract;
pub mod schema;

pub use schema::{
    Definition, Schema, SchemaType, ValidationError, ValidationResult, DEFINITION_KEYS,
};
