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
//!
//! In addition to the coarse outcome, cases may declare `[[case.diagnostics]]`
//! expectations. Those follow the REQUIRED-PRESENT (subset) contract from
//! `conformance/README.md`: every listed diagnostic must be present, compared on
//! `(phase, severity, code, instance_path, schema_path)` and never on message
//! text, with an omitted path meaning "unasserted". Every emitted diagnostic is
//! also held to the six universal checks.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use toml::Value;
use toml_schema::schema::{Diagnostic, Schema, EMITTABLE_DIAGNOSTIC_CODES};

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

/// The registry loaded from `conformance/codes.toml`.
struct Registry {
    codes: BTreeMap<String, RegistryEntry>,
    extension_pattern: regex::Regex,
}

struct RegistryEntry {
    severity: String,
    phases: BTreeSet<String>,
}

impl Registry {
    fn load(conformance: &Path) -> Self {
        let text =
            std::fs::read_to_string(conformance.join("codes.toml")).expect("read codes.toml");
        let value: Value = toml::from_str(&text).expect("parse codes.toml");
        let extension_pattern = regex::Regex::new(
            value
                .get("extension_pattern")
                .and_then(Value::as_str)
                .expect("extension_pattern"),
        )
        .expect("compile extension_pattern");
        let mut codes = BTreeMap::new();
        for code in value
            .get("code")
            .and_then(Value::as_array)
            .expect("codes.toml [[code]]")
        {
            let name = code.get("name").and_then(Value::as_str).expect("code name");
            let severity = code
                .get("severity")
                .and_then(Value::as_str)
                .expect("code severity");
            let phases = code
                .get("phases")
                .and_then(Value::as_array)
                .expect("code phases")
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            codes.insert(
                name.to_string(),
                RegistryEntry {
                    severity: severity.to_string(),
                    phases,
                },
            );
        }
        Registry {
            codes,
            extension_pattern,
        }
    }

    fn is_extension(&self, code: &str) -> bool {
        self.extension_pattern.is_match(code)
    }
}

/// Result of running one case: the coarse outcome plus every diagnostic emitted.
struct CaseRun {
    outcome: String,
    detail: String,
    diagnostics: Vec<Diagnostic>,
}

fn run_case(case_dir: &Path, has_document: bool) -> CaseRun {
    let schema_path = case_dir.join("schema.tosd");
    let schema = match Schema::load(&schema_path) {
        Ok(schema) => schema,
        Err(error) => {
            let diagnostics = error.to_diagnostic().into_iter().collect();
            return CaseRun {
                outcome: "schema-load-error".to_string(),
                detail: error.message.clone(),
                diagnostics,
            };
        }
    };

    if !has_document {
        return CaseRun {
            outcome: "valid".to_string(),
            detail: String::new(),
            diagnostics: Vec::new(),
        };
    }

    let document_path = case_dir.join("document.toml");
    let result = match schema.validate_file(&document_path) {
        Ok(result) => result,
        // A document that is not well-formed TOML never reaches the validator,
        // so it yields no diagnostics at all (SPEC.md `### TOML Version
        // Baseline`).
        Err(error) => {
            return CaseRun {
                outcome: "document-parse-error".to_string(),
                detail: error,
                diagnostics: Vec::new(),
            };
        }
    };
    let mut diagnostics = result.errors().to_vec();
    diagnostics.extend(result.warnings().iter().cloned());
    if result.valid() {
        CaseRun {
            outcome: "valid".to_string(),
            detail: String::new(),
            diagnostics,
        }
    } else {
        let detail = result
            .errors()
            .iter()
            .map(|error| format!("[{}] {}: {}", error.code, error.path, error.message))
            .collect::<Vec<_>>()
            .join("; ");
        CaseRun {
            outcome: "validation-failure".to_string(),
            detail,
            diagnostics,
        }
    }
}

/// A `[[case.diagnostics]]` expectation.
struct Expectation {
    phase: String,
    severity: String,
    code: String,
    instance_path: Option<String>,
    schema_path: Option<String>,
}

impl Expectation {
    fn matched_by(&self, diagnostic: &Diagnostic) -> bool {
        if diagnostic.phase.as_str() != self.phase
            || diagnostic.severity.as_str() != self.severity
            || diagnostic.code != self.code
        {
            return false;
        }
        if let Some(instance_path) = &self.instance_path {
            if diagnostic.instance_path() != Some(instance_path.as_str()) {
                return false;
            }
        }
        if let Some(schema_path) = &self.schema_path {
            if diagnostic.schema_path() != Some(schema_path.as_str()) {
                return false;
            }
        }
        true
    }

