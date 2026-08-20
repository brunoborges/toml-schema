//! Schema model, loader, and validator for TOML Schema documents.
//!
//! The implementation mirrors the Go and Java reference implementations: a TOML Schema
//! file is parsed as a TOML document, top-level `[types]` and `[elements]`
//! tables are decoded into [`Definition`] values, and a [`Schema`] can validate
//! a parsed TOML document against those definitions.

use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::fs;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::str::FromStr;

use regex::Regex;
use toml::de::{DeTable, DeValue};
use toml::value::{Datetime, Offset};
use toml::{Table, Value};
use url::Url;

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
    "description",
    "itemtype",
    "items",
    "allowedvalues",
    "pattern",
    "format",
    "keypattern",
    "optional",
    "min",
    "max",
    "minlength",
    "maxlength",
    "oneof",
    "anyof",
    "dependentrequired",
    "mutuallyexclusive",
    "exactlyone",
    "allof",
    "uniqueitems",
    "default",
    "deprecated",
    "if",
    "then",
    "else",
];

pub const CURRENT_TOML_SCHEMA_VERSION: &str = "1.0.0";

fn is_definition_key(key: &str) -> bool {
    DEFINITION_KEYS.contains(&key)
}

#[derive(Debug, Clone)]
enum ConditionPredicate {
    Equals(Value),
    In(Vec<Value>),
}

#[derive(Debug, Clone)]
struct ConditionalSelector {
    key: String,
    predicate: ConditionPredicate,
    then_reference: String,
    else_reference: String,
}

/// A single TOML Schema definition (either a reusable `[types.*]` entry or an
/// `[elements.*]` entry).
#[derive(Debug, Clone, Default)]
pub struct Definition {
    name: String,
    type_name: Option<SchemaType>,
    reference: Option<String>,
    description: Option<String>,
    item_reference: Option<String>,
    items: Vec<String>,
    optional: bool,
    allowed_values: Vec<Value>,
    pattern: Option<Regex>,
    string_format: Option<StringFormat>,
    key_pattern: Option<Regex>,
    min: Option<Value>,
    max: Option<Value>,
    min_length: Option<i64>,
    max_length: Option<i64>,
    one_of: Vec<String>,
    any_of: Vec<String>,
    conditional: Option<ConditionalSelector>,
    all_of: Vec<String>,
    dependent_required: BTreeMap<String, Vec<String>>,
    mutually_exclusive: Vec<Vec<String>>,
    exactly_one: Vec<Vec<String>>,
    unique_items: Option<bool>,
    default_value: Option<Value>,
    deprecated: bool,
    children: BTreeMap<String, Definition>,
}

#[derive(Debug, Clone, Copy)]
enum StringFormat {
    Email,
    Uuid,
    Uri,
    Hostname,
    Ipv4,
    Ipv6,
}

impl StringFormat {
    fn parse(name: &str, value: &str) -> Result<Self, String> {
        match value {
            "email" => Ok(Self::Email),
            "uuid" => Ok(Self::Uuid),
            "uri" => Ok(Self::Uri),
            "hostname" => Ok(Self::Hostname),
            "ipv4" => Ok(Self::Ipv4),
            "ipv6" => Ok(Self::Ipv6),
            _ => Err(format!("{name} has unknown format: {value}")),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Uuid => "uuid",
            Self::Uri => "uri",
            Self::Hostname => "hostname",
            Self::Ipv4 => "ipv4",
            Self::Ipv6 => "ipv6",
        }
    }

    fn matches(self, value: &str) -> bool {
        match self {
            Self::Email => is_email(value),
            Self::Uuid => is_uuid(value),
            Self::Uri => is_absolute_uri(value),
            Self::Hostname => is_hostname(value),
            Self::Ipv4 => is_ipv4(value),
            Self::Ipv6 => Ipv6Addr::from_str(value).is_ok(),
        }
    }
}

impl Definition {
    /// Returns the definition's fully-qualified schema name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns the default declared directly on this definition, if any.
    ///
    /// Use [`Schema::effective_default`] when inherited defaults should be included.
    pub fn declared_default(&self) -> Option<&Value> {
        self.default_value.as_ref()
    }

    /// Returns a direct fixed-child definition.
    pub fn child_definition(&self, name: &str) -> Option<&Definition> {
        self.children.get(name)
    }
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
    pub warnings: Vec<ValidationWarning>,
}

impl ValidationResult {
    pub fn valid(&self) -> bool {
        self.errors.is_empty()
    }

    pub fn errors(&self) -> &[ValidationError] {
        &self.errors
    }

    pub fn warnings(&self) -> &[ValidationWarning] {
        &self.warnings
    }
}

/// Severity of a non-fatal validation diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Warning,
}

/// A structured non-fatal validation diagnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationWarning {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub path: String,
    pub message: String,
}

/// A loaded TOML Schema document.
#[derive(Debug, Clone)]
pub struct Schema {
    source: PathBuf,
    version: String,
    warnings: Vec<String>,
    types: BTreeMap<String, Definition>,
    elements: BTreeMap<String, Definition>,
}

/// Records which table-valued keys were written as inline tables in the schema
/// source.
///
/// The TOML value model erases the difference between `default = { ... }` and
/// `[<path>.default]`, yet the two mean different things in a schema document:
/// the first is the `default` annotation property, the second is a child
/// definition that happens to be named `default`. Spans reported by
/// [`DeTable`] are used to recover that syntax before it is lost.
#[derive(Debug, Default, Clone)]
struct SourceSyntax {
    inline_tables: HashSet<Vec<String>>,
}

impl SourceSyntax {
    /// Records every inline-table occurrence in `text`. A source that cannot be
    /// parsed contributes no occurrences; the caller reports the parse error.
    fn from_source(text: &str) -> Self {
        let mut syntax = SourceSyntax::default();
        if let Ok(document) = DeTable::parse(text) {
            syntax.record_table(document.get_ref(), text, &mut Vec::new());
        }
        syntax
    }

    fn record_table(&mut self, table: &DeTable<'_>, text: &str, path: &mut Vec<String>) {
        for (key, value) in table.iter() {
            path.push(key.get_ref().as_ref().to_string());
            if let DeValue::Table(child) = value.get_ref() {
                if text.as_bytes().get(value.span().start) == Some(&b'{') {
                    self.inline_tables.insert(path.clone());
                }
                self.record_table(child, text, path);
            }
            path.pop();
        }
    }

    fn is_inline_table(&self, path: &[String], key: &str) -> bool {
        let mut candidate = Vec::with_capacity(path.len() + 1);
        candidate.extend_from_slice(path);
        candidate.push(key.to_string());
        self.inline_tables.contains(&candidate)
    }
}

/// The syntax recorded for one definition, used to tell annotation properties
/// apart from child definitions.
#[derive(Clone, Copy)]
struct SyntaxContext<'a> {
    syntax: &'a SourceSyntax,
    path: &'a [String],
}

impl<'a> SyntaxContext<'a> {
    fn child_path(&self, key: &str) -> Vec<String> {
        let mut path = Vec::with_capacity(self.path.len() + 1);
        path.extend_from_slice(self.path);
        path.push(key.to_string());
        path
    }

    fn child(&self, path: &'a [String]) -> SyntaxContext<'a> {
        SyntaxContext {
            syntax: self.syntax,
            path,
        }
    }

    /// Returns true when `key` carries an annotation property value rather than
    /// a child definition. Table values only qualify when the source wrote them
    /// as an inline table.
    fn is_property(&self, table: &Table, key: &str) -> bool {
        match table.get(key) {
            None => false,
            Some(Value::Table(_)) => self.syntax.is_inline_table(self.path, key),
            Some(_) => true,
        }
    }
}

impl Schema {
    /// Loads a TOML Schema document from a filesystem path.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let path = path.as_ref();
        let content = read_toml_source(path)
            .map_err(|error| format!("unable to parse schema {}: {}", path.display(), error))?;
        Self::from_source(path.to_path_buf(), &content)
    }

    /// Builds a schema from the schema document source text.
    ///
    /// This is the syntax-preserving entry point: inline-table annotations such
    /// as `default = { min = 1 }` are distinguished from child definitions such
    /// as `[elements.thing.default]` using source spans.
    pub fn from_source(source: PathBuf, text: &str) -> Result<Self, String> {
        let parsed = parse_toml_str(&source, text)
            .map_err(|error| format!("unable to parse schema {}: {}", source.display(), error))?;
        let syntax = SourceSyntax::from_source(text);
        Self::from_parts(source, parsed, &syntax)
    }

    /// Builds a schema from an already-parsed TOML Schema root table.
    ///
    /// The TOML value model has already erased the difference between inline
    /// tables and table headers, so every table-valued schema keyword is read as
    /// a child definition. Use [`Schema::from_source`] when inline-table
    /// annotations such as `default = { ... }` must be honoured.
    pub fn from_table(source: PathBuf, table: Table) -> Result<Self, String> {
        Self::from_parts(source, table, &SourceSyntax::default())
    }

    fn from_parts(source: PathBuf, table: Table, syntax: &SourceSyntax) -> Result<Self, String> {
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
        let version = version
            .as_str()
            .expect("schema version was validated as a string")
            .to_string();
        for key in metadata.keys() {
            if key != "version" && key != "meta" {
                return Err(format!("unsupported [toml-schema] key: {key}"));
            }
        }
        let types_table = table.get("types").and_then(Value::as_table);
        let elements_table = table.get("elements").and_then(Value::as_table);
        let types = parse_definitions("types", types_table, false, syntax)?;
        let elements = parse_definitions("elements", elements_table, true, syntax)?;
        let schema = Schema {
            source,
            version,
            warnings: Vec::new(),
            types,
            elements,
        };
        schema.validate_references(&schema.types)?;
        schema.validate_references(&schema.elements)?;
        schema.validate_selector_cycles()?;
        schema.validate_allowed_value_types()?;
        schema.validate_definition_semantics()?;
        schema.validate_array_range_definitions()?;
        schema.validate_defaults()?;
        Ok(schema)
    }

    /// Returns the path the schema was loaded from.
    pub fn source(&self) -> &Path {
        &self.source
    }

