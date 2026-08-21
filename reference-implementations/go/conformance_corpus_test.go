package tomlschema

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	toml "github.com/pelletier/go-toml/v2"
)

// conformanceManifest mirrors the shape of conformance/manifest.toml.
type conformanceManifest struct {
	Case []conformanceCase `toml:"case"`
}

type conformanceCase struct {
	ID       string `toml:"id"`
	Expect   string `toml:"expect"`
	Document bool   `toml:"document"`
}

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

// outcomeForCase returns the observed outcome ("schema-load-error",
// "validation-failure", or "valid") plus diagnostic detail. Load failure and
// validation failure are kept strictly distinct.
func outcomeForCase(caseDir string, hasDocument bool) (string, string) {
	schema, err := LoadSchema(filepath.Join(caseDir, "schema.tosd"))
	if err != nil {
		return "schema-load-error", err.Error()
	}

	if !hasDocument {
		return "valid", ""
	}

	result := schema.ValidateFile(filepath.Join(caseDir, "document.toml"))
	if result.Valid() {
		return "valid", ""
	}

	detail := ""
	for i, e := range result.Errors {
		if i > 0 {
			detail += "; "
		}
		detail += e.Path + ": " + e.Message
	}
	return "validation-failure", detail
}

func TestConformanceCorpus(t *testing.T) {
	root := conformanceRoot(t)
	conformance := filepath.Join(root, "conformance")

	data, err := os.ReadFile(filepath.Join(conformance, "manifest.toml"))
	if err != nil {
		t.Fatalf("read manifest.toml: %v", err)
	}

	var manifest conformanceManifest
	if err := toml.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("parse manifest.toml: %v", err)
	}

	if len(manifest.Case) == 0 {
		t.Fatal("manifest contained no cases")
	}

	type mismatch struct {
		id       string
		expected string
		actual   string
		detail   string
	}
	var mismatches []mismatch

	for _, c := range manifest.Case {
		caseDir := filepath.Join(conformance, "cases", c.ID)
		actual, detail := outcomeForCase(caseDir, c.Document)
		if actual != c.Expect {
			mismatches = append(mismatches, mismatch{c.ID, c.Expect, actual, detail})
		}
	}

	if len(mismatches) > 0 {
		t.Errorf("%d of %d conformance cases mismatched:", len(mismatches), len(manifest.Case))
		for _, m := range mismatches {
			t.Errorf("  %s: expected %s, got %s\n      detail: %s", m.id, m.expected, m.actual, m.detail)
		}
	}
}
