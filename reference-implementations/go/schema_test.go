package tomlschema

import (
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

func TestSupportsChildrenEscapeHatchForSchemaKeyConflicts(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "escaped-children.tosd", `
[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

[elements.plugin.children.type]
type = "string"

[elements.plugin.children.optional]
type = "boolean"

[elements.plugin.name]
type = "string"
`)
	documentPath := write(t, dir, "escaped-children.toml", `
[plugin]
type = "npm"
optional = true
name = "example"
`)
	invalidEscape := write(t, dir, "invalid-escaped-child.tosd", `
[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

[elements.plugin.children.name]
type = "string"
`)
	emptyEscape := write(t, dir, "empty-escaped-children.tosd", `
[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

[elements.plugin.children]
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(documentPath); !result.Valid() {
		t.Fatalf("expected escaped schema-key children to validate, got %#v", result.Errors)
	}
	if _, err := LoadSchema(invalidEscape); err == nil {
		t.Fatal("expected children escape hatch to reject a non-conflicting name")
	}
	if _, err := LoadSchema(emptyEscape); err == nil {
		t.Fatal("expected children escape hatch to reject an empty namespace")
	}
}

func TestLoadsCheckedInExamples(t *testing.T) {
	for _, name := range []string{
		"cargo.tosd",
		"gitlab-runner.tosd",
		"hugo.tosd",
		"netlify.tosd",
		"pyproject.tosd",
		"wrangler.tosd",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := LoadSchema(filepath.Join(fixture("examples"), name)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSelfSchemaValidatesSchemaDocuments(t *testing.T) {
	dir := t.TempDir()
	invalidPropertyType := write(t, dir, "invalid-property-type.tosd", `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
optional = "yes"
`)
	unknownProperty := write(t, dir, "unknown-property.tosd", `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
optonal = true
`)
	invalidEscape := write(t, dir, "invalid-escape.tosd", `
[toml-schema]
version = "1.0.0"

[elements.parent]
type = "table"

[elements.parent.children.name]
type = "string"
`)
	literalChildren := write(t, dir, "literal-children.tosd", `
[toml-schema]
version = "1.0.0"

[elements.parent]
type = "table"

[elements.parent.children]
type = "array"
itemtype = "string"
`)
	invalidSemantics := []string{
		write(t, dir, "incomplete-conditional.tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
if = { key = "kind", equals = "a" }
then = "types.branch"
`),
		write(t, dir, "competing-selectors.tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
oneof = [ "string" ]
`),
		write(t, dir, "inapplicable-property.tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
pattern = "^[0-9]+$"
`),
		write(t, dir, "tuple-conflict.tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "string" ]
minlength = 1
`),
		write(t, dir, "scalar-child.tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"

[elements.value.child]
type = "string"
`),
	}
	schemaSchema, err := LoadSchema(fixture("toml-schema.tosd"))
	if err != nil {
		t.Fatal(err)
	}

	for _, schemaPath := range []string{
		fixture("toml-schema.tosd"),
		fixture("config.tosd"),
		filepath.Join(fixture("examples"), "database-conditional.tosd"),
	} {
		if result := schemaSchema.ValidateFile(schemaPath); !result.Valid() {
			t.Fatalf("expected self-schema to accept %s, got %#v", schemaPath, result.Errors)
		}
		if result := schemaSchema.ValidateFile(literalChildren); !result.Valid() {
			t.Fatalf("expected self-schema to accept a literal children definition, got %#v", result.Errors)
		}
	}
	for _, schemaPath := range []string{invalidPropertyType, unknownProperty, invalidEscape} {
		if result := schemaSchema.ValidateFile(schemaPath); result.Valid() {
			t.Fatalf("expected self-schema to reject %s", schemaPath)
		}
	}
	for _, schemaPath := range invalidSemantics {
		if result := schemaSchema.ValidateFile(schemaPath); result.Valid() {
			t.Fatalf("expected self-schema to reject semantic violation in %s", schemaPath)
		}
	}
}

func TestValidatesCargoManifestExample(t *testing.T) {
	schema, err := LoadSchema(filepath.Join(fixture("examples"), "cargo.tosd"))
	if err != nil {
		t.Fatal(err)
	}

	result := schema.ValidateFile(fixture("reference-implementations/rust/Cargo.toml"))
	if !result.Valid() {
		t.Fatalf("expected valid Cargo.toml, got %#v", result.Errors)
	}
}

