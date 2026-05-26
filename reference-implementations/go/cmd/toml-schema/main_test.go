package main

import (
	"bytes"
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
