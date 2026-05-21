package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidatesCheckedInExample(t *testing.T) {
	schema, err := LoadSchema(fixture("config.tosd"))
	if err != nil {
		t.Fatal(err)
	}

	result := schema.ValidateFile(fixture("config.toml"))

	if !result.Valid() {
		t.Fatalf("expected valid document, got %#v", result.Errors)
	}
}

func TestReportsValidationErrors(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1"

[elements.name]
type = "string"
minlength = 2
pattern = "^[a-z]+$"

[elements.port]
type = "integer"
min = 1
max = 65535
`)
	documentPath := write(t, dir, "document.toml", `
name = "A"
port = 70000
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	result := schema.ValidateFile(documentPath)

	if result.Valid() {
		t.Fatal("expected validation errors")
	}
	if len(result.Errors) != 3 {
		t.Fatalf("expected 3 errors, got %#v", result.Errors)
	}
	if !hasPath(result, "$.name") || !hasPath(result, "$.port") {
		t.Fatalf("expected name and port errors, got %#v", result.Errors)
	}
}

func TestPatternMustMatchEntireString(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1"

[elements.id]
type = "string"
pattern = "\\d+"
`)
	documentPath := write(t, dir, "document.toml", `
id = "abc123"
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	result := schema.ValidateFile(documentPath)

	if result.Valid() {
		t.Fatal("expected unanchored pattern not to match the entire string")
	}
	if !hasPath(result, "$.id") {
		t.Fatalf("expected id pattern error, got %#v", result.Errors)
	}
}

func TestValidatesUnionsAndArrayItemSchemas(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1"

[types.stringId]
type = "string"
pattern = "^[a-z]+$"

[types.intId]
type = "integer"
min = 1

[types.named]
type = "table"

    [types.named.name]
    type = "string"

[types.numbered]
type = "table"

    [types.numbered.id]
    type = "integer"

[types.namedOrNumbered]
oneof = [ "types.named", "types.numbered" ]

[elements.id]
anyof = [ "types.stringId", "types.intId" ]

[elements.entries]
type = "array"
arraytype = "table"
itemtype = "types.namedOrNumbered"
`)
	documentPath := write(t, dir, "document.toml", `
id = "abc"
entries = [
  { name = "alpha" },
  { id = 1 }
]
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	result := schema.ValidateFile(documentPath)

	if !result.Valid() {
		t.Fatalf("expected valid document, got %#v", result.Errors)
	}
}

func TestSupportsQuotedDottedAndEmptyKeysWithChildrenTable(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1"

[elements.site]
type = "table"

    [elements.site.children]
    "google.com" = { type = "boolean" }

[elements.children]
"" = { type = "string" }
`)
	documentPath := write(t, dir, "document.toml", `
"" = "blank"

[site]
"google.com" = true
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	result := schema.ValidateFile(documentPath)

	if !result.Valid() {
		t.Fatalf("expected valid document, got %#v", result.Errors)
	}
}

func TestCLILocatesSchemaFromDocumentMetadata(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "schema.tosd", `
[toml-schema]
version = "1"

[elements.title]
type = "string"
`)
	documentPath := write(t, dir, "document.toml", `
title = "Example"

[toml-schema]
version = "1"
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
	documentPath := write(t, dir, "extract-source.toml", `
title = "Example"
enabled = true
ports = [8080, 8081]

[owner]
name = "Alice"

[site]
"google.com" = true

[toml-schema]
version = "1"
location = "ignored.tosd"
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

	schemaBytes, err := os.ReadFile(extractedSchema)
	if err != nil {
		t.Fatal(err)
	}
	schemaText := string(schemaBytes)
	for _, expected := range []string{
		"[elements.title]",
		`type = "string"`,
		"[elements.owner]",
		"[elements.owner.name]",
		`[elements.site."google.com"]`,
		`arraytype = "integer"`,
	} {
		if !strings.Contains(schemaText, expected) {
			t.Fatalf("expected extracted schema to contain %q:\n%s", expected, schemaText)
		}
	}
	if strings.Contains(schemaText, "[elements.toml-schema]") {
		t.Fatalf("extracted schema should not include reserved metadata:\n%s", schemaText)
	}

	schema, err := LoadSchema(extractedSchema)
	if err != nil {
		t.Fatal(err)
	}
	result := schema.ValidateFile(documentPath)
	if !result.Valid() {
		t.Fatalf("expected extracted schema to validate source document, got %#v", result.Errors)
	}
}

func write(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func fixture(name string) string {
	candidates := []string{
		filepath.Join("..", "..", name),
		filepath.Join("..", "..", "..", name),
		name,
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return name
}

func hasPath(result ValidationResult, path string) bool {
	for _, validationError := range result.Errors {
		if validationError.Path == path {
			return true
		}
	}
	return false
}
