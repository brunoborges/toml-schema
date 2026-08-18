package main

import (
	"bytes"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCLILocatesSchemaFromDocumentMetadata(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
`)
	documentPath := writeFile(t, dir, "document.toml", `
title = "Example"

[toml-schema]
version = "1.0.0"
location = "schema.tosd"
`)
	var out bytes.Buffer
	var errOut bytes.Buffer

	exitCode := run([]string{"validate", documentPath}, &out, &errOut)

	if exitCode != 0 {
		t.Fatalf("expected exit code 0, got %d: %s", exitCode, errOut.String())
	}
	if !strings.Contains(out.String(), "is valid") {
		t.Fatalf("expected valid output, got %q", out.String())
	}
}

func TestCLIResolvesFileURIAndEnforcesDocumentSchemaVersion(t *testing.T) {
	dir := t.TempDir()
	schemaPath := writeFile(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.1"

[elements.title]
type = "string"
`)
	fileURI := (&url.URL{Scheme: "file", Path: filepath.ToSlash(schemaPath)}).String()
	tests := []struct {
		name         string
		version      string
		location     string
		wantExitCode int
		wantError    string
	}{
		{
			name:         "file-uri-warning",
			version:      `version = "1.0.0"`,
			location:     fileURI,
			wantExitCode: 0,
			wantError:    "Warning: document expects TOML Schema version 1.0.0, but resolved schema uses 1.0.1",
		},
		{
			name:         "major-version-mismatch",
			version:      `version = "2.0.0"`,
			location:     fileURI,
			wantExitCode: 2,
			wantError:    "document expects TOML Schema major version 2.0.0, but resolved schema uses 1.0.1",
		},
		{
			name:         "unsupported-scheme",
			location:     "https://example.com/schema.tosd",
			wantExitCode: 2,
			wantError:    "unsupported schema location URI scheme: https",
		},
		{
			name:         "opaque-file-uri",
			location:     "file:schema.tosd",
			wantExitCode: 2,
			wantError:    "invalid file schema location",
		},
		{
			name:         "file-uri-query",
			location:     fileURI + "?version=1",
			wantExitCode: 2,
			wantError:    "invalid file schema location",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			documentPath := writeFile(t, dir, test.name+".toml", fmt.Sprintf(`
title = "Example"

[toml-schema]
%s
location = %q
`, test.version, test.location))
			var out bytes.Buffer
			var errOut bytes.Buffer

			exitCode := run([]string{"validate", documentPath}, &out, &errOut)

			if exitCode != test.wantExitCode {
				t.Fatalf("expected exit code %d, got %d: %s", test.wantExitCode, exitCode, errOut.String())
			}
			if !strings.Contains(errOut.String(), test.wantError) {
				t.Fatalf("expected %q, got %q", test.wantError, errOut.String())
			}
		})
	}
}

func TestCLIExtractsSchemaFromTomlDocument(t *testing.T) {
	dir := t.TempDir()
	documentPath := writeFile(t, dir, "extract-source.toml", `
title = "Example"
enabled = true
ports = [8080, 8081]
`)
	extractedSchema := filepath.Join(dir, "extract-output.tosd")
	var out bytes.Buffer
	var errOut bytes.Buffer

	exitCode := run([]string{"extract", documentPath, extractedSchema}, &out, &errOut)

	if exitCode != 0 {
		t.Fatalf("expected exit code 0, got %d: %s", exitCode, errOut.String())
	}
	if !strings.Contains(out.String(), "Extracted schema to") {
		t.Fatalf("expected extract output, got %q", out.String())
	}
	if _, err := os.Stat(extractedSchema); err != nil {
		t.Fatal(err)
	}
}

func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}