    fn describe(&self) -> String {
        format!(
            "phase={} severity={} code={} instance_path={:?} schema_path={:?}",
            self.phase, self.severity, self.code, self.instance_path, self.schema_path
        )
    }
}

fn parse_expectations(case: &Value) -> Vec<Expectation> {
    let Some(entries) = case.get("diagnostics").and_then(Value::as_array) else {
        return Vec::new();
    };
    entries
        .iter()
        .map(|entry| Expectation {
            phase: entry
                .get("phase")
                .and_then(Value::as_str)
                .expect("diagnostic phase")
                .to_string(),
            severity: entry
                .get("severity")
                .and_then(Value::as_str)
                .expect("diagnostic severity")
                .to_string(),
            code: entry
                .get("code")
                .and_then(Value::as_str)
                .expect("diagnostic code")
                .to_string(),
            instance_path: entry
                .get("instance_path")
                .and_then(Value::as_str)
                .map(str::to_string),
            schema_path: entry
                .get("schema_path")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect()
}

/// Validates one instance-path or schema-path string against the grammar of
/// `### Instance Path` / `### Schema Path` (README universal check 5).
fn path_parses(path: &str) -> bool {
    let bytes = path.as_bytes();
    if bytes.first() != Some(&b'$') {
        return false;
    }
    let mut index = 1;
    while index < bytes.len() {
        match bytes[index] {
            b'.' => {
                index += 1;
                if index >= bytes.len() {
                    return false;
                }
                if bytes[index] == b'"' {
                    // RFC 8259 JSON string segment.
                    index += 1;
                    loop {
                        if index >= bytes.len() {
                            return false;
                        }
                        match bytes[index] {
                            b'"' => {
                                index += 1;
                                break;
                            }
                            b'\\' => index += 2,
                            _ => index += 1,
                        }
                    }
                } else {
                    // Bare segment of [A-Za-z0-9_-]+.
                    let start = index;
                    while index < bytes.len()
                        && (bytes[index].is_ascii_alphanumeric()
                            || bytes[index] == b'_'
                            || bytes[index] == b'-')
                    {
                        index += 1;
                    }
                    if index == start {
                        return false;
                    }
                }
            }
            b'[' => {
                index += 1;
                let start = index;
                while index < bytes.len() && bytes[index].is_ascii_digit() {
                    index += 1;
                }
                let digits = &path[start..index];
                if digits.is_empty() {
                    return false;
                }
                if digits.len() > 1 && digits.starts_with('0') {
                    return false; // no leading zeros
                }
                if index >= bytes.len() || bytes[index] != b']' {
                    return false;
                }
                index += 1;
            }
            _ => return false,
        }
    }
    true
}

/// Applies the six universal checks from `conformance/README.md` to one
/// diagnostic; returns a list of violation messages.
fn universal_check_violations(diagnostic: &Diagnostic, registry: &Registry) -> Vec<String> {
    let mut violations = Vec::new();
    let code = diagnostic.code.as_str();

    // 1. Code is in the registry or matches the extension pattern.
    let registered = registry.codes.get(code);
    if registered.is_none() && !registry.is_extension(code) {
        violations.push(format!(
            "code {code:?} is neither registered nor an extension code"
        ));
    }

    // 2. severity and phase are valid.
    let severity = diagnostic.severity.as_str();
    if severity != "error" && severity != "warning" {
        violations.push(format!("invalid severity {severity:?}"));
    }
    let phase = diagnostic.phase.as_str();
    if !matches!(phase, "discovery" | "schema-load" | "validation") {
        violations.push(format!("invalid phase {phase:?}"));
    }

    // 3. Only `deprecated` and `version-mismatch` are warnings.
    if severity == "warning" && !matches!(code, "deprecated" | "version-mismatch") {
        violations.push(format!("code {code:?} emitted as a warning"));
    }
    if severity == "error" && matches!(code, "deprecated" | "version-mismatch") {
        violations.push(format!("code {code:?} must be a warning"));
    }

    // 4. Schema-load and discovery diagnostics carry no instance_path.
    if matches!(phase, "schema-load" | "discovery") && diagnostic.instance_path().is_some() {
        violations.push(format!(
            "{phase} diagnostic {code:?} carries instance_path {:?}",
            diagnostic.instance_path()
        ));
    }

    // 5. Both paths, when present, parse under the grammar.
    if let Some(instance_path) = diagnostic.instance_path() {
        if !path_parses(instance_path) {
            violations.push(format!("instance_path {instance_path:?} does not parse"));
        }
    }
    if let Some(schema_path) = diagnostic.schema_path() {
        if !path_parses(schema_path) {
            violations.push(format!("schema_path {schema_path:?} does not parse"));
        }
    }

    // Registry consistency: an emitted registered code must agree with the
    // registry's declared severity and phase set.
    if let Some(entry) = registered {
        if entry.severity != severity {
            violations.push(format!(
                "code {code:?} emitted with severity {severity:?} but registry says {:?}",
                entry.severity
            ));
        }
        if !entry.phases.contains(phase) {
            violations.push(format!(
                "code {code:?} emitted in phase {phase:?} but registry allows {:?}",
                entry.phases
            ));
        }
    }

    violations
}

#[test]
fn conformance_corpus() {
    let root = repository_root();
    let conformance = root.join("conformance");
    let registry = Registry::load(&conformance);
    let manifest_text =
        std::fs::read_to_string(conformance.join("manifest.toml")).expect("read manifest.toml");
    let manifest: Value = toml::from_str(&manifest_text).expect("parse manifest.toml");

    let cases = manifest
        .get("case")
        .and_then(Value::as_array)
        .expect("manifest [[case]] array");

    let mut failures: Vec<String> = Vec::new();
    let mut total = 0usize;

    for case in cases {
        let id = case.get("id").and_then(Value::as_str).expect("case id");
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
        let run = run_case(&case_dir, has_document);

        // Coarse outcome, keeping load-vs-validation strictly distinguished.
        if run.outcome != expect {
            failures.push(format!(
                "  {id}: expected outcome {expect}, got {}\n      detail: {}",
                run.outcome, run.detail
            ));
        }

        // Universal checks on every emitted diagnostic.
        for diagnostic in &run.diagnostics {
            for violation in universal_check_violations(diagnostic, &registry) {
                failures.push(format!("  {id}: universal-check: {violation}"));
            }
        }

        // Universal check 6: valid cases produce no error; validation-failure
        // cases produce at least one error.
        let error_count = run
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity.as_str() == "error")
            .count();
        if expect == "valid" && error_count != 0 {
            failures.push(format!(
                "  {id}: universal-check: valid case emitted {error_count} error diagnostic(s)"
            ));
        }
        if expect == "validation-failure" && error_count == 0 {
            failures.push(format!(
                "  {id}: universal-check: validation-failure emitted no error diagnostic"
            ));
        }

        // REQUIRED-PRESENT diagnostics.
        for expectation in parse_expectations(case) {
            if !run
                .diagnostics
                .iter()
                .any(|diagnostic| expectation.matched_by(diagnostic))
            {
                let observed = run
                    .diagnostics
                    .iter()
                    .map(|diagnostic| {
                        format!(
                            "{{phase={} severity={} code={} instance_path={:?} schema_path={:?}}}",
                            diagnostic.phase.as_str(),
                            diagnostic.severity.as_str(),
                            diagnostic.code,
                            diagnostic.instance_path(),
                            diagnostic.schema_path(),
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                failures.push(format!(
                    "  {id}: missing expected diagnostic: {}\n      observed: [{observed}]",
                    expectation.describe()
                ));
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} conformance assertion(s) failed across {} cases:\n{}",
        failures.len(),
        total,
        failures.join("\n")
    );
}

/// Registry guard: every code the implementation can emit is registered (or is a
/// valid extension code). Mirrors the ABNF vocabulary guard and catches typos in
/// code literals.
#[test]
fn every_emittable_code_is_registered() {
    let root = repository_root();
    let registry = Registry::load(&root.join("conformance"));
    let mut unregistered = Vec::new();
    for code in EMITTABLE_DIAGNOSTIC_CODES {
        if !registry.codes.contains_key(*code) && !registry.is_extension(code) {
            unregistered.push(*code);
        }
    }
    assert!(
        unregistered.is_empty(),
        "emittable codes missing from conformance/codes.toml (and not extension codes): {unregistered:?}"
    );
}
