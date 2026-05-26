//! Schema model, loader, and validator for TOML Schema documents.
//!
//! The implementation mirrors the Go and Java reference implementations: a TOML Schema
//! file is parsed as a TOML document, top-level `[types]` and `[elements]`
//! tables are decoded into [`Definition`] values, and a [`Schema`] can validate
//! a parsed TOML document against those definitions.

use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use toml::value::{Datetime, Offset};
use toml::{Table, Value};

/// Built-in TOML Schema types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SchemaType {
    Any,
    String,
    Integer,
    Float,
    Boolean,
    OffsetDateTime,
    LocalDateTime,
    LocalDate,
    LocalTime,
    Array,
    Table,
    Collection,
}

impl SchemaType {
    /// Returns the TOML Schema spelling for this type (e.g. `"offset-date-time"`).
    pub fn schema_name(&self) -> &'static str {
        match self {
            SchemaType::Any => "any",
            SchemaType::String => "string",
            SchemaType::Integer => "integer",
            SchemaType::Float => "float",
            SchemaType::Boolean => "boolean",
            SchemaType::OffsetDateTime => "offset-date-time",
            SchemaType::LocalDateTime => "local-date-time",
            SchemaType::LocalDate => "local-date",
            SchemaType::LocalTime => "local-time",
            SchemaType::Array => "array",
            SchemaType::Table => "table",
            SchemaType::Collection => "collection",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "any" => SchemaType::Any,
            "string" => SchemaType::String,
            "integer" => SchemaType::Integer,
            "float" => SchemaType::Float,
            "boolean" => SchemaType::Boolean,
            "offset-date-time" => SchemaType::OffsetDateTime,
            "local-date-time" => SchemaType::LocalDateTime,
            "local-date" => SchemaType::LocalDate,
            "local-time" => SchemaType::LocalTime,
            "array" => SchemaType::Array,
            "table" => SchemaType::Table,
            "collection" => SchemaType::Collection,
            _ => return None,
        })
    }

    fn is_range_comparable(&self) -> bool {
        matches!(
            self,
            SchemaType::Integer
                | SchemaType::Float
                | SchemaType::OffsetDateTime
                | SchemaType::LocalDateTime
                | SchemaType::LocalDate
                | SchemaType::LocalTime
        )
    }
}

impl fmt::Display for SchemaType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.schema_name())
    }
}

/// The set of TOML Schema properties recognised by this implementation. The
/// keys are checked against the ABNF grammar in tests.
pub const DEFINITION_KEYS: &[&str] = &[
    "type",
    "typeof",
    "arraytype",
    "itemtype",
    "items",
    "allowedvalues",
    "pattern",
    "optional",
    "default",
    "min",
    "max",
    "minlength",
    "maxlength",
    "minoccurs",
    "maxoccurs",
    "oneof",
    "anyof",
    "children",
];

pub const CURRENT_TOML_SCHEMA_VERSION: &str = "1.0.0";

fn is_definition_key(key: &str) -> bool {
    DEFINITION_KEYS.contains(&key)
}

/// A single TOML Schema definition (either a reusable `[types.*]` entry or an
/// `[elements.*]` entry).
#[derive(Debug, Clone, Default)]
pub struct Definition {
    name: String,
    type_name: Option<SchemaType>,
    reference: Option<String>,
    array_type: Option<SchemaType>,
    item_reference: Option<String>,
    items: Vec<String>,
    optional: bool,
    allowed_values: Vec<Value>,
    pattern: Option<Regex>,
    min: Option<Value>,
    max: Option<Value>,
    min_length: Option<i64>,
    max_length: Option<i64>,
    one_of: Vec<String>,
    any_of: Vec<String>,
    children: BTreeMap<String, Definition>,
}

/// A single validation error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub path: String,
    pub message: String,
}

/// Result of validating a document against a schema.
#[derive(Debug, Clone, Default)]
pub struct ValidationResult {
    pub errors: Vec<ValidationError>,
}

impl ValidationResult {
    pub fn valid(&self) -> bool {
        self.errors.is_empty()
    }
}

/// A loaded TOML Schema document.
#[derive(Debug, Clone)]
pub struct Schema {
    source: PathBuf,
    types: BTreeMap<String, Definition>,
    elements: BTreeMap<String, Definition>,
}