func TestEnforcesClosedRootElementSemantics(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "closed-root.tosd", `
[toml-schema]
version = "1.0.0"

[elements]
`)
	emptyDocument := write(t, dir, "empty.toml", "")
	metadataOnlyDocument := write(t, dir, "metadata-only.toml", `
[toml-schema]
location = "closed-root.tosd"
`)
	applicationDocument := write(t, dir, "application.toml", "extra = true")
	definedRootSchema := write(t, dir, "defined-root.tosd", `
[toml-schema]
version = "1.0.0"

[elements.allowed]
type = "string"
`)
	documentWithExtraKey := write(t, dir, "extra-key.toml", `
allowed = "value"
extra = true
`)
	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}

	for _, document := range []string{emptyDocument, metadataOnlyDocument} {
		if result := schema.ValidateFile(document); !result.Valid() {
			t.Fatalf("expected %s to be valid, got %#v", document, result.Errors)
		}
	}

	result := schema.ValidateFile(applicationDocument)
	if result.Valid() || !hasPath(result, "$.extra") {
		t.Fatalf("expected an unexpected-key error at $.extra, got %#v", result.Errors)
	}

	definedSchema, err := LoadSchema(definedRootSchema)
	if err != nil {
		t.Fatal(err)
	}
	result = definedSchema.ValidateFile(documentWithExtraKey)
	if result.Valid() || !hasPath(result, "$.extra") {
		t.Fatalf("expected an unexpected-key error beside a declared root key, got %#v", result.Errors)
	}

	schemaSchema, err := LoadSchema(fixture("toml-schema.tosd"))
	if err != nil {
		t.Fatal(err)
	}
	if result := schemaSchema.ValidateFile(schemaPath); !result.Valid() {
		t.Fatalf("expected self-schema to accept empty [elements], got %#v", result.Errors)
	}
}

func TestAcceptsStringDescriptionsAndRejectsOtherValues(t *testing.T) {
	dir := t.TempDir()
	describedSchema := write(t, dir, "described.tosd", `
[toml-schema]
version = "1.0.0"

[types.game]
type = "table"
description = "A game object."

[types.game.id]
type = "string"
description = "Unique identifier for the game."

[elements.game]
type = "array"
description = "A list of games."
itemtype = "types.game"
`)
	if _, err := LoadSchema(describedSchema); err != nil {
		t.Fatalf("expected descriptions to load: %v", err)
	}

	invalidSchema := write(t, dir, "invalid-description.tosd", `
[toml-schema]
version = "1.0.0"

[elements.game]
type = "string"
description = 42
`)
	if _, err := LoadSchema(invalidSchema); err == nil {
		t.Fatal("expected non-string description to be rejected")
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

	for _, version := range []string{"1", "1.0", "01.0.0", "1.2.0", "2.0.0"} {
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

func TestRejectsMalformedBoundarySchemas(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"any-min": `
[toml-schema]
version = "1.0.0"

[elements.payload]
type = "any"
min = 1
`,
		"nan-min": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "float"
min = nan
`,
		"string-min": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
min = "1"
`,
		"date-time-min": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "local-date"
min = 2026-01-01T00:00:00Z
`,
	}

	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := LoadSchema(write(t, dir, name+".tosd", content)); err == nil {
				t.Fatal("expected malformed boundary schema to be rejected")
			}
		})
	}
}

func TestValidatesArrayRangesThroughItemtype(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "array-ranges.tosd", `
[toml-schema]
version = "1.0.0"

[types.boundedInteger]
type = "integer"
min = 10
max = 20

[types.smallInteger]
type = "integer"
max = 5

[types.largeInteger]
type = "integer"
min = 6

[types.integerAlternative]
oneof = [ "types.smallInteger", "types.largeInteger" ]

[elements.direct]
type = "array"
itemtype = "integer"
min = 2
max = 4

[elements.named]
type = "array"
itemtype = "types.boundedInteger"
min = 5
max = 25

[elements.alternatives]
type = "array"
itemtype = "types.integerAlternative"
min = 1
max = 10
`)
	validPath := write(t, dir, "valid-array-ranges.toml", `
direct = [2, 3, 4]
named = [10, 20]
alternatives = [2, 8]
`)
	invalidPath := write(t, dir, "invalid-array-ranges.toml", `
direct = [1, 5]
named = [7, 21]
alternatives = [0, 11]
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(validPath); !result.Valid() {
		t.Fatalf("expected comparable itemtype ranges to validate, got %#v", result.Errors)
	}
	result := schema.ValidateFile(invalidPath)
	for _, path := range []string{
		"$.direct[0]", "$.direct[1]",
		"$.named[0]", "$.named[1]",
		"$.alternatives[0]", "$.alternatives[1]",
	} {
		if !hasPath(result, path) {
			t.Fatalf("expected range error at %s, got %#v", path, result.Errors)
		}
	}
}

func TestRejectsArrayRangesForMixedItemtypeAlternatives(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "mixed-array-range.tosd", `
[toml-schema]
version = "1.0.0"

[types.mixed]
oneof = [ "integer", "string" ]

[elements.values]
type = "array"
itemtype = "types.mixed"
min = 1
`)

	if _, err := LoadSchema(schemaPath); err == nil ||
		!strings.Contains(err.Error(), "one comparable built-in type") {
		t.Fatalf("expected mixed itemtype alternatives to reject array min, got %v", err)
	}
}

func TestRejectsMalformedLengthSchemas(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"negative-minlength": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
minlength = -1
`,
		"negative-maxlength": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
maxlength = -1
`,
		"inverted-length": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
minlength = 5
maxlength = 2
`,
		"incompatible-length": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "boolean"
minlength = 1
`,
	}

	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := LoadSchema(write(t, dir, name+".tosd", content)); err == nil {
				t.Fatal("expected malformed length schema to be rejected")
			}
		})
	}
}