    /// Returns non-fatal warnings produced while discovering this schema.
    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// Returns a root element definition.
    pub fn element_definition(&self, name: &str) -> Option<&Definition> {
        self.elements.get(name)
    }

    /// Returns a reusable type definition.
    pub fn type_definition(&self, name: &str) -> Option<&Definition> {
        self.types.get(&normalize_reference(name.to_string()))
    }

    /// Resolves the effective default for a definition, including defaults
    /// inherited through `type` and `allof`.
    pub fn effective_default(&self, definition: &Definition) -> Result<Option<Value>, String> {
        self.resolve_effective_default(definition, &mut HashSet::new())
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
            return Err(
                "[toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax".to_string(),
            );
        };
        if captures.get(1).map(|major| major.as_str()) != Some("1") {
            return Err(format!("unsupported TOML Schema major version: {version}"));
        }
        if captures.get(2).map(|minor| minor.as_str()) != Some("0") {
            return Err(format!("unsupported TOML Schema minor version: {version}"));
        }
        Ok(())
    }

    fn validate_array_range_definitions(&self) -> Result<(), String> {
        for definition in self.types.values().chain(self.elements.values()) {
            self.validate_array_range_definition(definition)?;
        }
        Ok(())
    }

    fn validate_allowed_value_types(&self) -> Result<(), String> {
        for definition in self.types.values().chain(self.elements.values()) {
            self.validate_allowed_value_definition(definition)?;
        }
        Ok(())
    }

    fn validate_allowed_value_definition(&self, definition: &Definition) -> Result<(), String> {
        let mut permitted_types = HashSet::new();
        if !definition.allowed_values.is_empty() {
            if definition.type_name == Some(SchemaType::Array) {
                if let Some(reference) = definition.item_reference.as_deref() {
                    self.collect_reference_types(
                        reference,
                        &mut HashSet::new(),
                        &mut permitted_types,
                    )?;
                }
            } else if let Some(type_name) = definition.type_name {
                permitted_types.insert(type_name);
            }
            for (index, value) in definition.allowed_values.iter().enumerate() {
                if !permitted_types.is_empty()
                    && !permitted_types
                        .iter()
                        .any(|type_name| value_matches_type(value, *type_name))
                {
                    return Err(format!(
                        "{} allowedvalues[{index}] does not match the permitted TOML type",
                        definition.name
                    ));
                }
            }
        }
        for child in definition.children.values() {
            self.validate_allowed_value_definition(child)?;
        }
        Ok(())
    }

    fn validate_references(
        &self,
        definitions: &BTreeMap<String, Definition>,
    ) -> Result<(), String> {
        for definition in definitions.values() {
            for reference in definition
                .reference
                .iter()
                .chain(definition.item_reference.iter())
                .chain(definition.items.iter())
                .chain(definition.one_of.iter())
                .chain(definition.any_of.iter())
                .chain(
                    definition
                        .conditional
                        .iter()
                        .flat_map(|selector| [&selector.then_reference, &selector.else_reference]),
                )
                .chain(definition.all_of.iter())
            {
                if SchemaType::parse(reference).is_none() && !self.types.contains_key(reference) {
                    return Err(format!(
                        "{} contains unknown type reference: {reference}",
                        definition.name
                    ));
                }
            }
            self.validate_references(&definition.children)?;
        }
        Ok(())
    }

    fn validate_selector_cycles(&self) -> Result<(), String> {
        let mut visited = HashSet::new();
        for type_name in self.types.keys() {
            self.validate_selector_cycle(type_name, &mut HashSet::new(), &mut visited)?;
        }
        Ok(())
    }

    fn validate_selector_cycle(
        &self,
        type_name: &str,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> Result<(), String> {
        if SchemaType::parse(type_name).is_some() || visited.contains(type_name) {
            return Ok(());
        }
        if !visiting.insert(type_name.to_string()) {
            return Err(format!(
                "cyclic type selector reference involving types.{type_name}"
            ));
        }
        let Some(definition) = self.types.get(type_name) else {
            return Ok(());
        };
        if let Some(reference) = definition.reference.as_deref() {
            self.validate_selector_cycle(reference, visiting, visited)?;
        }
        for reference in definition
            .one_of
            .iter()
            .chain(definition.any_of.iter())
            .chain(
                definition
                    .conditional
                    .iter()
                    .flat_map(|selector| [&selector.then_reference, &selector.else_reference]),
            )
            .chain(definition.all_of.iter())
        {
            self.validate_selector_cycle(reference, visiting, visited)?;
        }
        visiting.remove(type_name);
        visited.insert(type_name.to_string());
        Ok(())
    }

    fn validate_definition_semantics(&self) -> Result<(), String> {
        for definition in self.types.values().chain(self.elements.values()) {
            self.validate_definition_semantic(definition)?;
        }
        Ok(())
    }

    fn validate_definition_semantic(&self, definition: &Definition) -> Result<(), String> {
        let has_sibling_rules = !definition.dependent_required.is_empty()
            || !definition.mutually_exclusive.is_empty()
            || !definition.exactly_one.is_empty();
        let kind = if definition.unique_items.is_some()
            || has_sibling_rules
            || !definition.all_of.is_empty()
            || definition.conditional.is_some()
            || definition.type_name == Some(SchemaType::Collection)
        {
            Some(self.effective_kind(definition, &mut HashSet::new())?)
        } else {
            None
        };
        if definition.unique_items.is_some() && kind != Some(SchemaType::Array) {
            return Err(format!(
                "{} can only define uniqueitems when its effective type is array",
                definition.name
            ));
        }
        if kind == Some(SchemaType::Collection)
            && !self.has_collection_item_constraint(definition, &mut HashSet::new())
        {
            return Err(format!(
                "{} effective collection must define at least one itemtype",
                definition.name
            ));
        }
        if has_sibling_rules && !matches!(kind, Some(SchemaType::Table | SchemaType::Collection)) {
            return Err(format!(
                "{} can only define sibling rules when its effective type is table or collection",
                definition.name
            ));
        }
        if has_sibling_rules {
            let mut children = HashSet::new();
            self.collect_effective_child_names(definition, &mut HashSet::new(), &mut children)?;
            for (trigger, required) in &definition.dependent_required {
                if !children.contains(trigger) {
                    return Err(format!(
                        "{} dependentrequired references unknown fixed child {trigger}",
                        definition.name
                    ));
                }
                for child in required {
                    if !children.contains(child) {
                        return Err(format!(
                            "{} dependentrequired references unknown fixed child {child}",
                            definition.name
                        ));
                    }
                }
            }
            for (property, groups) in [
                ("mutuallyexclusive", &definition.mutually_exclusive),
                ("exactlyone", &definition.exactly_one),
            ] {
                for group in groups {
                    for child in group {
                        if !children.contains(child) {
                            return Err(format!(
                                "{} {property} references unknown fixed child {child}",
                                definition.name
                            ));
                        }
                    }
                }
            }
        }
        for child in definition.children.values() {
            self.validate_definition_semantic(child)?;
        }
        Ok(())
    }

    /// Reports whether a definition supplies a collection item constraint
    /// locally or through any composed, referenced, or alternative definition.
    fn has_collection_item_constraint(
        &self,
        definition: &Definition,
        seen: &mut HashSet<String>,
    ) -> bool {
        if definition.item_reference.is_some() {
            return true;
        }
        let alternatives = if definition.one_of.is_empty() {
            &definition.any_of
        } else {
            &definition.one_of
        };
        definition
            .reference
            .iter()
            .chain(alternatives.iter())
            .chain(
                definition
                    .conditional
                    .iter()
                    .flat_map(|selector| [&selector.then_reference, &selector.else_reference]),
            )
            .chain(definition.all_of.iter())
            .any(|reference| self.reference_has_collection_item_constraint(reference, seen))
    }

    fn reference_has_collection_item_constraint(
        &self,
        reference: &str,
        seen: &mut HashSet<String>,
    ) -> bool {
        let normalized = normalize_reference(reference.to_string());
        if SchemaType::parse(&normalized).is_some() {
            return false;
        }
        if !seen.insert(normalized.clone()) {
            return false;
        }
        let found = self
            .types
            .get(&normalized)
            .is_some_and(|definition| self.has_collection_item_constraint(definition, seen));
        seen.remove(&normalized);
        found
    }

    fn effective_kind(
        &self,
        definition: &Definition,
        seen: &mut HashSet<String>,
    ) -> Result<SchemaType, String> {
        let base_kind = if let Some(type_name) = definition.type_name {
            type_name
        } else if let Some(reference) = definition.reference.as_deref() {
            self.reference_kind(reference, seen)?
        } else if let Some(selector) = &definition.conditional {
            let then_kind = self.reference_kind(&selector.then_reference, seen)?;
            let else_kind = self.reference_kind(&selector.else_reference, seen)?;
            if then_kind != else_kind {
                return Err(format!(
                    "{} conditional branches do not have compatible effective types",
                    definition.name
                ));
            }
            if !matches!(then_kind, SchemaType::Table | SchemaType::Collection) {
                return Err(format!(
                    "{} conditional branches must resolve to table or collection",
                    definition.name
                ));
            }
            then_kind
        } else {
            let alternatives = if !definition.one_of.is_empty() {
                &definition.one_of
            } else {
                &definition.any_of
            };
            let mut kinds = HashSet::new();
            for reference in alternatives {
                kinds.insert(self.reference_kind(reference, seen)?);
            }
            if kinds.len() != 1 {
                return Err(format!(
                    "{} alternatives do not have one compatible effective type",
                    definition.name
                ));
            }
            *kinds.iter().next().expect("one alternative kind")
        };
        if !definition.all_of.is_empty() {
            if matches!(base_kind, SchemaType::Any) {
                return Err(format!(
                    "{} cannot compose an indeterminate any type with allof",
                    definition.name
                ));
            }
            for reference in &definition.all_of {
                let component_kind = self.reference_kind(reference, seen)?;
                if component_kind == SchemaType::Any || component_kind != base_kind {
                    return Err(format!(
                        "{} allof component {reference} has incompatible effective type",
                        definition.name
                    ));
                }
            }
        }
        Ok(base_kind)
    }

    fn reference_kind(
        &self,
        reference: &str,
        seen: &mut HashSet<String>,
    ) -> Result<SchemaType, String> {
        let normalized = normalize_reference(reference.to_string());
        if let Some(kind) = SchemaType::parse(&normalized) {
            return Ok(kind);
        }
        if !seen.insert(normalized.clone()) {
            return Err(format!("cyclic type reference: {normalized}"));
        }
        let definition = self
            .types
            .get(&normalized)
            .ok_or_else(|| format!("unknown type reference: {reference}"))?;
        let result = self.effective_kind(definition, seen);
        seen.remove(&normalized);
        result
    }

    fn collect_effective_child_names(
        &self,
        definition: &Definition,
        seen: &mut HashSet<String>,
        names: &mut HashSet<String>,
    ) -> Result<(), String> {
        names.extend(definition.children.keys().cloned());
        if let Some(reference) = definition.reference.as_deref() {
            self.collect_reference_child_names(reference, seen, names)?;
        }
        for reference in definition
            .one_of
            .iter()
            .chain(definition.any_of.iter())
            .chain(
                definition
                    .conditional
                    .iter()
                    .flat_map(|selector| [&selector.then_reference, &selector.else_reference]),
            )
            .chain(definition.all_of.iter())
        {
            self.collect_reference_child_names(reference, seen, names)?;
        }
        Ok(())
    }

    fn collect_reference_child_names(
        &self,
        reference: &str,
        seen: &mut HashSet<String>,
        names: &mut HashSet<String>,
    ) -> Result<(), String> {
        let normalized = normalize_reference(reference.to_string());
        if SchemaType::parse(&normalized).is_some() {
            return Ok(());
        }
        if !seen.insert(normalized.clone()) {
            return Err(format!("cyclic type reference: {normalized}"));
        }
        let definition = self
            .types
            .get(&normalized)
            .ok_or_else(|| format!("unknown type reference: {reference}"))?;
        let result = self.collect_effective_child_names(definition, seen, names);
        seen.remove(&normalized);
        result
    }

    fn resolve_effective_default(
        &self,
        definition: &Definition,
        seen: &mut HashSet<String>,
    ) -> Result<Option<Value>, String> {
        if let Some(value) = &definition.default_value {
            return Ok(Some(value.clone()));
        }
        let mut inherited = Vec::new();
        if let Some(reference) = definition.reference.as_deref() {
            if let Some(value) = self.reference_effective_default(reference, seen)? {
                inherited.push(value);
            }
        }
        for reference in &definition.all_of {
            if let Some(value) = self.reference_effective_default(reference, seen)? {
                inherited.push(value);
            }
        }
        let Some(first) = inherited.first().cloned() else {
            return Ok(None);
        };
        if inherited[1..]
            .iter()
            .any(|candidate| !values_equal(&first, candidate))
        {
            return Err(format!(
                "{} inherits conflicting defaults through allof",
                definition.name
            ));
        }
        Ok(Some(first))
    }

    fn reference_effective_default(
        &self,
        reference: &str,
        seen: &mut HashSet<String>,
    ) -> Result<Option<Value>, String> {
        let normalized = normalize_reference(reference.to_string());
        if SchemaType::parse(&normalized).is_some() {
            return Ok(None);
        }
        if !seen.insert(normalized.clone()) {
            return Err(format!("cyclic default reference: {normalized}"));
        }
        let definition = self
            .types
            .get(&normalized)
            .ok_or_else(|| format!("unknown type reference: {reference}"))?;
        let result = self.resolve_effective_default(definition, seen);
        seen.remove(&normalized);
        result
    }

    fn validate_defaults(&self) -> Result<(), String> {
        for definition in self.types.values().chain(self.elements.values()) {
            self.validate_definition_defaults(definition)?;
        }
        Ok(())
    }

    fn validate_definition_defaults(&self, definition: &Definition) -> Result<(), String> {
        if let Some(default) = self.effective_default(definition)? {
            let mut validator = Validator::new(self);
            validator.emit_deprecations = false;
            validator.validate_value("$default", &default, definition);
            if !validator.errors.is_empty() {
                let details = validator
                    .errors
                    .iter()
                    .map(|error| format!("{}: {}", error.path, error.message))
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(format!(
                    "{} has invalid effective default: {details}",
                    definition.name
                ));
            }
        }
        for child in definition.children.values() {
            self.validate_definition_defaults(child)?;
        }
        Ok(())
    }

    fn validate_array_range_definition(&self, definition: &Definition) -> Result<(), String> {
        if definition.type_name == Some(SchemaType::Array)
            && (definition.min.is_some() || definition.max.is_some())
        {
            let item_type = self.array_range_item_type(definition)?;
            validate_boundary_matches_type(
                &definition.name,
                "min",
                definition.min.as_ref(),
                item_type,
            )?;
            validate_boundary_matches_type(
                &definition.name,
                "max",
                definition.max.as_ref(),
                item_type,
            )?;
        }
        for child in definition.children.values() {
            self.validate_array_range_definition(child)?;
        }
        Ok(())
    }

    fn array_range_item_type(&self, definition: &Definition) -> Result<SchemaType, String> {
        let Some(reference) = definition.item_reference.as_deref() else {
            return Err(format!(
                "{} can only define min or max when itemtype resolves to one comparable built-in type",
                definition.name
            ));
        };
        let mut types = HashSet::new();
        self.collect_reference_types(reference, &mut HashSet::new(), &mut types)?;
        if types.len() != 1 {
            return Err(format!(
                "{} cannot define min or max when itemtype has mixed alternatives",
                definition.name
            ));
        }
        let item_type = *types.iter().next().expect("one item type");
        if !item_type.is_range_comparable() {
            return Err(format!(
                "{} can only define min or max when itemtype resolves to one comparable built-in type",
                definition.name
            ));
        }
        Ok(item_type)
    }

    fn collect_reference_types(
        &self,
        reference: &str,
        seen: &mut HashSet<String>,
        types: &mut HashSet<SchemaType>,
    ) -> Result<(), String> {
        let normalized = normalize_reference(reference.to_string());
        if let Some(type_name) = SchemaType::parse(&normalized) {
            types.insert(type_name);
            return Ok(());
        }
        if !seen.insert(normalized.clone()) {
            return Err(format!("cyclic type reference: {normalized}"));
        }
        let definition = self
            .types
            .get(&normalized)
            .ok_or_else(|| format!("unknown type reference: {reference}"))?;
        if let Some(reference) = definition.reference.as_deref() {
            self.collect_reference_types(reference, seen, types)?;
        } else if !definition.one_of.is_empty() || !definition.any_of.is_empty() {
            for alternative in definition.one_of.iter().chain(definition.any_of.iter()) {
                self.collect_reference_types(alternative, seen, types)?;
            }
        } else if let Some(selector) = &definition.conditional {
            self.collect_reference_types(&selector.then_reference, seen, types)?;
            self.collect_reference_types(&selector.else_reference, seen, types)?;
        } else if let Some(type_name) = definition.type_name {
            types.insert(type_name);
        }
        seen.remove(&normalized);
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
                warnings: Vec::new(),
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
            warnings: validator.warnings,
        }
    }
}

