package tomlschema

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"

	toml "github.com/pelletier/go-toml/v2"
)

// conformanceRoot walks up from this test file's directory until it finds the
// repository root (the directory containing conformance/manifest.toml).
func conformanceRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not determine caller path")
	}
	dir := filepath.Dir(file)
	for {
		if _, err := os.Stat(filepath.Join(dir, "conformance", "manifest.toml")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate repository root containing conformance/manifest.toml")
		}
		dir = parent
	}
}

// registry mirrors conformance/codes.toml.
type registry struct {
	codes            map[string]registryEntry
	extensionPattern *regexp.Regexp
}

type registryEntry struct {
	severity string
	phases   map[string]bool
}

func loadRegistry(t *testing.T, conformance string) registry {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(conformance, "codes.toml"))
	if err != nil {
		t.Fatalf("read codes.toml: %v", err)
	}
	var parsed struct {
		ExtensionPattern string `toml:"extension_pattern"`
		Code             []struct {
			Name     string   `toml:"name"`
			Severity string   `toml:"severity"`
			Phases   []string `toml:"phases"`
		} `toml:"code"`
	}
	if err := toml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("parse codes.toml: %v", err)
	}
	pattern, err := regexp.Compile(parsed.ExtensionPattern)
	if err != nil {
		t.Fatalf("compile extension_pattern: %v", err)
	}
	codes := map[string]registryEntry{}
	for _, code := range parsed.Code {
		phases := map[string]bool{}
		for _, phase := range code.Phases {
			phases[phase] = true
		}
		codes[code.Name] = registryEntry{severity: code.Severity, phases: phases}
	}
	return registry{codes: codes, extensionPattern: pattern}
}

func (r registry) isExtension(code string) bool {
	return r.extensionPattern.MatchString(code)
}

// caseRun captures the coarse outcome plus every diagnostic a case emitted.
type caseRun struct {
	outcome     string
	detail      string
	diagnostics []Diagnostic
}

func runCase(caseDir string, hasDocument bool) caseRun {
	schema, err := LoadSchema(filepath.Join(caseDir, "schema.tosd"))
	if err != nil {
		return caseRun{outcome: "schema-load-error", detail: err.Error(), diagnostics: []Diagnostic{schemaLoadDiagnostic(err)}}
	}
	if !hasDocument {
		return caseRun{outcome: "valid"}
	}

	result, err := schema.ValidateFile(filepath.Join(caseDir, "document.toml"))
	if err != nil {
		// A document that is not well-formed TOML never reaches the validator,
		// so it yields no diagnostics at all.
		return caseRun{outcome: "document-parse-error", detail: err.Error()}
	}

	diagnostics := append([]Diagnostic{}, result.Errors...)
	diagnostics = append(diagnostics, result.Warnings...)
	if result.Valid() {
		return caseRun{outcome: "valid", diagnostics: diagnostics}
	}
	details := make([]string, 0, len(result.Errors))
	for _, e := range result.Errors {
		details = append(details, fmt.Sprintf("[%s] %s: %s", e.Code, e.Path, e.Message))
	}
	return caseRun{outcome: "validation-failure", detail: strings.Join(details, "; "), diagnostics: diagnostics}
}

// schemaLoadDiagnostic converts a schema-load error into its normative
// diagnostic. A structured *SchemaError carries its own code and schema path;
// any other error defaults to schema-malformed with no path.
func schemaLoadDiagnostic(err error) Diagnostic {
	var schemaErr *SchemaError
	if errors.As(err, &schemaErr) {
		return schemaErr.Diagnostic()
	}
	return Diagnostic{Phase: PhaseSchemaLoad, Severity: SeverityError, Code: "schema-malformed", Message: err.Error()}
}

type expectation struct {
	phase        string
	severity     string
	code         string
	instancePath *string
	schemaPath   *string
}