func TestEnforcesConstraintsOnScalarAllowedValuesAtSchemaLoadTime(t *testing.T) {
	dir := t.TempDir()
	malformedDefinitions := []string{
		`
type = "string"
allowedvalues = [ "valid", "INVALID" ]
pattern = "^[a-z]+$"
`,
		`
type = "integer"
allowedvalues = [ 1, 2 ]
min = 2
`,
		`
type = "integer"
allowedvalues = [ 2, 3 ]
max = 2
`,
		`
type = "string"
allowedvalues = [ "a", "ok" ]
minlength = 2
`,
		`
type = "string"
allowedvalues = [ "ok", "long" ]
maxlength = 2
`,
		`
type = "string"
allowedvalues = []
`,
		`
type = "string"
allowedvalues = [ 1 ]
`,
		`
type = "array"
itemtype = "integer"
allowedvalues = [ "one" ]
`,
	}

	for index, definition := range malformedDefinitions {
		schemaPath := write(t, dir, fmt.Sprintf("invalid-allowedvalues-%d.tosd", index), `
[toml-schema]
version = "1.0.0"

[elements.value]
`+definition)
		if _, err := LoadSchema(schemaPath); err == nil {
			t.Fatalf("expected malformed allowedvalues schema %d to be rejected", index)
		}
	}

	schemaPath := write(t, dir, "valid-allowedvalues.tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
allowedvalues = [ "ab", "cd" ]
pattern = "^[a-z]+$"
minlength = 2
maxlength = 2
`)
	validDocument := write(t, dir, "valid-allowedvalues.toml", `value = "ab"`)
	invalidDocument := write(t, dir, "invalid-allowedvalues.toml", `value = "ef"`)
	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(validDocument); !result.Valid() {
		t.Fatalf("expected valid allowed value, got %#v", result.Errors)
	}
	result := schema.ValidateFile(invalidDocument)
	if len(result.Errors) != 1 || result.Errors[0].Message != "value is not in allowedvalues" {
		t.Fatalf("expected only allowedvalues membership error, got %#v", result.Errors)
	}
}

func TestPatternMatchesUnanchored(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[elements.id]
type = "string"
pattern = "\\d+"
`)
	// "abc123" contains digits, so unanchored pattern "\d+" should match
	matchingPath := write(t, dir, "matching.toml", `
id = "abc123"
`)
	// "abcdef" contains no digits, so pattern "\d+" should not match
	nonMatchingPath := write(t, dir, "nonmatching.toml", `
id = "abcdef"
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}

	matchResult := schema.ValidateFile(matchingPath)
	if !matchResult.Valid() {
		t.Fatalf("expected unanchored pattern to accept a superstring, got %#v", matchResult.Errors)
	}

	noMatchResult := schema.ValidateFile(nonMatchingPath)
	if noMatchResult.Valid() {
		t.Fatal("expected pattern to reject string with no matching substring")
	}
	if !hasPath(noMatchResult, "$.id") {
		t.Fatalf("expected id pattern error, got %#v", noMatchResult.Errors)
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

func TestValidatesNestedArraysThroughItemtype(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "nested-arrays.tosd", `
[toml-schema]
version = "1.0.0"

[elements.nested]
type = "array"
itemtype = "array"

[elements.mixed]
type = "array"
`)
	validPath := write(t, dir, "valid-nested-arrays.toml", `
nested = [[1, "two"], [true, false]]
mixed = [1, "two", [true]]
`)
	invalidPath := write(t, dir, "invalid-nested-arrays.toml", `
nested = [[1], "not-an-array"]
mixed = [1, "two", [true]]
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}

	validResult := schema.ValidateFile(validPath)
	if !validResult.Valid() {
		t.Fatalf("expected nested arrays and unconstrained mixed items to be valid, got %#v", validResult.Errors)
	}

	invalidResult := schema.ValidateFile(invalidPath)
	if invalidResult.Valid() {
		t.Fatal("expected array itemtype to reject a non-array item")
	}
	if !hasPath(invalidResult, "$.nested[1]") {
		t.Fatalf("expected nested item type error, got %#v", invalidResult.Errors)
	}
}