/// Loads a TOML Schema document referenced by a TOML document via
/// `[toml-schema].location` and returns the schema together with the parsed
/// document.
pub fn schema_from_document<P: AsRef<Path>>(document_path: P) -> Result<(Schema, Table), String> {
    let document_path = document_path.as_ref();
    let document = parse_toml_file(document_path)?;
    let metadata = document
        .get("toml-schema")
        .and_then(Value::as_table)
        .ok_or_else(|| "document does not contain [toml-schema].location".to_string())?;
    for (key, value) in metadata {
        if !matches!(
            value,
            Value::String(_)
                | Value::Integer(_)
                | Value::Float(_)
                | Value::Boolean(_)
                | Value::Datetime(_)
        ) {
            return Err(format!(
                "document [toml-schema].{key} must be a scalar value"
            ));
        }
    }
    let location = metadata
        .get("location")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|location| !location.is_empty())
        .ok_or_else(|| "document does not contain [toml-schema].location".to_string())?;
    let schema_path = resolve_schema_location(document_path, location)?;
    let mut schema = Schema::load(&schema_path)?;
    if let Some(expected_version) = metadata.get("version") {
        if let Some(warning) = compare_document_schema_version(expected_version, &schema.version)? {
            schema.warnings.push(warning);
        }
    }
    Ok((schema, document))
}

fn resolve_schema_location(document_path: &Path, location: &str) -> Result<PathBuf, String> {
    if has_non_hierarchical_file_scheme(location) {
        return Err(format!("invalid file schema location: {location}"));
    }
    let absolute_document_path = if document_path.is_absolute() {
        document_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("invalid current directory: {error}"))?
            .join(document_path)
    };
    let base = Url::from_file_path(&absolute_document_path)
        .map_err(|_| format!("invalid document path: {}", document_path.display()))?;
    let resolved = base
        .join(location)
        .map_err(|error| format!("invalid [toml-schema].location URI: {location}: {error}"))?;
    if resolved.scheme() != "file" {
        return Err(format!(
            "unsupported schema location URI scheme: {}",
            resolved.scheme()
        ));
    }
    if resolved.query().is_some()
        || resolved.fragment().is_some()
        || contains_percent_encoded_separator(resolved.path())
    {
        return Err(format!("invalid file schema location: {location}"));
    }
    resolved
        .to_file_path()
        .map_err(|_| format!("invalid file schema location: {location}"))
}

fn has_non_hierarchical_file_scheme(reference: &str) -> bool {
    match Url::parse(reference) {
        Ok(url) if url.scheme().eq_ignore_ascii_case("file") => {
            !reference[url.scheme().len() + 1..].starts_with('/')
        }
        _ => false,
    }
}

fn contains_percent_encoded_separator(path: &str) -> bool {
    path.as_bytes().windows(3).any(|window| {
        window[0] == b'%'
            && matches!(
                (
                    window[1].to_ascii_lowercase(),
                    window[2].to_ascii_lowercase()
                ),
                (b'2', b'f') | (b'5', b'c')
            )
    })
}