impl Schema {
    /// Loads a TOML Schema document from a filesystem path.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let path = path.as_ref();
        let parsed = parse_toml_file(path)
            .map_err(|error| format!("unable to parse schema {}: {}", path.display(), error))?;
        Self::from_table(path.to_path_buf(), parsed)
    }

    /// Builds a schema from an already-parsed TOML Schema root table.
    pub fn from_table(source: PathBuf, table: Table) -> Result<Self, String> {
        if !matches!(table.get("toml-schema"), Some(Value::Table(_))) {
            return Err("schema must contain a [toml-schema] table".to_string());
        }
        if !matches!(table.get("elements"), Some(Value::Table(_))) {
            return Err("schema must contain an [elements] table".to_string());
        }
        for key in table.keys() {
            if key != "toml-schema" && key != "types" && key != "elements" {
                return Err(format!("unsupported top-level schema key: {key}"));
            }
        }
        let metadata = table
            .get("toml-schema")
            .and_then(Value::as_table)
            .expect("checked above");
        let version = metadata
            .get("version")
            .ok_or_else(|| "[toml-schema] must contain version".to_string())?;
        Self::validate_schema_version(version)?;
        for key in metadata.keys() {
            if key != "version" && key != "meta" {
                return Err(format!("unsupported [toml-schema] key: {key}"));
            }
        }
        let types_table = table.get("types").and_then(Value::as_table);
        let elements_table = table.get("elements").and_then(Value::as_table);
        let types = parse_definitions("types", types_table, false)?;
        let elements = parse_definitions("elements", elements_table, true)?;
        Ok(Schema {
            source,
            types,
            elements,
        })
    }

    /// Returns the path the schema was loaded from.
    pub fn source(&self) -> &Path {
        &self.source
    }

    fn validate_schema_version(value: &Value) -> Result<(), String> {
        let Some(version) = value.as_str() else {
            return Err("[toml-schema].version must be a SemVer string".to_string());
        };
        let semver = Regex::new(
            r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
        )
        .expect("valid SemVer regex");
        let Some(captures) = semver.captures(version) else {
            return Err("[toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax".to_string());
        };
        if captures.get(1).map(|major| major.as_str()) != Some("1") {
            return Err(format!("unsupported TOML Schema major version: {version}"));
        }
        if captures.get(2).map(|minor| minor.as_str()) != Some("0") {
            return Err(format!("unsupported TOML Schema minor version: {version}"));
        }
        Ok(())
    }

    /// Validates the TOML document at `path` against this schema.
    pub fn validate_file<P: AsRef<Path>>(&self, path: P) -> ValidationResult {
        let path = path.as_ref();
        match parse_toml_file(path) {
            Ok(table) => self.validate(&table),
            Err(error) => ValidationResult {
                errors: vec![ValidationError {
                    path: "$".to_string(),
                    message: error,
                }],
            },
        }
    }

    /// Validates an already-parsed TOML document against this schema.
    pub fn validate(&self, document: &Table) -> ValidationResult {
        let mut validator = Validator::new(self);
        validator.validate_table("$", document, &self.elements);
        for key in document.keys() {
            if !self.elements.contains_key(key) && key != "toml-schema" {
                validator.add(&append_path("$", key), "unexpected key");
            }
        }
        ValidationResult {
            errors: validator.errors,
        }
    }
}

/// Loads a TOML Schema document referenced by a TOML document via
/// `[toml-schema].location` and returns the schema together with the parsed
/// document.
pub fn schema_from_document<P: AsRef<Path>>(
    document_path: P,
) -> Result<(Schema, Table), String> {
    let document_path = document_path.as_ref();
    let document = parse_toml_file(document_path)?;
    let metadata = document
        .get("toml-schema")
        .and_then(Value::as_table)
        .ok_or_else(|| "document does not contain [toml-schema].location".to_string())?;
    let location = metadata
        .get("location")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|location| !location.is_empty())
        .ok_or_else(|| "document does not contain [toml-schema].location".to_string())?;
    let directory = document_path.parent().unwrap_or_else(|| Path::new("."));
    let schema_path = directory.join(location);
    let schema = Schema::load(&schema_path)?;
    Ok((schema, document))
}

fn parse_toml_file(path: &Path) -> Result<Table, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("{}: {}", path.display(), error))?;
    toml::from_str::<Table>(&content)
        .map_err(|error| format!("{}: {}", path.display(), error))
}

fn parse_definitions(
    prefix: &str,
    table: Option<&Table>,
    required: bool,
) -> Result<BTreeMap<String, Definition>, String> {
    let Some(table) = table else {
        if required {
            return Err(format!("missing required [{prefix}] table"));
        }
        return Ok(BTreeMap::new());
    };
    let mut definitions = BTreeMap::new();
    for (key, value) in table.iter() {
        if prefix == "types" && SchemaType::parse(key).is_some() {
            return Err(format!("[types.{key}] uses a reserved built-in type name"));
        }
        let value_map = value.as_table();
        if key == "children"
            && value_map
                .map(|child_table| !has_definition_marker(child_table))
                .unwrap_or(false)
        {
            for (child_key, child_value) in value_map.unwrap().iter() {
                let child_map = child_value.as_table().ok_or_else(|| {
                    format!("[{prefix}.children] entry must be a table: {child_key}")
                })?;
                let definition =
                    parse_definition(&format!("{prefix}.{child_key}"), child_map)?;
                definitions.insert(child_key.clone(), definition);
            }
            continue;
        }
        let value_map = value_map
            .ok_or_else(|| format!("[{prefix}] entry must be a table: {key}"))?;
        let definition = parse_definition(&format!("{prefix}.{key}"), value_map)?;
        definitions.insert(key.clone(), definition);
    }
    Ok(definitions)
}