func TestSupportsBuiltInTypeReferences(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"

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

func TestRejectsInvalidUnionStructureAndChildPlacement(t *testing.T) {
	invalidDefinitions := []string{
		`oneof = []`,
		`anyof = []`,
		"oneof = [ \"string\" ]\npattern = \"x\"",
		"oneof = [ \"string\" ]\ndependentrequired = { a = [\"b\"] }",
		"oneof = [ \"string\" ]\nmutuallyexclusive = [[\"a\", \"b\"]]",
		"anyof = [ \"string\" ]\nexactlyone = [[\"a\", \"b\"]]",
		"anyof = [ \"array\" ]\nuniqueitems = true",
		"oneof = [ \"string\" ]\n\n[elements.value.child]\ntype = \"string\"",
		"type = \"string\"\n\n[elements.value.child]\ntype = \"string\"",
		"type = \"array\"\n\n[elements.value.child]\ntype = \"string\"",
	}

	for index, definition := range invalidDefinitions {
		dir := t.TempDir()
		schemaPath := write(t, dir, fmt.Sprintf("invalid-structure-%d.tosd", index), fmt.Sprintf(`
[toml-schema]
version = "1.0.0"

[elements.value]
%s
`, definition))
		if _, err := LoadSchema(schemaPath); err == nil {
			t.Fatalf("expected invalid structure %d to be rejected", index)
		}
	}
}

func TestValidatesReferenceGraphAtSchemaLoadTime(t *testing.T) {
	invalidReferences := []string{
		`type = ""`,
		`type = "types.missing"`,
		"type = \"array\"\nitemtype = \"\"",
		"type = \"array\"\nitemtype = \"types.missing\"",
		"type = \"array\"\nitems = [ \"\" ]",
		"type = \"array\"\nitems = [ \"types.missing\" ]",
		`oneof = [ "" ]`,
		`oneof = [ "types.missing" ]`,
		`anyof = [ "" ]`,
		`anyof = [ "types.missing" ]`,
		"type = \"table\"\n\n[elements.value.child]\ntype = \"types.missing\"",
	}
	for index, definition := range invalidReferences {
		dir := t.TempDir()
		schemaPath := write(t, dir, fmt.Sprintf("dangling-reference-%d.tosd", index), fmt.Sprintf(`
[toml-schema]
version = "1.0.0"

[elements.value]
%s
`, definition))
		if _, err := LoadSchema(schemaPath); err == nil {
			t.Fatalf("expected dangling reference %d to be rejected", index)
		}
	}

	cycles := []string{
		"[types.first]\ntype = \"types.second\"\n\n[types.second]\ntype = \"types.first\"",
		"[types.first]\noneof = [ \"types.second\" ]\n\n[types.second]\nanyof = [ \"types.first\" ]",
	}
	for index, cycle := range cycles {
		dir := t.TempDir()
		schemaPath := write(t, dir, fmt.Sprintf("selector-cycle-%d.tosd", index), fmt.Sprintf(`
[toml-schema]
version = "1.0.0"

%s

[elements.value]
type = "string"
`, cycle))
		if _, err := LoadSchema(schemaPath); err == nil {
			t.Fatalf("expected selector cycle %d to be rejected", index)
		}
	}

	dir := t.TempDir()
	recursive := write(t, dir, "recursive-structure.tosd", `
[toml-schema]
version = "1.0.0"

[types.node]
type = "table"

    [types.node.children]
    type = "array"
    itemtype = "types.node"

[elements.root]
type = "types.node"
`)
	if _, err := LoadSchema(recursive); err != nil {
		t.Fatalf("expected structural recursion to load: %v", err)
	}
}

func TestValidatesAllowedValuesForArrayWithoutItemtype(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "array-allowedvalues.tosd", `
[toml-schema]
version = "1.0.0"

[elements.colors]
type = "array"
allowedvalues = [ "red", "blue" ]
`)
	validPath := write(t, dir, "valid-array-allowedvalues.toml", `
colors = [ "red", "blue" ]
`)
	invalidPath := write(t, dir, "invalid-array-allowedvalues.toml", `
colors = [ "red", "green" ]
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(validPath); !result.Valid() {
		t.Fatalf("expected array items in allowedvalues to validate, got %#v", result.Errors)
	}
	result := schema.ValidateFile(invalidPath)
	if result.Valid() || !hasPath(result, "$.colors[1]") {
		t.Fatalf("expected disallowed array item error, got %#v", result.Errors)
	}
}

func TestRejectsUnknownProperty(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "unknown-property.tosd", `
[toml-schema]
version = "1.0.0"

[elements.values]
type = "array"
unknownproperty = "string"
`)

	if _, err := LoadSchema(schemaPath); err == nil ||
		!strings.Contains(err.Error(), "unsupported property: unknownproperty") {
		t.Fatalf("expected unknown property to be rejected as unsupported, got %v", err)
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

func TestRejectsTypesNamedWithReferencePrefix(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[types."types.name"]
type = "string"

[elements.value]
type = "name"
`)

	if _, err := LoadSchema(schemaPath); err == nil {
		t.Fatal("expected reserved type-reference prefix to be rejected")
	}
}