fn compare_document_schema_version(value: &Value, actual: &str) -> Result<Option<String>, String> {
    let expected = value
        .as_str()
        .ok_or_else(|| "document [toml-schema].version must be a SemVer string".to_string())?;
    let semver = Regex::new(
        r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
    )
    .expect("valid SemVer regex");
    let expected_parts = semver.captures(expected).ok_or_else(|| {
        "document [toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax".to_string()
    })?;
    let actual_parts = semver
        .captures(actual)
        .expect("loaded schema version was already validated");
    if expected_parts.get(1).map(|part| part.as_str())
        != actual_parts.get(1).map(|part| part.as_str())
    {
        return Err(format!(
            "document expects TOML Schema major version {expected}, but resolved schema uses {actual}"
        ));
    }
    if expected != actual {
        return Ok(Some(format!(
            "Warning: document expects TOML Schema version {expected}, but resolved schema uses {actual}"
        )));
    }
    Ok(None)
}

fn read_toml_source(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("{}: {}", path.display(), error))
}

fn parse_toml_str(path: &Path, content: &str) -> Result<Table, String> {
    toml::from_str::<Table>(content).map_err(|error| format!("{}: {}", path.display(), error))
}

fn parse_toml_file(path: &Path) -> Result<Table, String> {
    let content = read_toml_source(path)?;
    parse_toml_str(path, &content)
}

fn parse_definitions(
    prefix: &str,
    table: Option<&Table>,
    required: bool,
    syntax: &SourceSyntax,
) -> Result<BTreeMap<String, Definition>, String> {
    let Some(table) = table else {
        if required {
            return Err(format!("missing required [{prefix}] table"));
        }
        return Ok(BTreeMap::new());
    };
    let root = [prefix.to_string()];
    let context = SyntaxContext {
        syntax,
        path: &root,
    };
    let mut definitions = BTreeMap::new();
    for (key, value) in table.iter() {
        if prefix == "types" && SchemaType::parse(key).is_some() {
            return Err(format!("[types.{key}] uses a reserved built-in type name"));
        }
        if prefix == "types" && key.starts_with("types.") {
            return Err(format!(
                "[types.{key}] uses the reserved type-reference prefix"
            ));
        }
        let value_map = value
            .as_table()
            .ok_or_else(|| format!("[{prefix}] entry must be a table: {key}"))?;
        let path = context.child_path(key);
        let definition =
            parse_definition(&format!("{prefix}.{key}"), value_map, context.child(&path))?;
        definitions.insert(key.clone(), definition);
    }
    Ok(definitions)
}

fn parse_definition(
    name: &str,
    table: &Table,
    context: SyntaxContext<'_>,
) -> Result<Definition, String> {
    let type_selector = get_string(name, table, "type")?;
    let mut type_name = type_selector.as_deref().and_then(SchemaType::parse);
    let reference = type_selector
        .as_deref()
        .filter(|_| type_name.is_none())
        .map(|selector| normalize_reference(selector.to_string()));
    if reference.is_some() {
        for key in table.keys() {
            if !matches!(
                key.as_str(),
                "type" | "description" | "optional" | "allof" | "default" | "deprecated"
            ) {
                return Err(format!("{name} named type reference cannot define {key}"));
            }
        }
    }
    let description = get_string(name, table, "description")?;
    let item_reference = get_string(name, table, "itemtype")?;
    let has_items = property_value(table, "items").is_some();
    let items = get_string_array_values(name, table, "items")?;
    if has_items && items.is_empty() {
        return Err(format!(
            "{name} items must contain at least one type reference"
        ));
    }
    let optional = get_bool(name, table, "optional")?.unwrap_or(false);
    let pattern = get_pattern(name, table)?;
    let string_format = get_string(name, table, "format")?
        .map(|value| StringFormat::parse(name, &value))
        .transpose()?;
    let key_pattern = get_pattern_key(name, table, "keypattern")?;
    let min_length = get_unsigned_integer(name, table, "minlength")?;
    let max_length = get_unsigned_integer(name, table, "maxlength")?;
    let has_allowed_values = property_value(table, "allowedvalues").is_some();
    let allowed_values = get_array_values(name, table, "allowedvalues")?;
    if has_allowed_values && allowed_values.is_empty() {
        return Err(format!(
            "{name} allowedvalues must contain at least one entry"
        ));
    }
    let has_one_of = property_value(table, "oneof").is_some();
    let has_any_of = property_value(table, "anyof").is_some();
    let one_of = get_string_array_values(name, table, "oneof")?;
    let any_of = get_string_array_values(name, table, "anyof")?;
    let has_if = context.is_property(table, "if");
    let has_then = property_value(table, "then").is_some();
    let has_else = property_value(table, "else").is_some();
    if (has_if || has_then || has_else) && !(has_if && has_then && has_else) {
        return Err(format!("{name} must define if, then, and else together"));
    }
    let conditional = if has_if {
        Some(parse_conditional_selector(name, table)?)
    } else {
        None
    };
    let has_all_of = property_value(table, "allof").is_some();
    let all_of = get_string_array_values(name, table, "allof")?;
    let dependent_required = get_dependent_required(name, table, context)?;
    let mutually_exclusive = get_name_groups(name, table, "mutuallyexclusive")?;
    let exactly_one = get_name_groups(name, table, "exactlyone")?;
    let unique_items = get_bool(name, table, "uniqueitems")?;
    let deprecated = get_bool(name, table, "deprecated")?.unwrap_or(false);
    let default_value = if context.is_property(table, "default") {
        table.get("default").cloned()
    } else {
        None
    };
    if has_one_of && one_of.is_empty() {
        return Err(format!(
            "{name} oneof must contain at least one type reference"
        ));
    }
    if has_any_of && any_of.is_empty() {
        return Err(format!(
            "{name} anyof must contain at least one type reference"
        ));
    }
    if has_all_of && all_of.is_empty() {
        return Err(format!(
            "{name} allof must contain at least one type reference"
        ));
    }
    reject_bare_collection_reference(name, "itemtype", item_reference.as_deref())?;
    reject_bare_collection_references(name, "items", &items)?;
    validate_alternative_references(name, "oneof", &one_of)?;
    validate_alternative_references(name, "anyof", &any_of)?;
    validate_composition_references(name, &all_of)?;
    if type_selector.as_deref().is_some_and(|selector| {
        type_name != Some(SchemaType::Collection)
            && normalize_reference(selector.to_string()) == SchemaType::Collection.schema_name()
    }) {
        return Err(format!(
            "{name} cannot use collection as a bare type reference"
        ));
    }
    let type_selectors = usize::from(type_selector.is_some())
        + usize::from(has_one_of)
        + usize::from(has_any_of)
        + usize::from(conditional.is_some());
    if type_selectors > 1 {
        return Err(format!(
            "{name} cannot define more than one of type, oneof, anyof, and if/then/else"
        ));
    }
    let mut children: BTreeMap<String, Definition> = BTreeMap::new();
    for (key, value) in table.iter() {
        if is_definition_key(key) && context.is_property(table, key) {
            continue;
        }
        if let Some(child_table) = value.as_table() {
            if children.contains_key(key) {
                return Err(format!("{name} defines child {key} more than once"));
            }
            let child_path = context.child_path(key);
            let child = parse_definition(
                &format!("{name}.{key}"),
                child_table,
                context.child(&child_path),
            )?;
            children.insert(key.clone(), child);
        } else if !is_definition_key(key) {
            return Err(format!("{name} contains unsupported property: {key}"));
        }
    }
    if has_one_of || has_any_of {
        for key in table.keys() {
            if !matches!(
                key.as_str(),
                "oneof" | "anyof" | "description" | "optional" | "allof" | "default" | "deprecated"
            ) {
                return Err(format!("{name} union cannot define {key}"));
            }
        }
    }
    if conditional.is_some() {
        for key in table.keys() {
            if !matches!(
                key.as_str(),
                "if" | "then"
                    | "else"
                    | "description"
                    | "optional"
                    | "allof"
                    | "default"
                    | "deprecated"
            ) {
                return Err(format!("{name} conditional cannot define {key}"));
            }
        }
    }
    if type_name.is_none()
        && reference.is_none()
        && !has_one_of
        && !has_any_of
        && conditional.is_none()
    {
        if children.is_empty() {
            return Err(format!(
                "{name} must define type, oneof, anyof, if/then/else, or child definitions"
            ));
        }
        type_name = Some(SchemaType::Table);
    }
    if !children.is_empty()
        && !matches!(type_name, Some(SchemaType::Table | SchemaType::Collection))
    {
        return Err(format!(
            "{name} can only define children when type is table or collection"
        ));
    }
    if !matches!(type_name, Some(SchemaType::Array | SchemaType::Collection))
        && item_reference.is_some()
    {
        return Err(format!(
            "{name} can only define itemtype when type is array or collection"
        ));
    }
    if type_name != Some(SchemaType::Array) && !items.is_empty() {
        return Err(format!("{name} can only define items when type is array"));
    }
    if !items.is_empty() {
        if item_reference.is_some() {
            return Err(format!("{name} cannot define both items and itemtype"));
        }
        if min_length.is_some() || max_length.is_some() {
            return Err(format!(
                "{name} cannot define minlength or maxlength together with items"
            ));
        }
        if has_allowed_values {
            return Err(format!(
                "{name} cannot define allowedvalues together with items"
            ));
        }
        if property_value(table, "min").is_some() || property_value(table, "max").is_some() {
            return Err(format!(
                "{name} cannot define min or max together with items"
            ));
        }
    }
    if key_pattern.is_some() && type_name != Some(SchemaType::Collection) {
        return Err(format!(
            "{name} can only define keypattern when type is collection"
        ));
    }
    if pattern.is_some() && type_name != Some(SchemaType::String) {
        return Err(format!(
            "{name} can only define pattern when type is string"
        ));
    }
    if string_format.is_some() && type_name != Some(SchemaType::String) {
        return Err(format!(
            "{name} can only define format when type is string"
        ));
    }
    if has_allowed_values && matches!(type_name, Some(SchemaType::Table | SchemaType::Collection)) {
        return Err(format!(
            "{name} can only define allowedvalues for scalar, unconstrained, or array types"
        ));
    }
    if (min_length.is_some() || max_length.is_some())
        && !matches!(
            type_name,
            Some(SchemaType::String | SchemaType::Array | SchemaType::Collection)
        )
    {
        return Err(format!(
            "{name} can only define minlength or maxlength when type is string, array, or collection"
        ));
    }
    if type_name == Some(SchemaType::Collection) && item_reference.is_none() && all_of.is_empty() {
        return Err(format!(
            "{name} must define itemtype when type is collection"
        ));
    }
    if let (Some(min), Some(max)) = (min_length, max_length) {
        if min > max {
            return Err(format!(
                "{name} minlength must not be greater than maxlength"
            ));
        }
    }
    let min = property_value(table, "min").cloned();
    let max = property_value(table, "max").cloned();
    validate_range_constraints(name, type_name, min.as_ref(), max.as_ref())?;
    validate_allowed_values_constraints(
        name,
        type_name,
        &allowed_values,
        pattern.as_ref(),
        string_format,
        min.as_ref(),
        max.as_ref(),
        min_length,
        max_length,
    )?;
    Ok(Definition {
        name: name.to_string(),
        type_name,
        reference,
        description,
        item_reference: item_reference.map(normalize_reference),
        items: normalize_references(items),
        optional,
        allowed_values,
        pattern,
        string_format,
        key_pattern,
        min,
        max,
        min_length,
        max_length,
        one_of: normalize_references(one_of),
        any_of: normalize_references(any_of),
        conditional,
        all_of: normalize_references(all_of),
        dependent_required,
        mutually_exclusive,
        exactly_one,
        unique_items,
        default_value,
        deprecated,
        children,
    })
}