fn parse_definition(name: &str, table: &Table) -> Result<Definition, String> {
    let type_name = get_schema_type(name, table, "type")?;
    let reference = get_string(name, table, "typeof")?;
    let array_type = get_schema_type(name, table, "arraytype")?;
    let item_reference = get_string(name, table, "itemtype")?;
    let items = get_string_array_values(name, table, "items")?;
    let optional = get_bool(name, table, "optional")?.unwrap_or(false);
    let pattern = get_pattern(name, table)?;
    let min_length = get_unsigned_integer(name, table, "minlength")?;
    let max_length = get_unsigned_integer(name, table, "maxlength")?;
    let min_occurs = get_unsigned_integer(name, table, "minoccurs")?;
    let max_occurs = get_unsigned_integer(name, table, "maxoccurs")?;
    let min_length = min_length.or(min_occurs);
    let max_length = max_length.or(max_occurs);
    let allowed_values = get_array_values(name, table, "allowedvalues")?;
    let one_of = get_string_array_values(name, table, "oneof")?;
    let any_of = get_string_array_values(name, table, "anyof")?;
    if !one_of.is_empty() && !any_of.is_empty() {
        return Err(format!("{name} cannot define both oneof and anyof"));
    }
    let mut children: BTreeMap<String, Definition> = BTreeMap::new();
    if let Some(Value::Table(explicit_children)) = table.get("children") {
        for (key, value) in explicit_children.iter() {
            let child_table = value.as_table().ok_or_else(|| {
                format!("{name}.children.{key} must be a table")
            })?;
            let child = parse_definition(&format!("{name}.{key}"), child_table)?;
            children.insert(key.clone(), child);
        }
    }
    for (key, value) in table.iter() {
        if let Some(child_table) = value.as_table() {
            if is_definition_key(key) {
                if key != "children" {
                    return Err(format!("{name}.{key} must not be a table"));
                }
                continue;
            }
            if children.contains_key(key) {
                return Err(format!("{name} defines child {key} more than once"));
            }
            let child = parse_definition(&format!("{name}.{key}"), child_table)?;
            children.insert(key.clone(), child);
        } else if !is_definition_key(key) {
            return Err(format!("{name} contains unsupported property: {key}"));
        }
    }
    if type_name.is_none()
        && reference.is_none()
        && one_of.is_empty()
        && any_of.is_empty()
    {
        return Err(format!(
            "{name} must define type, typeof, oneof, or anyof"
        ));
    }
    if type_name != Some(SchemaType::Array) && array_type.is_some() {
        return Err(format!(
            "{name} can only define arraytype when type is array"
        ));
    }
    if type_name != Some(SchemaType::Array) && item_reference.is_some() {
        return Err(format!(
            "{name} can only define itemtype when type is array"
        ));
    }
    if type_name != Some(SchemaType::Array) && !items.is_empty() {
        return Err(format!(
            "{name} can only define items when type is array"
        ));
    }
    if !items.is_empty() {
        if array_type.is_some() {
            return Err(format!("{name} cannot define both items and arraytype"));
        }
        if item_reference.is_some() {
            return Err(format!("{name} cannot define both items and itemtype"));
        }
        if min_length.is_some()
            || max_length.is_some()
            || min_occurs.is_some()
            || max_occurs.is_some()
        {
            return Err(format!(
                "{name} cannot define minlength, maxlength, minoccurs, or maxoccurs together with items"
            ));
        }
    }
    let min = table.get("min").cloned();
    let max = table.get("max").cloned();
    validate_range_constraints(
        name,
        type_name,
        array_type,
        item_reference.as_deref(),
        min.as_ref(),
        max.as_ref(),
    )?;
    let reference = reference.map(normalize_reference);
    Ok(Definition {
        name: name.to_string(),
        type_name,
        reference,
        array_type,
        item_reference: item_reference.map(normalize_reference),
        items: normalize_references(items),
        optional,
        allowed_values,
        pattern,
        min,
        max,
        min_length,
        max_length,
        one_of: normalize_references(one_of),
        any_of: normalize_references(any_of),
        children,
    })
}