func TestResolvesQuotedDottedTypeNamesInBothReferenceForms(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[types."network.endpoint"]
type = "string"

[elements.short]
type = "network.endpoint"

[elements.qualified]
type = "types.network.endpoint"
`)
	documentPath := write(t, dir, "document.toml", `
short = "one"
qualified = "two"
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatalf("load schema: %v", err)
	}
	result := schema.ValidateFile(documentPath)
	if !result.Valid() {
		t.Fatalf("expected dotted type references to validate: %#v", result.Errors)
	}
}

func TestRejectsRemovedTableCollectionAliasAsUnknownReference(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[elements.items]
type = "table-collection"
`)
	if _, err := LoadSchema(schemaPath); err == nil {
		t.Fatal("expected table-collection to be rejected at schema load time")
	}
}

func TestValidatesCollectionKeysAgainstKeyPattern(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "keypattern.tosd", `
[toml-schema]
version = "1.0.0"

[types.serverType]
type = "table"

    [types.serverType.ip]
    type = "string"

[elements.servers]
type = "collection"
itemtype = "types.serverType"
keypattern = "^server_[0-9]+$"
`)
	validDocument := write(t, dir, "valid.toml", `
[servers.server_01]
ip = "10.0.0.1"

[servers.server_02]
ip = "10.0.0.2"
`)
	invalidDocument := write(t, dir, "invalid.toml", `
[servers.server_01]
ip = "10.0.0.1"

[servers.alpha]
ip = "10.0.0.2"
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(validDocument); !result.Valid() {
		t.Fatalf("expected valid keys to pass, got %#v", result.Errors)
	}
	result := schema.ValidateFile(invalidDocument)
	if result.Valid() {
		t.Fatal("expected non-matching key to be rejected")
	}
	if !hasPath(result, "$.servers.alpha") {
		t.Fatalf("expected keypattern error on $.servers.alpha, got %#v", result.Errors)
	}
	if hasPath(result, "$.servers.server_01") {
		t.Fatalf("did not expect error on matching key, got %#v", result.Errors)
	}
}

func TestRejectsRetiredTypeofProperty(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "typeof.tosd", `
[toml-schema]
version = "1.0.0"

[types.nameType]
type = "string"

[elements.name]
typeof = "types.nameType"
`)

	if _, err := LoadSchema(schemaPath); err == nil {
		t.Fatal("expected the retired typeof property to be rejected")
	}
}

func TestAllowsOptionalAndDescriptionOnNamedTypeReference(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "named-reference-metadata.tosd", `
[toml-schema]
version = "1.0.0"

[types.nameType]
type = "string"
pattern = "^[a-z]+$"

[types.inheritedOptional]
type = "string"
optional = true

[elements.name]
type = "types.nameType"
description = "Optional display name."
optional = true

[elements.inherited]
type = "types.inheritedOptional"
optional = false
`)
	documentPath := write(t, dir, "named-reference-metadata.toml", "# name is optional\n")

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(documentPath); !result.Valid() {
		t.Fatalf("expected optional named reference to validate: %#v", result.Errors)
	}
}