func (e expectation) matchedBy(d Diagnostic) bool {
	if string(d.Phase) != e.phase || string(d.Severity) != e.severity || d.Code != e.code {
		return false
	}
	if e.instancePath != nil && d.Path != *e.instancePath {
		return false
	}
	if e.schemaPath != nil && d.SchemaPath != *e.schemaPath {
		return false
	}
	return true
}

func (e expectation) describe() string {
	return fmt.Sprintf("phase=%s severity=%s code=%s instance_path=%v schema_path=%v",
		e.phase, e.severity, e.code, derefOrNil(e.instancePath), derefOrNil(e.schemaPath))
}

func derefOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

// pathParses validates an instance-path or schema-path string against the
// grammar of `### Instance Path` / `### Schema Path` (README universal check 5).
func pathParses(path string) bool {
	if len(path) == 0 || path[0] != '$' {
		return false
	}
	index := 1
	for index < len(path) {
		switch path[index] {
		case '.':
			index++
			if index >= len(path) {
				return false
			}
			if path[index] == '"' {
				index++
				for {
					if index >= len(path) {
						return false
					}
					if path[index] == '"' {
						index++
						break
					}
					if path[index] == '\\' {
						index += 2
						continue
					}
					index++
				}
			} else {
				start := index
				for index < len(path) && isBareSegmentByte(path[index]) {
					index++
				}
				if index == start {
					return false
				}
			}
		case '[':
			index++
			start := index
			for index < len(path) && path[index] >= '0' && path[index] <= '9' {
				index++
			}
			digits := path[start:index]
			if len(digits) == 0 {
				return false
			}
			if len(digits) > 1 && digits[0] == '0' {
				return false
			}
			if index >= len(path) || path[index] != ']' {
				return false
			}
			index++
		default:
			return false
		}
	}
	return true
}

func isBareSegmentByte(b byte) bool {
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') || b == '_' || b == '-'
}

// universalCheckViolations applies the six universal checks from
// conformance/README.md to one diagnostic.
func universalCheckViolations(d Diagnostic, reg registry) []string {
	var violations []string
	code := d.Code

	entry, registered := reg.codes[code]
	if !registered && !reg.isExtension(code) {
		violations = append(violations, fmt.Sprintf("code %q is neither registered nor an extension code", code))
	}

	severity := string(d.Severity)
	if severity != "error" && severity != "warning" {
		violations = append(violations, fmt.Sprintf("invalid severity %q", severity))
	}
	phase := string(d.Phase)
	if phase != "discovery" && phase != "schema-load" && phase != "validation" {
		violations = append(violations, fmt.Sprintf("invalid phase %q", phase))
	}

	isWarnCode := code == "deprecated" || code == "version-mismatch"
	if severity == "warning" && !isWarnCode {
		violations = append(violations, fmt.Sprintf("code %q emitted as a warning", code))
	}
	if severity == "error" && isWarnCode {
		violations = append(violations, fmt.Sprintf("code %q must be a warning", code))
	}

	if (phase == "schema-load" || phase == "discovery") && d.Path != "" {
		violations = append(violations, fmt.Sprintf("%s diagnostic %q carries instance_path %q", phase, code, d.Path))
	}

	if d.Path != "" && !pathParses(d.Path) {
		violations = append(violations, fmt.Sprintf("instance_path %q does not parse", d.Path))
	}
	if d.SchemaPath != "" && !pathParses(d.SchemaPath) {
		violations = append(violations, fmt.Sprintf("schema_path %q does not parse", d.SchemaPath))
	}

	if registered {
		if entry.severity != severity {
			violations = append(violations, fmt.Sprintf("code %q emitted with severity %q but registry says %q", code, severity, entry.severity))
		}
		if !entry.phases[phase] {
			violations = append(violations, fmt.Sprintf("code %q emitted in phase %q but registry disallows it", code, phase))
		}
	}

	return violations
}