fn validate_range_constraints(
    name: &str,
    type_name: Option<SchemaType>,
    array_type: Option<SchemaType>,
    item_reference: Option<&str>,
    min: Option<&Value>,
    max: Option<&Value>,
) -> Result<(), String> {
    if min.is_none() && max.is_none() {
        return Ok(());
    }
    if is_nan(min) {
        return Err(format!("{name} cannot use NaN as min"));
    }
    if is_nan(max) {
        return Err(format!("{name} cannot use NaN as max"));
    }
    if type_name == Some(SchemaType::Any) {
        return Err(format!("{name} cannot define min or max when type is any"));
    }
    if type_name == Some(SchemaType::Array) {
        if item_reference.is_some() {
            return Err(format!(
                "{name} cannot define min or max together with itemtype"
            ));
        }
        let item_type = array_type.unwrap_or(SchemaType::Any);
        if !item_type.is_range_comparable() {
            return Err(format!(
                "{name} can only define min or max for arrays with numeric or date/time arraytype"
            ));
        }
        return Ok(());
    }
    if let Some(type_name) = type_name {
        if !type_name.is_range_comparable() {
            return Err(format!(
                "{name} can only define min or max for integer, float, date/time, or compatible array types"
            ));
        }
    }
    Ok(())
}

struct Validator<'schema> {
    schema: &'schema Schema,
    errors: Vec<ValidationError>,
}

impl<'schema> Validator<'schema> {
    fn new(schema: &'schema Schema) -> Self {
        Self {
            schema,
            errors: Vec::new(),
        }
    }

    fn validate_table(
        &mut self,
        path: &str,
        table: &Table,
        definitions: &BTreeMap<String, Definition>,
    ) {
        for (key, definition) in definitions.iter() {
            let resolved = match self.resolve(definition, &mut HashSet::new()) {
                Ok(resolved) => resolved,
                Err(error) => {
                    self.add(&append_path(path, key), &error);
                    continue;
                }
            };
            let child_path = append_path(path, key);
            match table.get(key) {
                Some(value) => self.validate_value(&child_path, value, &resolved),
                None => {
                    if !resolved.optional {
                        self.add(&child_path, "required value is missing");
                    }
                }
            }
        }
    }

    fn validate_value(&mut self, path: &str, value: &Value, definition: &Definition) {
        let resolved = match self.resolve(definition, &mut HashSet::new()) {
            Ok(resolved) => resolved,
            Err(error) => {
                self.add(path, &error);
                return;
            }
        };
        if !resolved.one_of.is_empty() || !resolved.any_of.is_empty() {
            self.validate_union(path, value, &resolved);
            return;
        }
        let type_name = resolved.type_name.unwrap_or(SchemaType::Any);
        self.validate_type(path, value, type_name);
        if !value_matches_type(value, type_name) {
            return;
        }
        self.validate_common_constraints(path, value, &resolved);
        match type_name {
            SchemaType::Table => {
                if let Value::Table(table) = value {
                    self.validate_table_value(path, table, &resolved);
                }
            }
            SchemaType::Collection => {
                if let Value::Table(table) = value {
                    self.validate_collection(path, table, &resolved);
                }
            }
            SchemaType::Array => {
                if let Value::Array(array) = value {
                    self.validate_array(path, array, &resolved);
                }
            }
            _ => {}
        }
    }

    fn validate_union(&mut self, path: &str, value: &Value, definition: &Definition) {
        let alternatives = if !definition.one_of.is_empty() {
            &definition.one_of
        } else {
            &definition.any_of
        };
        let mut matches = 0usize;
        for reference in alternatives {
            let referenced = match self.resolve_reference(reference, &mut HashSet::new()) {
                Ok(referenced) => referenced,
                Err(error) => {
                    self.add(path, &error);
                    return;
                }
            };
            let mut candidate = Validator::new(self.schema);
            candidate.validate_value(path, value, &referenced);
            if candidate.errors.is_empty() {
                matches += 1;
            }
        }
        if !definition.one_of.is_empty() && matches != 1 {
            self.add(
                path,
                &format!("expected exactly one matching type from oneof but found {matches}"),
            );
        }
        if !definition.any_of.is_empty() && matches == 0 {
            self.add(path, "expected at least one matching type from anyof");
        }
    }

    fn validate_table_value(
        &mut self,
        path: &str,
        table: &Table,
        definition: &Definition,
    ) {
        if definition.children.is_empty() {
            return;
        }
        self.validate_table(path, table, &definition.children);
        for key in table.keys() {
            if !definition.children.contains_key(key) {
                self.add(&append_path(path, key), "unexpected key");
            }
        }
    }