func TestRejectsConstraintsAndChildrenOnNamedTypeReference(t *testing.T) {
	invalidSiblings := []string{
		`itemtype = "string"`,
		`items = [ "string" ]`,
		`allowedvalues = [ "name" ]`,
		`pattern = "^[a-z]+$"`,
		`keypattern = "^[a-z]+$"`,
		`min = 1`,
		`max = 1`,
		`minlength = 1`,
		`maxlength = 1`,
		`dependentrequired = { a = ["b"] }`,
		`mutuallyexclusive = [["a", "b"]]`,
		`exactlyone = [["a", "b"]]`,
		`uniqueitems = true`,
		"[elements.name.child]\ntype = \"string\"",
	}

	for index, invalidSibling := range invalidSiblings {
		t.Run(fmt.Sprintf("sibling-%d", index), func(t *testing.T) {
			dir := t.TempDir()
			schemaPath := write(t, dir, "named-reference-constraint.tosd", fmt.Sprintf(`
[toml-schema]
version = "1.0.0"

[types.nameType]
type = "string"

[elements.name]
type = "types.nameType"
%s
`, invalidSibling))

			if _, err := LoadSchema(schemaPath); err == nil || !strings.Contains(err.Error(), "named type reference") {
				t.Fatalf("expected named reference sibling rejection, got %v", err)
			}
		})
	}
}

func TestAllowsItemtypeOnCollection(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "collection-itemtype.tosd", `
[toml-schema]
version = "1.0.0"

[types.stringItem]
type = "string"

[types.integerItem]
type = "integer"

[types.itemType]
oneof = [ "types.stringItem", "types.integerItem" ]

[elements.items]
type = "collection"
itemtype = "types.itemType"
`)
	documentPath := write(t, dir, "collection-itemtype.toml", `
[items]
name = "example"
port = 8080
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(documentPath); !result.Valid() {
		t.Fatalf("expected collection values to validate through itemtype union, got %#v", result.Errors)
	}
}

func TestRejectsBareCollectionAndAnyAlternativeReferences(t *testing.T) {
	dir := t.TempDir()
	invalidDefinitions := map[string]string{
		"collection-without-itemtype": `
type = "collection"
`,
		"prefixed-collection": `
type = "types.collection"
`,
		"collection-itemtype": `
type = "array"
itemtype = "collection"
`,
		"collection-items": `
type = "array"
items = [ "collection" ]
`,
		"collection-oneof": `
oneof = [ "collection", "string" ]
`,
		"collection-anyof": `
anyof = [ "collection", "string" ]
`,
		"any-oneof": `
oneof = [ "any", "string" ]
`,
		"any-anyof": `
anyof = [ "any", "string" ]
`,
	}

	for name, definition := range invalidDefinitions {
		t.Run(name, func(t *testing.T) {
			schemaPath := write(t, dir, name+".tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
`+definition)

			if _, err := LoadSchema(schemaPath); err == nil {
				t.Fatal("expected bare reference to be rejected")
			}
		})
	}
}

func TestAllowsAnyOutsideAlternativesAndNamedCollections(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "valid-special-references.tosd", `
[toml-schema]
version = "1.0.0"

[types.stringMap]
type = "collection"
itemtype = "string"

[elements.direct]
type = "any"

[elements.values]
type = "array"
itemtype = "any"

[elements.tuple]
type = "array"
items = [ "any" ]

[elements.maps]
type = "array"
itemtype = "types.stringMap"
`)
	documentPath := write(t, dir, "valid-special-references.toml", `
direct = { key = 1 }
values = [ 1, "two" ]
tuple = [ true ]
maps = [ { one = "1", two = "2" } ]
`)

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(documentPath); !result.Valid() {
		t.Fatalf("expected valid special references, got %#v", result.Errors)
	}
}