type manifestCase struct {
	ID          string `toml:"id"`
	Expect      string `toml:"expect"`
	Document    bool   `toml:"document"`
	Diagnostics []struct {
		Phase        string  `toml:"phase"`
		Severity     string  `toml:"severity"`
		Code         string  `toml:"code"`
		InstancePath *string `toml:"instance_path"`
		SchemaPath   *string `toml:"schema_path"`
	} `toml:"diagnostics"`
}

func TestConformanceCorpus(t *testing.T) {
	root := conformanceRoot(t)
	conformance := filepath.Join(root, "conformance")
	reg := loadRegistry(t, conformance)

	data, err := os.ReadFile(filepath.Join(conformance, "manifest.toml"))
	if err != nil {
		t.Fatalf("read manifest.toml: %v", err)
	}
	var manifest struct {
		Case []manifestCase `toml:"case"`
	}
	if err := toml.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("parse manifest.toml: %v", err)
	}
	if len(manifest.Case) == 0 {
		t.Fatal("manifest contained no cases")
	}

	var failures []string
	for _, c := range manifest.Case {
		caseDir := filepath.Join(conformance, "cases", c.ID)
		run := runCase(caseDir, c.Document)

		if run.outcome != c.Expect {
			failures = append(failures, fmt.Sprintf("  %s: expected outcome %s, got %s\n      detail: %s",
				c.ID, c.Expect, run.outcome, run.detail))
		}

		for _, d := range run.diagnostics {
			for _, violation := range universalCheckViolations(d, reg) {
				failures = append(failures, fmt.Sprintf("  %s: universal-check: %s", c.ID, violation))
			}
		}

		errorCount := 0
		for _, d := range run.diagnostics {
			if d.Severity == SeverityError {
				errorCount++
			}
		}
		if c.Expect == "valid" && errorCount != 0 {
			failures = append(failures, fmt.Sprintf("  %s: universal-check: valid case emitted %d error diagnostic(s)", c.ID, errorCount))
		}
		if c.Expect == "validation-failure" && errorCount == 0 {
			failures = append(failures, fmt.Sprintf("  %s: universal-check: validation-failure emitted no error diagnostic", c.ID))
		}

		for _, decl := range c.Diagnostics {
			want := expectation{
				phase: decl.Phase, severity: decl.Severity, code: decl.Code,
				instancePath: decl.InstancePath, schemaPath: decl.SchemaPath,
			}
			matched := false
			for _, d := range run.diagnostics {
				if want.matchedBy(d) {
					matched = true
					break
				}
			}
			if !matched {
				observed := make([]string, 0, len(run.diagnostics))
				for _, d := range run.diagnostics {
					observed = append(observed, fmt.Sprintf("{phase=%s severity=%s code=%s instance_path=%q schema_path=%q}",
						d.Phase, d.Severity, d.Code, d.Path, d.SchemaPath))
				}
				failures = append(failures, fmt.Sprintf("  %s: missing expected diagnostic: %s\n      observed: [%s]",
					c.ID, want.describe(), strings.Join(observed, ", ")))
			}
		}
	}

	if len(failures) > 0 {
		t.Fatalf("%d conformance assertion(s) failed across %d cases:\n%s",
			len(failures), len(manifest.Case), strings.Join(failures, "\n"))
	}
}

// TestEveryEmittableCodeIsRegistered is the registry guard: every code the
// implementation can emit is registered (or is a valid extension code).
func TestEveryEmittableCodeIsRegistered(t *testing.T) {
	root := conformanceRoot(t)
	reg := loadRegistry(t, filepath.Join(root, "conformance"))
	var unregistered []string
	for _, code := range EmittableDiagnosticCodes {
		if _, ok := reg.codes[code]; !ok && !reg.isExtension(code) {
			unregistered = append(unregistered, code)
		}
	}
	if len(unregistered) > 0 {
		t.Fatalf("emittable codes missing from conformance/codes.toml (and not extension codes): %v", unregistered)
	}
}