    fn validate_collection(
        &mut self,
        path: &str,
        table: &Table,
        definition: &Definition,
    ) {
        let mut dynamic_entries = 0usize;
        for (key, value) in table.iter() {
            let child_path = append_path(path, key);
            if let Some(fixed_child) = definition.children.get(key) {
                self.validate_value(&child_path, value, fixed_child);
                continue;
            }
            dynamic_entries += 1;
            let reference = match definition.reference.as_deref() {
                Some(reference) => reference,
                None => {
                    self.add(&child_path, "collection entry has no typeof reference");
                    continue;
                }
            };
            match self.resolve_reference(reference, &mut HashSet::new()) {
                Ok(referenced) => self.validate_value(&child_path, value, &referenced),
                Err(error) => self.add(&child_path, &error),
            }
        }
        self.validate_length(path, dynamic_entries, definition);
        for (key, child) in definition.children.iter() {
            let resolved = match self.resolve(child, &mut HashSet::new()) {
                Ok(resolved) => resolved,
                Err(error) => {
                    self.add(&append_path(path, key), &error);
                    continue;
                }
            };
            if !table.contains_key(key) && !resolved.optional {
                self.add(&append_path(path, key), "required value is missing");
            }
        }
    }

    fn validate_array(&mut self, path: &str, array: &[Value], definition: &Definition) {
        self.validate_length(path, array.len(), definition);
        if !definition.items.is_empty() {
            self.validate_tuple_array(path, array, definition);
            return;
        }
        let array_type = definition.array_type.unwrap_or(SchemaType::Any);
        let item_definition = match definition.item_reference.as_deref() {
            Some(reference) => match self.resolve_reference(reference, &mut HashSet::new()) {
                Ok(referenced) => Some(referenced),
                Err(error) => {
                    self.add(path, &error);
                    return;
                }
            },
            None => None,
        };
        if array_type == SchemaType::Any && item_definition.is_none() {
            return;
        }
        for (index, item) in array.iter().enumerate() {
            let item_path = format!("{path}[{index}]");
            let mut matches_array_type = true;
            if array_type != SchemaType::Any {
                self.validate_type(&item_path, item, array_type);
                matches_array_type = value_matches_type(item, array_type);
            }
            if !matches_array_type {
                continue;
            }
            match &item_definition {
                Some(item_definition) => {
                    self.validate_value(&item_path, item, item_definition)
                }
                None => {
                    self.validate_allowed_values(&item_path, item, definition);
                    self.validate_range(&item_path, item, definition);
                }
            }
        }
    }

    fn validate_tuple_array(&mut self, path: &str, array: &[Value], definition: &Definition) {
        if array.len() != definition.items.len() {
            self.add(
                path,
                &format!(
                    "expected array length {} but found {}",
                    definition.items.len(),
                    array.len()
                ),
            );
        }
        let upper_bound = array.len().min(definition.items.len());
        for index in 0..upper_bound {
            let item_path = format!("{path}[{index}]");
            let referenced = match self.resolve_reference(&definition.items[index], &mut HashSet::new()) {
                Ok(referenced) => referenced,
                Err(error) => {
                    self.add(&item_path, &error);
                    continue;
                }
            };
            self.validate_value(&item_path, &array[index], &referenced);
        }
    }

    fn validate_type(&mut self, path: &str, value: &Value, type_name: SchemaType) {
        if !value_matches_type(value, type_name) {
            self.add(
                path,
                &format!(
                    "expected {} but found {}",
                    type_name,
                    type_name_of_value(value)
                ),
            );
        }
    }

    fn validate_common_constraints(
        &mut self,
        path: &str,
        value: &Value,
        definition: &Definition,
    ) {
        if let Value::Array(array) = value {
            self.validate_length(path, array.len(), definition);
            return;
        }
        self.validate_allowed_values(path, value, definition);
        self.validate_range(path, value, definition);
        if let Value::String(string_value) = value {
            self.validate_length(path, string_value.chars().count(), definition);
            if let Some(pattern) = &definition.pattern {
                if !matches_entire_string(pattern, string_value) {
                    self.add(
                        path,
                        &format!("does not match pattern {}", pattern.as_str()),
                    );
                }
            }
        }
    }

    fn validate_allowed_values(
        &mut self,
        path: &str,
        value: &Value,
        definition: &Definition,
    ) {
        if definition.allowed_values.is_empty() {
            return;
        }
        for allowed in &definition.allowed_values {
            if values_equal(allowed, value) {
                return;
            }
        }
        self.add(path, "value is not in allowedvalues");
    }

