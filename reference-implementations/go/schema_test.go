package main

import (
	"bytes"
	"fmt"
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

func TestEnforcesSemverSchemaVersions(t *testing.T) {
	dir := t.TempDir()
	compatibleSchema := write(t, dir, "compatible-version.tosd", `
[toml-schema]
version = "1.0.1+build.1"

[elements.title]
type = "string"
`)
	if _, err := LoadSchema(compatibleSchema); err != nil {
		t.Fatalf("expected compatible patch version to load: %v", err)
	}

	for _, version := range []string{"1", "1.0", "01.0.0", "1.1.0", "2.0.0"} {
		schemaPath := write(t, dir, "invalid-version-"+strings.ReplaceAll(version, ".", "-")+".tosd", fmt.Sprintf(`
[toml-schema]
version = %q

[elements.title]
type = "string"
`, version))
		if _, err := LoadSchema(schemaPath); err == nil {
			t.Fatalf("expected version %q to be rejected", version)
		}
	}
}

func TestReportsValidationErrors(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

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
version = "1.0.0"

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
version = "1.0.0"

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

func TestSupportsBuiltInTypeReferences(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[elements.name]
typeof = "string"

[elements.flags]
type = "array"
itemtype = "boolean"

[elements.tuple]
type = "array"
items = [ "string", "integer" ]

[elements.identity]
oneof = [ "string", "integer" ]

[elements.flex]
anyof = [ "string", "integer" ]
`)
	documentPath := write(t, dir, "document.toml", `
name = "Alice"
flags = [ true, false ]
tuple = [ "port", 8080 ]
identity = 42
flex = "abc"
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

func TestRejectsTypesNamedAfterBuiltIns(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[types.string]
type = "integer"

[elements.value]
type = "string"
`)

	if _, err := LoadSchema(schemaPath); err == nil {
		t.Fatal("expected reserved built-in type name to be rejected")
	}
}

func TestRejectsTableCollectionAlias(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[types.item]
type = "table"

    [types.item.name]
    type = "string"

[elements.items]
type = "table-collection"
typeof = "types.item"
`)

	if _, err := LoadSchema(schemaPath); err == nil {
		t.Fatal("expected table-collection alias to be rejected")
	}
}

func TestRejectsOccurrenceAliases(t *testing.T) {
	dir := t.TempDir()
	aliases := []string{"minoccurs", "maxoccurs"}
	for _, alias := range aliases {
		schemaPath := write(t, dir, alias+".tosd", fmt.Sprintf(`
[toml-schema]
version = "1.0.0"

[elements.values]
type = "array"
arraytype = "string"
%s = 1
`, alias))
		if _, err := LoadSchema(schemaPath); err == nil {
			t.Fatalf("expected %s alias to be rejected", alias)
		}
	}
}

func TestValidatesTupleArraysByPosition(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[types.label]
type = "string"

[types.coordinateLabel]
type = "array"
items = [ "types.coordinate", "types.label" ]

[elements.value]
type = "array"
items = [ "types.coordinateLabel", "types.coordinate" ]
`)
	documentPath := write(t, dir, "document.toml", `
value = [ [ 1.5, "Hello" ], 2.0 ]
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

func TestRejectsInvalidTupleArrays(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[types.label]
type = "string"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
`)
	wrongOrderPath := write(t, dir, "wrong-order.toml", `
value = [ "Hello", 1.5 ]
`)
	tooShortPath := write(t, dir, "too-short.toml", `
value = [ 1.5 ]
`)
	tooLongPath := write(t, dir, "too-long.toml", `
value = [ 1.5, "Hello", true ]
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	wrongOrder := schema.ValidateFile(wrongOrderPath)
	if wrongOrder.Valid() || !hasPath(wrongOrder, "$.value[0]") || !hasPath(wrongOrder, "$.value[1]") {
		t.Fatalf("expected positional tuple errors, got %#v", wrongOrder.Errors)
	}

	tooShort := schema.ValidateFile(tooShortPath)
	if tooShort.Valid() || !hasPath(tooShort, "$.value") {
		t.Fatalf("expected tuple length error, got %#v", tooShort.Errors)
	}

	tooLong := schema.ValidateFile(tooLongPath)
	if tooLong.Valid() || !hasPath(tooLong, "$.value") {
		t.Fatalf("expected tuple length error, got %#v", tooLong.Errors)
	}
}

func TestRejectsTupleSchemaWithConflictingProperties(t *testing.T) {
	dir := t.TempDir()
	conflicts := []string{
		`
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
arraytype = "string"
`,
		`
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
minlength = 2
`,
	}
	for index, schemaContent := range conflicts {
		_, err := LoadSchema(write(t, dir, fmt.Sprintf("schema-%d.tosd", index), schemaContent))
		if err == nil {
			t.Fatalf("expected schema conflict error for case %d", index)
		}
	}
}

func TestSupportsQuotedDottedAndEmptyKeysWithChildrenTable(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

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
version = "1.0.0"

[elements.title]
type = "string"
`)
	documentPath := write(t, dir, "document.toml", `
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
	documentPath := write(t, dir, "extract-source.toml", `
title = "Example"
enabled = true
ports = [8080, 8081]

[owner]
name = "Alice"

[site]
"google.com" = true

[toml-schema]
version = "1.0.0"
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
		`version = "1.0.0"`,
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
