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

func TestCLIAllowsDocumentSchemaVersionToBeOmitted(t *testing.T) {
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
location = "schema.tosd"
`)
	var out bytes.Buffer
	var errOut bytes.Buffer

	exitCode := run([]string{"validate", documentPath}, &out, &errOut)

	if exitCode != 0 || errOut.Len() != 0 {
		t.Fatalf("expected successful validation without a warning, got %d: %s", exitCode, errOut.String())
	}
}

func TestCLIWarnsOnNonMajorDocumentSchemaVersionMismatch(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.1"

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
	const expected = "Warning: document expects TOML Schema version 1.0.0, but resolved schema uses 1.0.1\n"
	if errOut.String() != expected {
		t.Fatalf("expected warning %q, got %q", expected, errOut.String())
	}
}

func TestCLIRejectsMajorDocumentSchemaVersionMismatch(t *testing.T) {
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
version = "2.0.0"
location = "schema.tosd"
`)
	var out bytes.Buffer
	var errOut bytes.Buffer

	exitCode := run([]string{"validate", documentPath}, &out, &errOut)

	if exitCode != 2 {
		t.Fatalf("expected exit code 2, got %d", exitCode)
	}
	if !strings.Contains(errOut.String(),
		"Document expects TOML Schema major version 2.0.0, but resolved schema uses 1.0.0") {
		t.Fatalf("unexpected error: %q", errOut.String())
	}
}

func TestCLIRejectsMalformedDocumentSchemaVersions(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
`)
	for name, version := range map[string]string{
		"shorthand":  `"1.0"`,
		"non-string": "1",
	} {
		t.Run(name, func(t *testing.T) {
			documentPath := writeFile(t, dir, name+".toml", `
title = "Example"

[toml-schema]
version = `+version+`
location = "schema.tosd"
`)
			var out bytes.Buffer
			var errOut bytes.Buffer

			exitCode := run([]string{"validate", documentPath}, &out, &errOut)

			if exitCode != 2 || !strings.Contains(errOut.String(), "Document [toml-schema].version must") {
				t.Fatalf("expected malformed version error, got %d: %q", exitCode, errOut.String())
			}
		})
	}
}

func TestCLIRejectsUnsupportedSchemaLocationScheme(t *testing.T) {
	dir := t.TempDir()
	documentPath := writeFile(t, dir, "document.toml", `
[toml-schema]
location = "https://example.com/schema.tosd"
`)
	var out bytes.Buffer
	var errOut bytes.Buffer

	exitCode := run([]string{"validate", documentPath}, &out, &errOut)

	if exitCode != 2 || !strings.Contains(errOut.String(), "Unsupported schema location URI scheme: https") {
		t.Fatalf("expected unsupported scheme error, got %d: %q", exitCode, errOut.String())
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