    fn validate_range(&mut self, path: &str, value: &Value, definition: &Definition) {
        if let Some(min) = &definition.min {
            match compare(value, min) {
                Ok(std::cmp::Ordering::Less) => self.add(path, "value is less than min"),
                Err(error) => self.add(path, &error),
                _ => {}
            }
        }
        if let Some(max) = &definition.max {
            match compare(value, max) {
                Ok(std::cmp::Ordering::Greater) => self.add(path, "value is greater than max"),
                Err(error) => self.add(path, &error),
                _ => {}
            }
        }
    }

    fn validate_length(&mut self, path: &str, length: usize, definition: &Definition) {
        let length = length as i64;
        if let Some(min_length) = definition.min_length {
            if length < min_length {
                self.add(path, "length is less than minlength");
            }
        }
        if let Some(max_length) = definition.max_length {
            if length > max_length {
                self.add(path, "length is greater than maxlength");
            }
        }
    }

    fn resolve(
        &self,
        definition: &Definition,
        seen: &mut HashSet<String>,
    ) -> Result<Definition, String> {
        if definition.reference.is_none() || definition.type_name == Some(SchemaType::Collection)
        {
            return Ok(definition.clone());
        }
        let reference = definition.reference.as_deref().unwrap();
        let referenced = self.resolve_reference(reference, seen)?;
        let type_name = definition.type_name.or(referenced.type_name);
        let merged_reference = if type_name == Some(SchemaType::Collection) {
            referenced.reference.clone()
        } else {
            None
        };
        let children = if definition.children.is_empty() {
            referenced.children.clone()
        } else {
            let mut merged = referenced.children.clone();
            for (key, child) in &definition.children {
                merged.insert(key.clone(), child.clone());
            }
            merged
        };
        Ok(Definition {
            name: definition.name.clone(),
            type_name,
            reference: merged_reference,
            array_type: definition.array_type.or(referenced.array_type),
            item_reference: definition
                .item_reference
                .clone()
                .or(referenced.item_reference.clone()),
            items: if definition.items.is_empty() {
                referenced.items.clone()
            } else {
                definition.items.clone()
            },
            optional: definition.optional || referenced.optional,
            allowed_values: if definition.allowed_values.is_empty() {
                referenced.allowed_values.clone()
            } else {
                definition.allowed_values.clone()
            },
            pattern: definition
                .pattern
                .clone()
                .or(referenced.pattern.clone()),
            min: definition.min.clone().or(referenced.min.clone()),
            max: definition.max.clone().or(referenced.max.clone()),
            min_length: definition.min_length.or(referenced.min_length),
            max_length: definition.max_length.or(referenced.max_length),
            one_of: if definition.one_of.is_empty() {
                referenced.one_of.clone()
            } else {
                definition.one_of.clone()
            },
            any_of: if definition.any_of.is_empty() {
                referenced.any_of.clone()
            } else {
                definition.any_of.clone()
            },
            children,
        })
    }

    fn resolve_reference(
        &self,
        reference: &str,
        seen: &mut HashSet<String>,
    ) -> Result<Definition, String> {
        let normalized = normalize_reference(reference.to_string());
        if let Some(type_name) = SchemaType::parse(&normalized) {
            return Ok(Definition {
                name: normalized,
                type_name: Some(type_name),
                ..Definition::default()
            });
        }
        if !seen.insert(normalized.clone()) {
            return Err(format!("cyclic type reference: {normalized}"));
        }
        let result = match self.schema.types.get(&normalized) {
            Some(definition) => self.resolve(definition, seen),
            None => Err(format!("unknown type reference: {reference}")),
        };
        seen.remove(&normalized);
        result
    }

    fn add(&mut self, path: &str, message: &str) {
        self.errors.push(ValidationError {
            path: path.to_string(),
            message: message.to_string(),
        });
    }
}

fn value_matches_type(value: &Value, type_name: SchemaType) -> bool {
    match type_name {
        SchemaType::Any => true,
        SchemaType::String => matches!(value, Value::String(_)),
        SchemaType::Integer => matches!(value, Value::Integer(_)),
        SchemaType::Float => matches!(value, Value::Float(_)),
        SchemaType::Boolean => matches!(value, Value::Boolean(_)),
        SchemaType::OffsetDateTime => {
            matches!(value, Value::Datetime(dt) if dt.date.is_some() && dt.time.is_some() && dt.offset.is_some())
        }
        SchemaType::LocalDateTime => {
            matches!(value, Value::Datetime(dt) if dt.date.is_some() && dt.time.is_some() && dt.offset.is_none())
        }
        SchemaType::LocalDate => {
            matches!(value, Value::Datetime(dt) if dt.date.is_some() && dt.time.is_none() && dt.offset.is_none())
        }
        SchemaType::LocalTime => {
            matches!(value, Value::Datetime(dt) if dt.date.is_none() && dt.time.is_some() && dt.offset.is_none())
        }
        SchemaType::Array => matches!(value, Value::Array(_)),
        SchemaType::Table | SchemaType::Collection => matches!(value, Value::Table(_)),
    }
}