fn parse_conditional_selector(name: &str, table: &Table) -> Result<ConditionalSelector, String> {
    let condition = table
        .get("if")
        .and_then(Value::as_table)
        .ok_or_else(|| format!("{name}.if must be an inline table"))?;
    for key in condition.keys() {
        if !matches!(key.as_str(), "key" | "equals" | "in") {
            return Err(format!("{name}.if contains unsupported property: {key}"));
        }
    }
    let key = condition
        .get("key")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{name}.if.key must be a string"))?
        .to_string();
    let equals = condition.get("equals");
    let in_values = condition.get("in");
    let predicate = match (equals, in_values) {
        (Some(value), None) => ConditionPredicate::Equals(value.clone()),
        (None, Some(value)) => {
            let values = value
                .as_array()
                .filter(|values| !values.is_empty())
                .ok_or_else(|| format!("{name}.if.in must be a non-empty array"))?;
            ConditionPredicate::In(values.clone())
        }
        _ => {
            return Err(format!(
                "{name}.if must define exactly one of equals and in"
            ))
        }
    };
    let then_reference = parse_conditional_branch_reference(name, table, "then")?;
    let else_reference = parse_conditional_branch_reference(name, table, "else")?;
    Ok(ConditionalSelector {
        key,
        predicate,
        then_reference,
        else_reference,
    })
}

fn parse_conditional_branch_reference(
    name: &str,
    table: &Table,
    property: &str,
) -> Result<String, String> {
    let reference = get_string(name, table, property)?
        .ok_or_else(|| format!("{name}.{property} must be a named reusable type reference"))?;
    let named = normalize_reference(reference);
    if named.is_empty() || SchemaType::parse(&named).is_some() {
        return Err(format!(
            "{name}.{property} must be a named reusable type reference"
        ));
    }
    Ok(named)
}

fn reject_bare_collection_references(
    name: &str,
    property: &str,
    references: &[String],
) -> Result<(), String> {
    for reference in references {
        reject_bare_collection_reference(name, property, Some(reference.as_str()))?;
    }
    Ok(())
}

fn reject_bare_collection_reference(
    name: &str,
    property: &str,
    reference: Option<&str>,
) -> Result<(), String> {
    if reference.is_some_and(|reference| {
        normalize_reference(reference.to_string()) == SchemaType::Collection.schema_name()
    }) {
        return Err(format!(
            "{name} cannot use collection as a bare {property} reference"
        ));
    }
    Ok(())
}

fn validate_alternative_references(
    name: &str,
    property: &str,
    references: &[String],
) -> Result<(), String> {
    for reference in references {
        reject_bare_collection_reference(name, property, Some(reference.as_str()))?;
        if normalize_reference(reference.clone()) == SchemaType::Any.schema_name() {
            return Err(format!("{name} cannot use any directly in {property}"));
        }
    }
    Ok(())
}

fn validate_composition_references(name: &str, references: &[String]) -> Result<(), String> {
    for reference in references {
        let normalized = normalize_reference(reference.clone());
        if matches!(
            SchemaType::parse(&normalized),
            Some(SchemaType::Any | SchemaType::Collection)
        ) {
            return Err(format!("{name} cannot use {normalized} directly in allof"));
        }
    }
    Ok(())
}

fn get_dependent_required(
    name: &str,
    table: &Table,
    context: SyntaxContext<'_>,
) -> Result<BTreeMap<String, Vec<String>>, String> {
    let Some(value) = table.get("dependentrequired") else {
        return Ok(BTreeMap::new());
    };
    if !context.is_property(table, "dependentrequired") {
        return Ok(BTreeMap::new());
    }
    let mapping = value
        .as_table()
        .ok_or_else(|| format!("{name}.dependentrequired must be an inline table"))?;
    if mapping.is_empty() {
        return Err(format!(
            "{name}.dependentrequired must contain at least one mapping"
        ));
    }
    let mut result = BTreeMap::new();
    for (trigger, required_value) in mapping {
        let required = required_value.as_array().ok_or_else(|| {
            format!("{name}.dependentrequired.{trigger} must be an array of child names")
        })?;
        if required.is_empty() {
            return Err(format!(
                "{name}.dependentrequired.{trigger} must not be empty"
            ));
        }
        let mut names = Vec::with_capacity(required.len());
        let mut unique = HashSet::new();
        for required_name in required {
            let required_name = required_name.as_str().ok_or_else(|| {
                format!("{name}.dependentrequired.{trigger} must contain only strings")
            })?;
            if !unique.insert(required_name.to_string()) {
                return Err(format!(
                    "{name}.dependentrequired.{trigger} contains duplicate child {required_name}"
                ));
            }
            names.push(required_name.to_string());
        }
        result.insert(trigger.clone(), names);
    }
    Ok(result)
}

fn get_name_groups(name: &str, table: &Table, key: &str) -> Result<Vec<Vec<String>>, String> {
    let Some(value) = property_value(table, key) else {
        return Ok(Vec::new());
    };
    let groups = value
        .as_array()
        .ok_or_else(|| format!("{name}.{key} must be an array of child-name groups"))?;
    if groups.is_empty() {
        return Err(format!("{name}.{key} must contain at least one group"));
    }
    let mut result = Vec::with_capacity(groups.len());
    for (index, group) in groups.iter().enumerate() {
        let group = group
            .as_array()
            .ok_or_else(|| format!("{name}.{key}[{index}] must be an array"))?;
        if group.len() < 2 {
            return Err(format!(
                "{name}.{key}[{index}] must contain at least two child names"
            ));
        }
        let mut names = Vec::with_capacity(group.len());
        let mut unique = HashSet::new();
        for value in group {
            let child = value
                .as_str()
                .ok_or_else(|| format!("{name}.{key}[{index}] must contain only strings"))?;
            if !unique.insert(child.to_string()) {
                return Err(format!(
                    "{name}.{key}[{index}] contains duplicate child {child}"
                ));
            }
            names.push(child.to_string());
        }
        result.push(names);
    }
    Ok(result)
}

fn validate_range_constraints(
    name: &str,
    type_name: Option<SchemaType>,
    min: Option<&Value>,
    max: Option<&Value>,
) -> Result<(), String> {
    if min.is_none() && max.is_none() {
        return Ok(());
    }
    validate_range_boundary(name, "min", min)?;
    validate_range_boundary(name, "max", max)?;
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
        return Ok(());
    }
    if let Some(type_name) = type_name {
        if !type_name.is_range_comparable() {
            return Err(format!(
                "{name} can only define min or max for integer, float, date/time, or compatible array types"
            ));
        }
        validate_boundary_matches_type(name, "min", min, type_name)?;
        validate_boundary_matches_type(name, "max", max, type_name)?;
    }
    Ok(())
}

fn validate_range_boundary(name: &str, key: &str, value: Option<&Value>) -> Result<(), String> {
    if value.map_or(true, is_range_boundary) {
        return Ok(());
    }
    Err(format!(
        "{name} {key} must be an integer, float, or temporal value"
    ))
}

fn is_range_boundary(value: &Value) -> bool {
    matches!(value, Value::Integer(_) | Value::Float(_))
        || matches!(value, Value::Datetime(datetime) if is_temporal_boundary(datetime))
}

fn is_temporal_boundary(datetime: &Datetime) -> bool {
    matches!(
        (
            datetime.date.is_some(),
            datetime.time.is_some(),
            datetime.offset.is_some()
        ),
        (true, true, true) | (true, true, false) | (true, false, false) | (false, true, false)
    )
}

fn validate_boundary_matches_type(
    name: &str,
    key: &str,
    value: Option<&Value>,
    type_name: SchemaType,
) -> Result<(), String> {
    if value.map_or(true, |value| boundary_matches_type(value, type_name)) {
        return Ok(());
    }
    Err(format!(
        "{name} {key} must be comparable with {}",
        type_name.schema_name()
    ))
}