func TestRejectsInvalidTypeSelectorCardinality(t *testing.T) {
	dir := t.TempDir()
	invalidDefinitions := map[string]string{
		"type-and-oneof": `
type = "string"
oneof = [ "string", "integer" ]
`,
		"type-and-anyof": `
type = "string"
anyof = [ "string", "integer" ]
`,
		"oneof-and-anyof": `
oneof = [ "string", "integer" ]
anyof = [ "string", "integer" ]
`,
		"selectorless-leaf": `
description = "selector-less leaf"
`,
	}

	for name, definition := range invalidDefinitions {
		t.Run(name, func(t *testing.T) {
			schemaPath := write(t, dir, name+".tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
`+definition)

			if _, err := LoadSchema(schemaPath); err == nil {
				t.Fatal("expected invalid type selector cardinality to be rejected")
			}
		})
	}
}

func TestInfersTableForSelectorlessDefinitionWithChildren(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "implicit-table.tosd", `
[toml-schema]
version = "1.0.0"

[elements.parent]

    [elements.parent.child]
    type = "string"
`)

	if _, err := LoadSchema(schemaPath); err != nil {
		t.Fatalf("expected child definitions to imply table type: %v", err)
	}
}

func TestRejectsKeyPatternOnNonCollection(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "keypattern-scalar.tosd", `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
keypattern = "^[a-z]+$"
`)

	if _, err := LoadSchema(schemaPath); err == nil {
		t.Fatal("expected keypattern on a scalar to be rejected")
	}
}

func TestRejectsPatternOnNonString(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"pattern-integer": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
pattern = "^[0-9]+$"
`,
		"empty-pattern-integer": `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
pattern = ""
`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := LoadSchema(write(t, dir, name+".tosd", content)); err == nil {
				t.Fatal("expected malformed schema to be rejected")
			}
		})
	}
}

func TestRejectsInvalidKeyPatternRegex(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "keypattern-invalid-regex.tosd", `
[toml-schema]
version = "1.0.0"

[types.itemType]
type = "table"

    [types.itemType.value]
    type = "string"

[elements.items]
type = "collection"
itemtype = "types.itemType"
keypattern = "("
`)

	if _, err := LoadSchema(schemaPath); err == nil {
		t.Fatal("expected invalid keypattern regex to be rejected")
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
itemtype = "string"
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
itemtype = "string"
`,
		`
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
minlength = 2
`,
		`
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "string", "integer" ]
allowedvalues = [ 1 ]
`,
		`
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "string", "integer" ]
min = 1
`,
	}
	for index, schemaContent := range conflicts {
		_, err := LoadSchema(write(t, dir, fmt.Sprintf("schema-%d.tosd", index), schemaContent))
		if err == nil {
			t.Fatalf("expected schema conflict error for case %d", index)
		}
	}
}

func TestRejectsAllowedValuesOnTableAndCollection(t *testing.T) {
	dir := t.TempDir()
	definitions := []string{
		"type = \"table\"\nallowedvalues = [ 1 ]",
		"type = \"collection\"\nitemtype = \"string\"\nallowedvalues = [ 1 ]",
	}
	for index, definition := range definitions {
		schema := fmt.Sprintf(`
[toml-schema]
version = "1.0.0"

[elements.value]
%s
`, definition)
		if _, err := LoadSchema(write(t, dir, fmt.Sprintf("container-%d.tosd", index), schema)); err == nil {
			t.Fatalf("expected allowedvalues container error for case %d", index)
		}
	}
}

func TestSupportsQuotedDottedEmptyAndSchemaKeywordKeys(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"

[elements.""]
type = "string"

[elements.children]
type = "string"

[elements.site."google.com"]
type = "boolean"

[elements.plugin.type]
type = "string"
`)
	documentPath := write(t, dir, "document.toml", `
"" = "blank"
children = "literal"

[site]
"google.com" = true

[plugin]
type = "npm"
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

func TestPreservesNumericPrecisionAndDefinesTemporalOrdering(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "value-semantics.tosd", `
[toml-schema]
version = "1.0.0"

[elements.precise]
type = "integer"
allowedvalues = [ 9007199254740992 ]

[elements.mixed]
type = "integer"
max = 9007199254740992.0

[elements.nanValue]
type = "float"
allowedvalues = [ nan ]

[elements.nanRange]
type = "float"
min = 0.0

[elements.zero]
type = "float"
allowedvalues = [ -0.0 ]

[elements.instant]
type = "offset-date-time"
min = 2024-01-01T00:00:00Z
max = 2024-01-01T00:00:00Z

[elements.instantMember]
type = "offset-date-time"
allowedvalues = [ 2024-01-01T00:00:00Z ]

[elements.localMember]
type = "local-time"
allowedvalues = [ 12:00:00.1 ]

[elements.localDateTime]
type = "local-date-time"
max = 2024-01-01T00:00:00.100

[elements.localDate]
type = "local-date"
max = 2024-01-01

[elements.localTime]
type = "local-time"
max = 12:00:00.100
`)
	validPath := write(t, dir, "value-semantics-valid.toml", `
precise = 9007199254740992
mixed = 9007199254740992
nanValue = nan
nanRange = 0.0
zero = 0.0
instant = 2023-12-31T19:00:00-05:00
instantMember = 2024-01-01T00:00:00+00:00
localMember = 12:00:00.100
localDateTime = 2024-01-01T00:00:00.100
localDate = 2024-01-01
localTime = 12:00:00.100
`)
	invalidPath := write(t, dir, "value-semantics-invalid.toml", `
precise = 9007199254740993
mixed = 9007199254740993
nanValue = 0.0
nanRange = nan
zero = 1.0
instant = 2024-01-01T00:00:00.001Z
instantMember = 2023-12-31T19:00:00-05:00
localMember = 12:00:00.101
localDateTime = 2024-01-01T00:00:00.101
localDate = 2024-01-02
localTime = 12:00:00.101
`)
	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	if result := schema.ValidateFile(validPath); !result.Valid() {
		t.Fatalf("expected valid value semantics, got %#v", result.Errors)
	}
	invalid := schema.ValidateFile(invalidPath)
	for _, path := range []string{
		"$.precise", "$.mixed", "$.nanValue", "$.nanRange", "$.zero",
		"$.instant", "$.instantMember", "$.localMember",
		"$.localDateTime", "$.localDate", "$.localTime",
	} {
		if !hasPath(invalid, path) {
			t.Fatalf("expected error at %s, got %#v", path, invalid.Errors)
		}
	}

	malformedPath := write(t, dir, "value-semantics-malformed.tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
allowedvalues = [ 9007199254740993 ]
max = 9007199254740992.0
`)
	if _, err := LoadSchema(malformedPath); err == nil {
		t.Fatal("expected imprecise allowed value comparison to be rejected at schema load")
	}
}