fn type_name_of_value(value: &Value) -> &'static str {
    match value {
        Value::String(_) => "string",
        Value::Integer(_) => "integer",
        Value::Float(_) => "float",
        Value::Boolean(_) => "boolean",
        Value::Datetime(dt) => match (dt.date.is_some(), dt.time.is_some(), dt.offset.is_some()) {
            (true, true, true) => "offset-date-time",
            (true, true, false) => "local-date-time",
            (true, false, false) => "local-date",
            (false, true, false) => "local-time",
            _ => "datetime",
        },
        Value::Array(_) => "array",
        Value::Table(_) => "table",
    }
}

fn compare(value: &Value, boundary: &Value) -> Result<std::cmp::Ordering, String> {
    if let (Some(value_number), Some(boundary_number)) = (numeric(value), numeric(boundary)) {
        return Ok(value_number
            .partial_cmp(&boundary_number)
            .unwrap_or(std::cmp::Ordering::Equal));
    }
    if let (Value::Datetime(left), Value::Datetime(right)) = (value, boundary) {
        if let Some(ordering) = compare_datetimes(left, right) {
            return Ok(ordering);
        }
    }
    Err(format!(
        "cannot compare {} with boundary {}",
        type_name_of_value(value),
        type_name_of_value(boundary)
    ))
}

fn compare_datetimes(left: &Datetime, right: &Datetime) -> Option<std::cmp::Ordering> {
    // Only compare datetimes of the same shape (offset-date-time, local-date-time,
    // local-date, or local-time). The Java/Go reference implementations refuse to
    // mix kinds.
    let same_shape = left.date.is_some() == right.date.is_some()
        && left.time.is_some() == right.time.is_some()
        && left.offset.is_some() == right.offset.is_some();
    if !same_shape {
        return None;
    }
    if let (Some(left_offset), Some(right_offset)) = (left.offset, right.offset) {
        // Offset-date-time: normalise to UTC minutes before comparing.
        let left_minutes = datetime_to_utc_minutes(left, left_offset)?;
        let right_minutes = datetime_to_utc_minutes(right, right_offset)?;
        return Some(left_minutes.cmp(&right_minutes).then_with(|| {
            left.time
                .as_ref()
                .map(|time| time.nanosecond)
                .cmp(&right.time.as_ref().map(|time| time.nanosecond))
        }));
    }
    Some(field_compare(left, right))
}

fn field_compare(left: &Datetime, right: &Datetime) -> std::cmp::Ordering {
    let left_tuple = datetime_tuple(left);
    let right_tuple = datetime_tuple(right);
    left_tuple.cmp(&right_tuple)
}

fn datetime_tuple(value: &Datetime) -> (u16, u8, u8, u8, u8, u8, u32) {
    let (year, month, day) = match value.date {
        Some(date) => (date.year, date.month, date.day),
        None => (0, 0, 0),
    };
    let (hour, minute, second, nanosecond) = match value.time {
        Some(time) => (time.hour, time.minute, time.second, time.nanosecond),
        None => (0, 0, 0, 0),
    };
    (year, month, day, hour, minute, second, nanosecond)
}

fn datetime_to_utc_minutes(value: &Datetime, offset: Offset) -> Option<i64> {
    let date = value.date?;
    let time = value.time?;
    let days = days_from_civil(date.year as i64, date.month as u32, date.day as u32);
    let seconds = (days * 86_400)
        + (time.hour as i64) * 3600
        + (time.minute as i64) * 60
        + (time.second as i64);
    let offset_minutes = match offset {
        Offset::Z => 0i64,
        Offset::Custom { minutes } => minutes as i64,
    };
    Some(seconds - offset_minutes * 60)
}

// Howard Hinnant's days_from_civil algorithm.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = (year - era * 400) as u64;
    let month = month as i64;
    let day = day as i64;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe as i64 * 365 + (yoe as i64) / 4 - (yoe as i64) / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn numeric(value: &Value) -> Option<f64> {
    match value {
        Value::Integer(integer) => Some(*integer as f64),
        Value::Float(float) => Some(*float),
        _ => None,
    }
}

