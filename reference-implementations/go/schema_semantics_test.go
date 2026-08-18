package tomlschema

import (
	"math"
	"strings"
	"testing"
)

func TestSiblingPresenceRules(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.settings]
type = "table"
dependentrequired = { branch = ["git"], tag = ["git"], git = ["url"] }
mutuallyexclusive = [["git", "path"], ["branch", "tag"]]
exactlyone = [["file", "text"]]

[types.settings.git]
type = "string"
optional = true
[types.settings.url]
type = "string"
optional = true
[types.settings.path]
type = "string"
optional = true
[types.settings.branch]
type = "string"
optional = true
[types.settings.tag]
type = "string"
optional = true
[types.settings.file]
type = "string"
optional = true
[types.settings.text]
type = "string"
optional = true

[elements.settings]
type = "types.settings"
`)
	valid := map[string]any{"settings": map[string]any{
		"branch": "main", "git": "repo", "url": "origin", "file": "README.md",
	}}
	if result := schema.Validate(valid); !result.Valid() {
		t.Fatalf("expected sibling rules to pass: %#v", result.Errors)
	}
	for name, settings := range map[string]map[string]any{
		"dependency": {"branch": "main", "file": "README.md"},
		"transitive": {"git": "repo", "file": "README.md"},
		"exclusive":  {"git": "repo", "url": "origin", "path": ".", "file": "README.md"},
		"none":       {},
		"two":        {"file": "README.md", "text": "inline"},
	} {
		t.Run(name, func(t *testing.T) {
			if result := schema.Validate(map[string]any{"settings": settings}); result.Valid() {
				t.Fatal("expected sibling rule violation")
			}
		})
	}
}

func TestAllOfIsAdditiveAndComputesTableClosure(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.base]
type = "table"
[types.base.id]
type = "integer"
[types.base.score]
type = "integer"
min = 1

[types.extended]
type = "table"
allof = ["types.base"]
[types.extended.name]
type = "string"
[types.extended.score]
type = "integer"
max = 10

[elements.item]
type = "types.extended"
`)
	if result := schema.Validate(map[string]any{"item": map[string]any{
		"id": int64(1), "name": "ok", "score": int64(5),
	}}); !result.Valid() {
		t.Fatalf("expected composed table to pass: %#v", result.Errors)
	}

	for name, item := range map[string]map[string]any{
		"base-required": {"name": "ok", "score": int64(5)},
		"base-overlap":  {"id": int64(1), "name": "ok", "score": int64(0)},
		"local-overlap": {"id": int64(1), "name": "ok", "score": int64(11)},
		"closed-union":  {"id": int64(1), "name": "ok", "score": int64(5), "extra": true},
	} {
		t.Run(name, func(t *testing.T) {
			if result := schema.Validate(map[string]any{"item": item}); result.Valid() {
				t.Fatal("expected composed constraint violation")
			}
		})
	}
}

func TestAllOfCollectionAppliesEveryDynamicConstraint(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.positive]
type = "integer"
min = 1

[types.small]
type = "integer"
max = 9

[types.base]
type = "collection"
itemtype = "types.positive"
keypattern = "^x"

[types.composed]
type = "collection"
itemtype = "types.small"
keypattern = "z$"
allof = ["types.base"]

[types.composed.fixed]
type = "string"

[elements.values]
type = "types.composed"
`)
	if result := schema.Validate(map[string]any{"values": map[string]any{
		"fixed": "special", "xyz": int64(5),
	}}); !result.Valid() {
		t.Fatalf("expected composed collection to pass: %#v", result.Errors)
	}
	for name, values := range map[string]map[string]any{
		"first-itemtype":  {"xyz": int64(0)},
		"second-itemtype": {"xyz": int64(10)},
		"first-pattern":   {"ayz": int64(5)},
		"second-pattern":  {"xy": int64(5)},
	} {
		t.Run(name, func(t *testing.T) {
			if result := schema.Validate(map[string]any{"values": values}); result.Valid() {
				t.Fatal("expected every collection component to constrain dynamic keys")
			}
		})
	}
}

func TestUniqueItemsUsesRecursiveTomlEquality(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[elements.values]
type = "array"
itemtype = "any"
uniqueitems = true
`)
	for name, values := range map[string][]any{
		"numeric": {int64(1), float64(1)},
		"zero":    {float64(0), math.Copysign(0, -1)},
		"nan":     {math.NaN(), math.NaN()},
		"arrays":  {[]any{int64(1), "x"}, []any{float64(1), "x"}},
		"tables": {
			map[string]any{"a": int64(1), "b": true},
			map[string]any{"b": true, "a": float64(1)},
		},
	} {
		t.Run(name, func(t *testing.T) {
			result := schema.Validate(map[string]any{"values": values})
			if result.Valid() || !strings.Contains(result.Errors[0].Message, "duplicate item") {
				t.Fatalf("expected duplicate diagnostic: %#v", result.Errors)
			}
		})
	}
	if result := schema.Validate(map[string]any{"values": []any{
		map[string]any{"id": int64(1), "value": "a"},
		map[string]any{"id": int64(1), "value": "b"},
	}}); !result.Valid() {
		t.Fatalf("different complete tables must be unique: %#v", result.Errors)
	}
}