fn boundary_matches_type(value: &Value, type_name: SchemaType) -> bool {
    match type_name {
        SchemaType::Integer | SchemaType::Float => {
            matches!(value, Value::Integer(_) | Value::Float(_))
        }
        SchemaType::OffsetDateTime
        | SchemaType::LocalDateTime
        | SchemaType::LocalDate
        | SchemaType::LocalTime => value_matches_type(value, type_name),
        _ => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_allowed_values_constraints(
    name: &str,
    type_name: Option<SchemaType>,
    allowed_values: &[Value],
    pattern: Option<&Regex>,
    string_format: Option<StringFormat>,
    min: Option<&Value>,
    max: Option<&Value>,
    min_length: Option<i64>,
    max_length: Option<i64>,
) -> Result<(), String> {
    if allowed_values.is_empty() || type_name == Some(SchemaType::Array) {
        return Ok(());
    }
    for (index, allowed) in allowed_values.iter().enumerate() {
        let entry = format!("{name} allowedvalues[{index}]");
        if let Some(pattern) = pattern {
            let Some(string_value) = allowed.as_str() else {
                return Err(format!("{entry} does not satisfy pattern"));
            };
            if !matches_pattern(pattern, string_value) {
                return Err(format!("{entry} does not satisfy pattern"));
            }
        }
        if let Some(string_format) = string_format {
            let Some(string_value) = allowed.as_str() else {
                return Err(format!("{entry} does not satisfy format {}", string_format.name()));
            };
            if !string_format.matches(string_value) {
                return Err(format!("{entry} does not satisfy format {}", string_format.name()));
            }
        }
        if (min.is_some() || max.is_some()) && is_nan(Some(allowed)) {
            return Err(format!("{entry} does not satisfy min or max"));
        }
        if let Some(min) = min {
            let comparison = compare(allowed, min)
                .map_err(|error| format!("{entry} cannot be compared with min: {error}"))?;
            if comparison == std::cmp::Ordering::Less {
                return Err(format!("{entry} is less than min"));
            }
        }
        if let Some(max) = max {
            let comparison = compare(allowed, max)
                .map_err(|error| format!("{entry} cannot be compared with max: {error}"))?;
            if comparison == std::cmp::Ordering::Greater {
                return Err(format!("{entry} is greater than max"));
            }
        }
        if min_length.is_some() || max_length.is_some() {
            let Some(string_value) = allowed.as_str() else {
                return Err(format!(
                    "{entry} does not satisfy string length constraints"
                ));
            };
            let length = string_value.chars().count() as i64;
            if min_length.is_some_and(|minimum| length < minimum) {
                return Err(format!("{entry} is shorter than minlength"));
            }
            if max_length.is_some_and(|maximum| length > maximum) {
                return Err(format!("{entry} is longer than maxlength"));
            }
        }
    }
    Ok(())
}

struct Validator<'schema> {
    schema: &'schema Schema,
    errors: Vec<ValidationError>,
    warnings: Vec<ValidationWarning>,
    emit_deprecations: bool,
}

impl<'schema> Validator<'schema> {
    fn new(schema: &'schema Schema) -> Self {
        Self {
            schema,
            errors: Vec::new(),
            warnings: Vec::new(),
            emit_deprecations: true,
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
        let components = match self.collect_components(definition, &mut HashSet::new()) {
            Ok(components) => components,
            Err(error) => {
                self.add(path, &error);
                return;
            }
        };
        self.validate_component_set(path, value, components);
    }

    fn collect_components(
        &self,
        definition: &Definition,
        seen: &mut HashSet<String>,
    ) -> Result<Vec<Definition>, String> {
        let mut resolved = self.resolve(definition, &mut HashSet::new())?;
        let all_of = std::mem::take(&mut resolved.all_of);
        let mut components = vec![resolved];
        for reference in all_of {
            let normalized = normalize_reference(reference.clone());
            if !seen.insert(normalized.clone()) {
                return Err(format!("cyclic allof reference: {normalized}"));
            }
            let component = self.resolve_reference(&reference, &mut HashSet::new())?;
            components.extend(self.collect_components(&component, seen)?);
            seen.remove(&normalized);
        }
        Ok(components)
    }

    fn validate_component_set(
        &mut self,
        path: &str,
        value: &Value,
        mut components: Vec<Definition>,
    ) {
        if let Some(index) = components
            .iter()
            .position(|component| component.conditional.is_some())
        {
            let mut conditional = components.remove(index);
            let selector = conditional
                .conditional
                .take()
                .expect("conditional component was selected");
            let selected_kind = match self
                .schema
                .reference_kind(&selector.then_reference, &mut HashSet::new())
            {
                Ok(kind) => kind,
                Err(error) => {
                    self.add(path, &error);
                    return;
                }
            };
            conditional.type_name = Some(selected_kind);
            components.push(conditional);

            let Value::Table(table) = value else {
                self.validate_component_set(path, value, components);
                return;
            };
            let condition_matches = table
                .get(&selector.key)
                .is_some_and(|actual| match &selector.predicate {
                    ConditionPredicate::Equals(expected) => values_equal(actual, expected),
                    ConditionPredicate::In(expected) => expected
                        .iter()
                        .any(|candidate| values_equal(actual, candidate)),
                });
            let reference = if condition_matches {
                &selector.then_reference
            } else {
                &selector.else_reference
            };
            let selected = match self.resolve_reference(reference, &mut HashSet::new()) {
                Ok(selected) => selected,
                Err(error) => {
                    self.add(path, &error);
                    return;
                }
            };
            match self.collect_components(&selected, &mut HashSet::new()) {
                Ok(expanded) => components.extend(expanded),
                Err(error) => {
                    self.add(path, &error);
                    return;
                }
            }
            self.validate_component_set(path, value, components);
            return;
        }

        if let Some(index) = components
            .iter()
            .position(|component| !component.one_of.is_empty() || !component.any_of.is_empty())
        {
            let union = components.remove(index);
            let alternatives = if !union.one_of.is_empty() {
                &union.one_of
            } else {
                &union.any_of
            };
            let mut successful = Vec::new();
            for reference in alternatives {
                let alternative = match self.resolve_reference(reference, &mut HashSet::new()) {
                    Ok(alternative) => alternative,
                    Err(error) => {
                        self.add(path, &error);
                        return;
                    }
                };
                let mut candidate_components = components.clone();
                let mut union_assertions = union.clone();
                union_assertions.one_of.clear();
                union_assertions.any_of.clear();
                union_assertions.type_name =
                    match self.schema.reference_kind(reference, &mut HashSet::new()) {
                        Ok(kind) => Some(kind),
                        Err(error) => {
                            self.add(path, &error);
                            return;
                        }
                    };
                candidate_components.push(union_assertions);
                match self.collect_components(&alternative, &mut HashSet::new()) {
                    Ok(expanded) => candidate_components.extend(expanded),
                    Err(error) => {
                        self.add(path, &error);
                        return;
                    }
                }
                let mut candidate = Validator::new(self.schema);
                candidate.emit_deprecations = self.emit_deprecations;
                candidate.validate_component_set(path, value, candidate_components);
                if candidate.errors.is_empty() {
                    successful.push(candidate);
                }
            }
            let success = if !union.one_of.is_empty() {
                if successful.len() != 1 {
                    self.add(
                        path,
                        &format!(
                            "expected exactly one matching type from oneof but found {}",
                            successful.len()
                        ),
                    );
                    false
                } else {
                    true
                }
            } else if successful.is_empty() {
                self.add(path, "expected at least one matching type from anyof");
                false
            } else {
                true
            };
            if success {
                for candidate in successful {
                    self.merge_warnings(candidate.warnings);
                }
                if union.deprecated {
                    self.add_deprecation(path);
                }
            }
            return;
        }

        let error_start = self.errors.len();
        let Some(type_name) = components.first().and_then(|component| component.type_name) else {
            self.add(path, "definition has no effective type");
            return;
        };
        for component in &components {
            let component_type = component.type_name.unwrap_or(SchemaType::Any);
            self.validate_type(path, value, component_type);
        }
        if self.errors.len() != error_start {
            return;
        }
        for component in &components {
            self.validate_common_constraints(path, value, component);
        }
        match type_name {
            SchemaType::Table => {
                if let Value::Table(table) = value {
                    self.validate_table_value(path, table, &components);
                }
            }
            SchemaType::Collection => {
                if let Value::Table(table) = value {
                    self.validate_collection(path, table, &components);
                }
            }
            SchemaType::Array => {
                if let Value::Array(array) = value {
                    for component in &components {
                        self.validate_array(path, array, component);
                    }
                }
            }
            _ => {}
        }
        if self.errors.len() == error_start
            && components.iter().any(|component| component.deprecated)
        {
            self.add_deprecation(path);
        }
    }

    fn validate_table_value(&mut self, path: &str, table: &Table, components: &[Definition]) {
        let children = collect_children(components);
        if children.is_empty() {
            return;
        }
        self.validate_fixed_children(path, table, &children);
        for key in table.keys() {
            if !children.contains_key(key) {
                self.add(&append_path(path, key), "unexpected key");
            }
        }
        self.validate_sibling_rules(path, table, components);
    }

    fn validate_collection(&mut self, path: &str, table: &Table, components: &[Definition]) {
        let children = collect_children(components);
        let mut dynamic_entries = 0usize;
        for (key, value) in table.iter() {
            let child_path = append_path(path, key);
            if let Some(fixed_children) = children.get(key) {
                self.validate_definitions(&child_path, value, fixed_children);
                continue;
            }
            dynamic_entries += 1;
            for definition in components {
                if let Some(key_pattern) = &definition.key_pattern {
                    if !matches_pattern(key_pattern, key) {
                        self.add(
                            &child_path,
                            &format!("key does not match keypattern {}", key_pattern.as_str()),
                        );
                    }
                }
            }
            let mut item_definitions = Vec::new();
            let mut item_references = 0usize;
            for definition in components {
                let Some(reference) = definition.item_reference.as_deref() else {
                    continue;
                };
                item_references += 1;
                match self.resolve_reference(reference, &mut HashSet::new()) {
                    Ok(referenced) => item_definitions.push(referenced),
                    Err(error) => self.add(&child_path, &error),
                }
            }
            if item_references == 0 {
                self.add(&child_path, "collection entry has no itemtype reference");
            }
            if !item_definitions.is_empty() {
                self.validate_definitions(&child_path, value, &item_definitions);
            }
        }
        for definition in components {
            self.validate_length(path, dynamic_entries, definition);
        }
        self.validate_missing_fixed_children(path, table, &children);
        self.validate_sibling_rules(path, table, components);
    }

    fn validate_array(&mut self, path: &str, array: &[Value], definition: &Definition) {
        if definition.unique_items == Some(true) {
            for right in 1..array.len() {
                if (0..right).any(|left| values_equal(&array[left], &array[right])) {
                    self.add(
                        &format!("{path}[{right}]"),
                        "array item duplicates an earlier item while uniqueitems is true",
                    );
                }
            }
        }
        if !definition.items.is_empty() {
            self.validate_tuple_array(path, array, definition);
            return;
        }
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
        if item_definition.is_none() && definition.allowed_values.is_empty() {
            return;
        }
        let range_type = if definition.min.is_some() || definition.max.is_some() {
            match self.schema.array_range_item_type(definition) {
                Ok(item_type) => Some(item_type),
                Err(error) => {
                    self.add(path, &error);
                    return;
                }
            }
        } else {
            None
        };
        for (index, item) in array.iter().enumerate() {
            let item_path = format!("{path}[{index}]");
            if let Some(item_definition) = &item_definition {
                self.validate_value(&item_path, item, item_definition);
            }
            self.validate_allowed_values(&item_path, item, definition);
            if range_type.is_some_and(|item_type| value_matches_type(item, item_type)) {
                self.validate_range(&item_path, item, definition);
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
            let referenced =
                match self.resolve_reference(&definition.items[index], &mut HashSet::new()) {
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

    fn validate_common_constraints(&mut self, path: &str, value: &Value, definition: &Definition) {
        if let Value::Array(array) = value {
            self.validate_length(path, array.len(), definition);
            return;
        }
        self.validate_allowed_values(path, value, definition);
        if !definition.allowed_values.is_empty() {
            return;
        }
        self.validate_range(path, value, definition);
        if let Value::String(string_value) = value {
            self.validate_length(path, string_value.chars().count(), definition);
            if let Some(pattern) = &definition.pattern {
                if !matches_pattern(pattern, string_value) {
                    self.add(
                        path,
                        &format!("does not match pattern {}", pattern.as_str()),
                    );
                }
            }
            if let Some(string_format) = definition.string_format {
                if !string_format.matches(string_value) {
                    self.add(
                        path,
                        &format!("does not satisfy format {}", string_format.name()),
                    );
                }
            }
        }
    }

    fn validate_allowed_values(&mut self, path: &str, value: &Value, definition: &Definition) {
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
        if definition.reference.is_none() {
            return Ok(definition.clone());
        }
        let reference = definition.reference.as_deref().unwrap();
        let referenced = self.resolve_reference(reference, seen)?;
        let mut resolved = referenced;
        resolved.name = definition.name.clone();
        resolved.reference = None;
        resolved.description = definition.description.clone().or(resolved.description);
        resolved.optional = definition.optional || resolved.optional;
        resolved.all_of.extend(definition.all_of.clone());
        for (trigger, required) in &definition.dependent_required {
            let inherited = resolved
                .dependent_required
                .entry(trigger.clone())
                .or_default();
            for child in required {
                if !inherited.contains(child) {
                    inherited.push(child.clone());
                }
            }
        }
        resolved
            .mutually_exclusive
            .extend(definition.mutually_exclusive.clone());
        resolved.exactly_one.extend(definition.exactly_one.clone());
        resolved.unique_items = match (definition.unique_items, resolved.unique_items) {
            (Some(true), _) | (_, Some(true)) => Some(true),
            (Some(false), inherited) => inherited.or(Some(false)),
            (None, inherited) => inherited,
        };
        resolved.default_value = definition.default_value.clone().or(resolved.default_value);
        resolved.deprecated = definition.deprecated || resolved.deprecated;
        Ok(resolved)
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

    fn validate_definitions(&mut self, path: &str, value: &Value, definitions: &[Definition]) {
        let mut components = Vec::new();
        for definition in definitions {
            match self.collect_components(definition, &mut HashSet::new()) {
                Ok(expanded) => components.extend(expanded),
                Err(error) => {
                    self.add(path, &error);
                    return;
                }
            }
        }
        self.validate_component_set(path, value, components);
    }

    fn validate_fixed_children(
        &mut self,
        path: &str,
        table: &Table,
        children: &BTreeMap<String, Vec<Definition>>,
    ) {
        for (key, definitions) in children {
            if let Some(value) = table.get(key) {
                self.validate_definitions(&append_path(path, key), value, definitions);
            }
        }
        self.validate_missing_fixed_children(path, table, children);
    }

    fn validate_missing_fixed_children(
        &mut self,
        path: &str,
        table: &Table,
        children: &BTreeMap<String, Vec<Definition>>,
    ) {
        for (key, definitions) in children {
            if table.contains_key(key) {
                continue;
            }
            let required = definitions.iter().any(|definition| {
                self.resolve(definition, &mut HashSet::new())
                    .map(|resolved| !resolved.optional)
                    .unwrap_or(true)
            });
            if required {
                self.add(&append_path(path, key), "required value is missing");
            }
        }
    }

    fn validate_sibling_rules(&mut self, path: &str, table: &Table, components: &[Definition]) {
        for definition in components {
            for (trigger, required) in &definition.dependent_required {
                if !table.contains_key(trigger) {
                    continue;
                }
                for child in required {
                    if !table.contains_key(child) {
                        self.add(
                            &append_path(path, child),
                            &format!("required because sibling {trigger} is present"),
                        );
                    }
                }
            }
            for group in &definition.mutually_exclusive {
                let present: Vec<&str> = group
                    .iter()
                    .filter(|child| table.contains_key(child.as_str()))
                    .map(String::as_str)
                    .collect();
                if present.len() > 1 {
                    self.add(
                        path,
                        &format!(
                            "mutuallyexclusive group has multiple present children: {}",
                            present.join(", ")
                        ),
                    );
                }
            }
            for group in &definition.exactly_one {
                let present: Vec<&str> = group
                    .iter()
                    .filter(|child| table.contains_key(child.as_str()))
                    .map(String::as_str)
                    .collect();
                if present.len() != 1 {
                    self.add(
                        path,
                        &format!(
                            "exactlyone group requires one present child but found {}",
                            present.len()
                        ),
                    );
                }
            }
        }
    }

    fn add_deprecation(&mut self, path: &str) {
        if !self.emit_deprecations {
            return;
        }
        let warning = ValidationWarning {
            severity: DiagnosticSeverity::Warning,
            code: "deprecated".to_string(),
            path: path.to_string(),
            message: "value is deprecated".to_string(),
        };
        if !self.warnings.contains(&warning) {
            self.warnings.push(warning);
        }
    }

    fn merge_warnings(&mut self, warnings: Vec<ValidationWarning>) {
        for warning in warnings {
            if !self.warnings.contains(&warning) {
                self.warnings.push(warning);
            }
        }
    }
}

fn collect_children(components: &[Definition]) -> BTreeMap<String, Vec<Definition>> {
    let mut children: BTreeMap<String, Vec<Definition>> = BTreeMap::new();
    for component in components {
        for (name, definition) in &component.children {
            children
                .entry(name.clone())
                .or_default()
                .push(definition.clone());
        }
    }
    children
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
    match (value, boundary) {
        (Value::Integer(left), Value::Integer(right)) => return Ok(left.cmp(right)),
        (Value::Float(left), Value::Float(right)) => return compare_floats(*left, *right),
        (Value::Integer(left), Value::Float(right)) => return compare_integer_float(*left, *right),
        (Value::Float(left), Value::Integer(right)) => {
            return compare_integer_float(*right, *left).map(std::cmp::Ordering::reverse)
        }
        _ => {}
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
        Some(time) => (
            time.hour,
            time.minute,
            time.second.unwrap_or(0),
            time.nanosecond.unwrap_or(0),
        ),
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
        + (time.second.unwrap_or(0) as i64);
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

fn compare_floats(left: f64, right: f64) -> Result<std::cmp::Ordering, String> {
    left.partial_cmp(&right)
        .ok_or_else(|| "NaN is unordered".to_string())
}

fn compare_integer_float(integer: i64, float: f64) -> Result<std::cmp::Ordering, String> {
    if float.is_nan() {
        return Err("NaN is unordered".to_string());
    }
    if float == f64::NEG_INFINITY {
        return Ok(std::cmp::Ordering::Greater);
    }
    if float == f64::INFINITY {
        return Ok(std::cmp::Ordering::Less);
    }
    if float < i64::MIN as f64 {
        return Ok(std::cmp::Ordering::Greater);
    }
    if float >= 9_223_372_036_854_775_808.0 {
        return Ok(std::cmp::Ordering::Less);
    }
    let truncated = float.trunc() as i64;
    match integer.cmp(&truncated) {
        std::cmp::Ordering::Equal => {
            if float.fract() > 0.0 {
                Ok(std::cmp::Ordering::Less)
            } else if float.fract() < 0.0 {
                Ok(std::cmp::Ordering::Greater)
            } else {
                Ok(std::cmp::Ordering::Equal)
            }
        }
        ordering => Ok(ordering),
    }
}

fn values_equal(left: &Value, right: &Value) -> bool {
    if let (Value::Float(left_float), Value::Float(right_float)) = (left, right) {
        if left_float.is_nan() || right_float.is_nan() {
            return left_float.is_nan() && right_float.is_nan();
        }
    }
    if matches!(left, Value::Integer(_) | Value::Float(_))
        && matches!(right, Value::Integer(_) | Value::Float(_))
    {
        return compare(left, right).is_ok_and(|ordering| ordering == std::cmp::Ordering::Equal);
    }
    match (left, right) {
        (Value::String(left), Value::String(right)) => left == right,
        (Value::Boolean(left), Value::Boolean(right)) => left == right,
        (Value::Datetime(left), Value::Datetime(right)) => datetimes_equal(left, right),
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

fn datetimes_equal(left: &Datetime, right: &Datetime) -> bool {
    left.date == right.date
        && left.time == right.time
        && numeric_offset(left.offset) == numeric_offset(right.offset)
}

fn numeric_offset(offset: Option<Offset>) -> Option<i16> {
    offset.map(|offset| match offset {
        Offset::Z => 0,
        Offset::Custom { minutes } => minutes,
    })
}

fn matches_pattern(pattern: &Regex, value: &str) -> bool {
    pattern.is_match(value)
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

fn is_ipv4(value: &str) -> bool {
    let mut count = 0;
    for part in value.split('.') {
        count += 1;
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|byte| byte.is_ascii_digit())
            || part.parse::<u8>().is_err()
        {
            return false;
        }
    }
    count == 4 && Ipv4Addr::from_str(value).is_ok()
}

fn is_hostname(value: &str) -> bool {
    if !value.is_ascii() {
        return false;
    }
    let hostname = value.strip_suffix('.').unwrap_or(value);
    if hostname.is_empty() || hostname.len() > 253 {
        return false;
    }
    hostname.split('.').all(|label| {
        (1..=63).contains(&label.len())
            && label.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && label
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            && label
                .as_bytes()
                .last()
                .is_some_and(u8::is_ascii_alphanumeric)
    })
}

fn is_absolute_uri(value: &str) -> bool {
    if !value.is_ascii()
        || value.bytes().filter(|byte| *byte == b'#').count() > 1
        || value.bytes().any(|byte| {
            !(byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'-' | b'.' | b'_' | b'~' | b':' | b'/' | b'?' | b'#' | b'[' | b']'
                        | b'@' | b'!' | b'$' | b'&' | b'\'' | b'(' | b')' | b'*' | b'+'
                        | b',' | b';' | b'=' | b'%'
                ))
        })
    {
        return false;
    }
    let bytes = value.as_bytes();
    for index in 0..bytes.len() {
        if bytes[index] == b'%'
            && (index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit())
        {
            return false;
        }
    }
    let Some((scheme, _)) = value.split_once(':') else {
        return false;
    };
    !scheme.is_empty()
        && scheme.as_bytes()[0].is_ascii_alphabetic()
        && scheme
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
        && (Url::parse(value).is_ok()
            || normalized_ipvfuture_uri(value).is_some_and(|uri| Url::parse(&uri).is_ok()))
}

fn normalized_ipvfuture_uri(value: &str) -> Option<String> {
    let (_, remainder) = value.split_once(':')?;
    let authority = remainder.strip_prefix("//")?;
    let authority_end = authority.find(['/', '?', '#']).unwrap_or(authority.len());
    let authority = &authority[..authority_end];
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let literal_start = host_port.find('[')?;
    let literal_end = host_port[literal_start + 1..].find(']')? + literal_start + 1;
    let literal = &host_port[literal_start + 1..literal_end];
    if !is_ipvfuture(literal) {
        return None;
    }
    let absolute_start = value.find(host_port)? + literal_start + 1;
    let absolute_end = absolute_start + literal.len();
    Some(format!("{}::1{}", &value[..absolute_start], &value[absolute_end..]))
}

fn is_ipvfuture(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.first().is_none_or(|byte| !matches!(byte, b'v' | b'V')) {
        return false;
    }
    let Some(dot) = value.find('.') else {
        return false;
    };
    dot > 1
        && dot < value.len() - 1
        && value[1..dot].bytes().all(|byte| byte.is_ascii_hexdigit())
        && value[dot + 1..].bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'-' | b'.' | b'_' | b'~' | b'!' | b'$' | b'&' | b'\'' | b'('
                        | b')' | b'*' | b'+' | b',' | b';' | b'=' | b':'
                )
        })
}

fn is_email(value: &str) -> bool {
    if !value.is_ascii() || value.len() > 254 {
        return false;
    }
    let separator = if value.starts_with('"') {
        quoted_local_end(value).filter(|index| value.as_bytes().get(index + 1) == Some(&b'@'))
            .map(|index| index + 1)
    } else {
        let mut separators = value.match_indices('@');
        let first = separators.next().map(|(index, _)| index);
        if separators.next().is_some() { None } else { first }
    };
    let Some(separator) = separator else {
        return false;
    };
    let local = &value[..separator];
    let domain = &value[separator + 1..];
    if local.len() > 64 || local.is_empty() || domain.is_empty() {
        return false;
    }
    let valid_local = if local.starts_with('"') {
        quoted_local_end(local) == Some(local.len() - 1)
    } else {
        local.split('.').all(|atom| {
            !atom.is_empty()
                && atom.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric()
                        || matches!(
                            byte,
                            b'!' | b'#' | b'$' | b'%' | b'&' | b'\'' | b'*' | b'+'
                                | b'-' | b'/' | b'=' | b'?' | b'^' | b'_' | b'`'
                                | b'{' | b'|' | b'}' | b'~'
                        )
                })
        })
    };
    valid_local && is_email_domain(domain)
}

fn quoted_local_end(value: &str) -> Option<usize> {
    let bytes = value.as_bytes();
    if bytes.first() != Some(&b'"') {
        return None;
    }
    let mut index = 1;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => return Some(index),
            b'\\' => {
                index += 1;
                if index >= bytes.len() || !(32..=126).contains(&bytes[index]) {
                    return None;
                }
            }
            byte if (32..=33).contains(&byte)
                || (35..=91).contains(&byte)
                || (93..=126).contains(&byte) => {}
            _ => return None,
        }
        index += 1;
    }
    None
}

fn is_email_domain(domain: &str) -> bool {
    if !(domain.starts_with('[') && domain.ends_with(']')) {
        return !domain.ends_with('.') && is_hostname(domain);
    }
    let literal = &domain[1..domain.len() - 1];
    if is_ipv4(literal) {
        return true;
    }
    if let Some(address) = literal
        .get(..5)
        .filter(|prefix| prefix.eq_ignore_ascii_case("IPv6:"))
        .and_then(|_| literal.get(5..))
    {
        return Ipv6Addr::from_str(address).is_ok();
    }
    let Some((tag, content)) = literal.split_once(':') else {
        return false;
    };
    !tag.is_empty()
        && tag.as_bytes()[0].is_ascii_alphabetic()
        && tag
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !content.is_empty()
        && content.bytes().all(|byte| {
            (33..=90).contains(&byte) || (94..=126).contains(&byte)
        })
}

fn append_path(path: &str, key: &str) -> String {
    format!("{path}.{}", encode_path_key(key))
}

/// Encodes a key for use in a JSON-Pointer-like path. Bare keys (letters,
/// digits, underscores, and hyphens) are emitted verbatim; everything else is
/// quoted with TOML-style escaping.
pub fn encode_path_key(key: &str) -> String {
    if !key.is_empty()
        && key.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
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

fn property_value<'a>(table: &'a Table, key: &str) -> Option<&'a Value> {
    match table.get(key) {
        Some(Value::Table(_)) => None,
        value => value,
    }
}

fn get_string(name: &str, table: &Table, key: &str) -> Result<Option<String>, String> {
    match property_value(table, key) {
        None => Ok(None),
        Some(Value::String(string)) => Ok(Some(string.clone())),
        Some(_) => Err(format!("{name}.{key} must be a string")),
    }
}

fn get_bool(name: &str, table: &Table, key: &str) -> Result<Option<bool>, String> {
    match property_value(table, key) {
        None => Ok(None),
        Some(Value::Boolean(value)) => Ok(Some(*value)),
        Some(_) => Err(format!("{name}.{key} must be a boolean")),
    }
}

fn get_unsigned_integer(name: &str, table: &Table, key: &str) -> Result<Option<i64>, String> {
    match property_value(table, key) {
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
    get_pattern_key(name, table, "pattern")
}

fn get_pattern_key(name: &str, table: &Table, key: &str) -> Result<Option<Regex>, String> {
    let Some(pattern) = get_string(name, table, key)? else {
        return Ok(None);
    };
    Regex::new(&pattern)
        .map(Some)
        .map_err(|error| format!("{name} has invalid {key}: {error}"))
}

fn get_array_values(name: &str, table: &Table, key: &str) -> Result<Vec<Value>, String> {
    match property_value(table, key) {
        None => Ok(Vec::new()),
        Some(Value::Array(array)) => Ok(array.clone()),
        Some(_) => Err(format!("{name}.{key} must be an array")),
    }
}

fn get_string_array_values(name: &str, table: &Table, key: &str) -> Result<Vec<String>, String> {
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

#[cfg(test)]
mod string_format_tests {
    use super::{is_absolute_uri, is_email, is_hostname, is_ipv4, is_uuid};

    #[test]
    fn validates_difficult_rfc_5321_mailboxes() {
        for valid in [
            "simple@example.com",
            "customer/department=shipping@example.com",
            "$A12345@example.com",
            "!def!xyz%abc@example.com",
            "_somename@example.com",
            "\"Fred Bloggs\"@example.com",
            "\"Joe\\\\Blow\"@example.com",
            "\"Abc@def\"@[192.0.2.1]",
            "user@[IPv6:2001:db8::1]",
            "user@[TAG:printable-data]",
        ] {
            assert!(is_email(valid), "expected valid mailbox: {valid}");
        }
        for invalid in [
            "a..b@example.com",
            ".leading@example.com",
            "trailing.@example.com",
            "unquoted space@example.com",
            "\"unterminated@example.com",
            "\"bad\ncontrol\"@example.com",
            "user@example.com.",
            "user@[IPv6:2001:db8:::1]",
            "user@[bad literal]",
            "ü@example.com",
        ] {
            assert!(!is_email(invalid), "expected invalid mailbox: {invalid}");
        }
        assert!(is_email(&format!("{}@example.com", "a".repeat(64))));
        assert!(!is_email(&format!("{}@example.com", "a".repeat(65))));
    }

    #[test]
    fn validates_other_string_formats() {
        assert!(is_uuid("01234567-89ab-cdef-ABCD-0123456789ab"));
        assert!(!is_uuid("0123456789ab-cdef-abcd-0123456789ab"));
        assert!(is_absolute_uri("https://example.com/a%20b?x=1#part"));
        assert!(is_absolute_uri("urn:isbn:0451450523"));
        assert!(is_absolute_uri("scheme:"));
        assert!(is_absolute_uri("http://[v1.fe]/"));
        assert!(!is_absolute_uri("/relative/path"));
        assert!(!is_absolute_uri("https://example.com/%xy"));
        assert!(!is_absolute_uri("http://example.com/#first#second"));
        assert!(is_hostname("example.com."));
        assert!(!is_hostname("bad-.example"));
        assert!(is_ipv4("0.0.0.0"));
        assert!(!is_ipv4("127.00.0.1"));
    }
}