fn values_equal(left: &Value, right: &Value) -> bool {
    if let (Some(left_number), Some(right_number)) = (numeric(left), numeric(right)) {
        return left_number == right_number;
    }
    match (left, right) {
        (Value::String(left), Value::String(right)) => left == right,
        (Value::Boolean(left), Value::Boolean(right)) => left == right,
        (Value::Datetime(left), Value::Datetime(right)) => {
            left.to_string() == right.to_string()
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right.iter())
                    .all(|(left, right)| values_equal(left, right))
        }
        (Value::Table(left), Value::Table(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, left_value)| {
                    right
                        .get(key)
                        .map(|right_value| values_equal(left_value, right_value))
                        .unwrap_or(false)
                })
        }
        _ => false,
    }
}

fn matches_entire_string(pattern: &Regex, value: &str) -> bool {
    pattern
        .find(value)
        .map(|matched| matched.start() == 0 && matched.end() == value.len())
        .unwrap_or(false)
}

fn append_path(path: &str, key: &str) -> String {
    format!("{path}.{}", encode_path_key(key))
}

/// Encodes a key for use in a JSON-Pointer-like path. Bare keys (letters,
/// digits, underscores, and hyphens) are emitted verbatim; everything else is
/// quoted with TOML-style escaping.
pub fn encode_path_key(key: &str) -> String {
    if !key.is_empty()
        && key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return key.to_string();
    }
    let mut encoded = String::with_capacity(key.len() + 2);
    encoded.push('"');
    for character in key.chars() {
        match character {
            '\\' => encoded.push_str("\\\\"),
            '"' => encoded.push_str("\\\""),
            '\u{08}' => encoded.push_str("\\b"),
            '\t' => encoded.push_str("\\t"),
            '\n' => encoded.push_str("\\n"),
            '\u{0c}' => encoded.push_str("\\f"),
            '\r' => encoded.push_str("\\r"),
            character if (character as u32) < 0x20 => {
                encoded.push_str(&format!("\\u{:04X}", character as u32))
            }
            character => encoded.push(character),
        }
    }
    encoded.push('"');
    encoded
}

fn has_definition_marker(table: &Table) -> bool {
    table.contains_key("type")
        || table.contains_key("typeof")
}

fn normalize_reference(reference: String) -> String {
    reference
        .strip_prefix("types.")
        .map(str::to_string)
        .unwrap_or(reference)
}

fn normalize_references(references: Vec<String>) -> Vec<String> {
    references.into_iter().map(normalize_reference).collect()
}

fn is_nan(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Float(float)) if float.is_nan())
}

fn get_schema_type(
    name: &str,
    table: &Table,
    key: &str,
) -> Result<Option<SchemaType>, String> {
    let Some(value) = get_string(name, table, key)? else {
        return Ok(None);
    };
    SchemaType::parse(&value)
        .map(Some)
        .ok_or_else(|| format!("{name} has unsupported schema type: {value}"))
}

fn get_string(name: &str, table: &Table, key: &str) -> Result<Option<String>, String> {
    match table.get(key) {
        None => Ok(None),
        Some(Value::String(string)) => Ok(Some(string.clone())),
        Some(_) => Err(format!("{name}.{key} must be a string")),
    }
}

fn get_bool(name: &str, table: &Table, key: &str) -> Result<Option<bool>, String> {
    match table.get(key) {
        None => Ok(None),
        Some(Value::Boolean(value)) => Ok(Some(*value)),
        Some(_) => Err(format!("{name}.{key} must be a boolean")),
    }
}

fn get_unsigned_integer(
    name: &str,
    table: &Table,
    key: &str,
) -> Result<Option<i64>, String> {
    match table.get(key) {
        None => Ok(None),
        Some(Value::Integer(value)) => {
            if *value < 0 {
                return Err(format!("{name}.{key} must be non-negative"));
            }
            Ok(Some(*value))
        }
        Some(_) => Err(format!("{name}.{key} must be an integer")),
    }
}

fn get_pattern(name: &str, table: &Table) -> Result<Option<Regex>, String> {
    let Some(pattern) = get_string(name, table, "pattern")? else {
        return Ok(None);
    };
    Regex::new(&pattern)
        .map(Some)
        .map_err(|error| format!("{name} has invalid pattern: {error}"))
}

fn get_array_values(
    name: &str,
    table: &Table,
    key: &str,
) -> Result<Vec<Value>, String> {
    match table.get(key) {
        None => Ok(Vec::new()),
        Some(Value::Array(array)) => Ok(array.clone()),
        Some(_) => Err(format!("{name}.{key} must be an array")),
    }
}

fn get_string_array_values(
    name: &str,
    table: &Table,
    key: &str,
) -> Result<Vec<String>, String> {
    let values = get_array_values(name, table, key)?;
    let mut result = Vec::with_capacity(values.len());
    for value in values {
        match value {
            Value::String(string) => result.push(string),
            _ => return Err(format!("{name}.{key} must contain only strings")),
        }
    }
    Ok(result)
}