func TestLocatesSchemaFromDocumentMetadata(t *testing.T) {
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

	schema, document, err := SchemaFromDocument(documentPath)

	if err != nil {
		t.Fatal(err)
	}
	result := schema.Validate(document)
	if !result.Valid() {
		t.Fatalf("expected valid document, got %#v", result.Errors)
	}
}

func TestRejectsNonScalarSchemaReferenceMetadata(t *testing.T) {
	dir := t.TempDir()
	documentPath := write(t, dir, "document.toml", `
[toml-schema]
location = ["schema.tosd"]
`)

	if _, _, err := SchemaFromDocument(documentPath); err == nil || !strings.Contains(err.Error(), "must be a scalar value") {
		t.Fatalf("expected non-scalar metadata error, got %v", err)
	}
}

func TestExtractsSchemaFromTomlDocument(t *testing.T) {
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

	if err := ExtractSchemaFile(documentPath, extractedSchema); err != nil {
		t.Fatal(err)
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
		`itemtype = "integer"`,
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

func TestValidatesRangeBoundariesAtSchemaLoadTime(t *testing.T) {
	dir := t.TempDir()
	load := func(name, definition string) error {
		path := write(t, dir, name+".tosd",
			"[toml-schema]\nversion = \"1.0.0\"\n[elements.value]\n"+definition+"\n")
		_, err := LoadSchema(path)
		return err
	}

	if err := load("valid", "type = \"float\"\nmin = -inf\nmax = inf"); err != nil {
		t.Fatalf("float infinities and ordered bounds must load: %v", err)
	}
	if err := load("ordered", "type = \"integer\"\nmin = 1\nmax = 10"); err != nil {
		t.Fatalf("ordered integer bounds must load: %v", err)
	}
	for name, definition := range map[string]string{
		"numeric":         "type = \"integer\"\nmin = 10\nmax = 1",
		"mixed-precision": "type = \"integer\"\nmin = 9007199254740993\nmax = 9007199254740992.0",
		"offset":          "type = \"offset-date-time\"\nmin = 2024-01-02T00:00:00Z\nmax = 2024-01-01T23:00:00Z",
		"local-date-time": "type = \"local-date-time\"\nmin = 2024-01-02T00:00:00\nmax = 2024-01-01T23:00:00",
		"local-date":      "type = \"local-date\"\nmin = 2024-01-02\nmax = 2024-01-01",
		"local-time":      "type = \"local-time\"\nmin = 12:00:01\nmax = 12:00:00",
		"array":           "type = \"array\"\nitemtype = \"integer\"\nmin = 10\nmax = 1",
	} {
		if err := load(name, definition); err == nil ||
			!strings.Contains(err.Error(), "min must not be greater than max") {
			t.Fatalf("%s: expected load-time reversed-range error, got %v", name, err)
		}
	}
	for name, boundary := range map[string]string{"infinite-min": "min = -inf", "infinite-max": "max = inf"} {
		if err := load(name, "type = \"integer\"\n"+boundary); err == nil ||
			!strings.Contains(err.Error(), "when comparable kind is integer") {
			t.Fatalf("%s: expected load-time integer-infinity error, got %v", name, err)
		}
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