func TestDefaultsAreValidatedInheritedAndNonMutating(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.base]
type = "integer"
min = 1
default = 2

[types.same]
type = "integer"
default = 2

[elements.inherited]
type = "types.base"
optional = true

[elements.local]
type = "types.base"
default = 3
optional = true

[elements.composed]
type = "integer"
allof = ["types.base", "types.same"]
optional = true
`)
	inherited, _ := schema.Element("inherited")
	if value, ok := inherited.Default(); !ok || value != int64(2) {
		t.Fatalf("unexpected inherited default: %#v, %v", value, ok)
	}
	local, _ := schema.Element("local")
	if value, ok := local.Default(); !ok || value != int64(3) {
		t.Fatalf("unexpected local default: %#v, %v", value, ok)
	}
	document := map[string]any{}
	if result := schema.Validate(document); !result.Valid() {
		t.Fatalf("optional defaults should not be materialized: %#v", result.Errors)
	}
	if len(document) != 0 {
		t.Fatalf("validation mutated the document: %#v", document)
	}

	dir := t.TempDir()
	invalid := write(t, dir, "invalid-default.tosd", `
[toml-schema]
version = "1.0.0"
[elements.count]
type = "integer"
min = 2
default = 1
`)
	if _, err := LoadSchema(invalid); err == nil || !strings.Contains(err.Error(), "default is invalid") {
		t.Fatalf("expected invalid default rejection, got %v", err)
	}
	conflict := write(t, dir, "conflicting-default.tosd", `
[toml-schema]
version = "1.0.0"
[types.a]
type = "integer"
default = 1
[types.b]
type = "integer"
default = 2
[elements.value]
type = "integer"
allof = ["types.a", "types.b"]
`)
	if _, err := LoadSchema(conflict); err == nil || !strings.Contains(err.Error(), "conflicting inherited defaults") {
		t.Fatalf("expected default conflict rejection, got %v", err)
	}
}

func TestDeprecatedProducesStructuredBranchLocalWarnings(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.legacy]
type = "string"
pattern = "^old$"
deprecated = true

[types.current]
type = "integer"

[elements.value]
oneof = ["types.legacy", "types.current"]

[elements.optional]
type = "types.legacy"
optional = true
`)
	result := schema.Validate(map[string]any{"value": "old"})
	if !result.Valid() || len(result.Warnings) != 1 {
		t.Fatalf("expected warning-only validity: %#v", result)
	}
	warning := result.Warnings[0]
	if warning.Severity != SeverityWarning || warning.Code != "deprecated" ||
		warning.Path != "$.value" || warning.Message == "" {
		t.Fatalf("unexpected structured warning: %#v", warning)
	}
	if len(result.Diagnostics) != 1 {
		t.Fatalf("expected warning in diagnostics: %#v", result.Diagnostics)
	}
	if result := schema.Validate(map[string]any{"value": int64(1)}); !result.Valid() || len(result.Warnings) != 0 {
		t.Fatalf("failed union branches or absent fields must not warn: %#v", result)
	}
}

func TestRejectsMalformedVocabulary(t *testing.T) {
	tests := map[string]string{
		"dependent-empty": `type = "table"
dependentrequired = {}`,
		"dependent-values": `type = "table"
dependentrequired = { a = [] }
[elements.value.a]
type = "string"
optional = true`,
		"exclusive-small": `type = "table"
mutuallyexclusive = [["a"]]
[elements.value.a]
type = "string"
optional = true`,
		"exact-duplicate": `type = "table"
exactlyone = [["a", "a"]]
[elements.value.a]
type = "string"
optional = true`,
		"allof-empty": `type = "string"
allof = []`,
		"allof-kind": `type = "string"
allof = ["integer"]`,
		"unique-kind": `type = "string"
uniqueitems = true`,
		"deprecated-type": `type = "string"
deprecated = "yes"`,
	}
	for name, definition := range tests {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := write(t, dir, "invalid.tosd", `
[toml-schema]
version = "1.0.0"
[elements.value]
`+definition)
			if _, err := LoadSchema(path); err == nil {
				t.Fatal("expected malformed definition to fail")
			}
		})
	}
}

func loadSemanticsSchema(t *testing.T, definitions string) *Schema {
	t.Helper()
	dir := t.TempDir()
	path := write(t, dir, "schema.tosd", "[toml-schema]\nversion = \"1.0.0\"\n"+definitions)
	schema, err := LoadSchema(path)
	if err != nil {
		t.Fatal(err)
	}
	return schema
}
