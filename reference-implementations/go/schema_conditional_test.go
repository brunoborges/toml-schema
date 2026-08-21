package tomlschema

import (
	"fmt"
	"strings"
	"testing"
)

func TestConditionalSelectorsChooseAndValidateBranch(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.sqlite]
type = "table"
[types.sqlite.engine]
type = "string"
allowedvalues = ["sqlite"]
optional = true
[types.sqlite.file]
type = "string"

[types.server]
type = "table"
[types.server.engine]
type = "string"
allowedvalues = ["postgresql", "mysql"]
optional = true
[types.server.host]
type = "string"

[elements.byEquals]
if = { key = "engine", equals = "sqlite" }
then = "types.sqlite"
else = "types.server"

[elements.byIn]
if = { key = "engine", in = ["postgresql", "mysql"] }
then = "types.server"
else = "types.sqlite"
`)

	for name, document := range map[string]map[string]any{
		"equals": {
			"byEquals": map[string]any{"engine": "sqlite", "file": "db.sqlite"},
			"byIn":     map[string]any{"engine": "sqlite", "file": "db.sqlite"},
		},
		"in": {
			"byEquals": map[string]any{"engine": "mysql", "host": "db.internal"},
			"byIn":     map[string]any{"engine": "postgresql", "host": "db.internal"},
		},
		"missing-chooses-else": {
			"byEquals": map[string]any{"host": "db.internal"},
			"byIn":     map[string]any{"file": "db.sqlite"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			if result := schema.Validate(document); !result.Valid() {
				t.Fatalf("expected selected branches to validate: %#v", result.Errors)
			}
		})
	}

	required := schema.Validate(map[string]any{
		"byEquals": map[string]any{"engine": "sqlite"},
		"byIn":     map[string]any{"engine": "mysql"},
	})
	if required.Valid() || !hasPath(required, "$.byEquals.file") || !hasPath(required, "$.byIn.host") {
		t.Fatalf("expected required-field diagnostics from selected branches: %#v", required.Errors)
	}

	unknown := schema.Validate(map[string]any{
		"byEquals": map[string]any{"engine": "sqlite", "file": "db.sqlite", "host": "wrong-branch"},
		"byIn":     map[string]any{"engine": "sqlite", "file": "db.sqlite", "host": "wrong-branch"},
	})
	if unknown.Valid() || !hasPath(unknown, "$.byEquals.host") || !hasPath(unknown, "$.byIn.host") {
		t.Fatalf("expected unknown-key diagnostics from selected branches: %#v", unknown.Errors)
	}
}

func TestConditionalSelectorUsesTomlEquality(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.one]
type = "table"
[types.one.mode]
type = "float"
[types.one.selected]
type = "boolean"

[types.other]
type = "table"
[types.other.mode]
type = "integer"
[types.other.fallback]
type = "boolean"

[elements.value]
if = { key = "mode", equals = 1 }
then = "types.one"
else = "types.other"
`)
	result := schema.Validate(map[string]any{"value": map[string]any{
		"mode": float64(1), "selected": true,
	}})
	if !result.Valid() {
		t.Fatalf("numeric TOML equality should select then despite different numeric representation: %#v", result.Errors)
	}
}

func TestConditionalKeyIsOneLiteralDirectChild(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.selected]
type = "table"
deprecated = true

[types.fallback]
type = "table"

[elements.value]
if = { key = "engine.kind", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"
`)
	nestedOnly := schema.Validate(map[string]any{"value": map[string]any{
		"engine": map[string]any{"kind": "sqlite"},
	}})
	if !nestedOnly.Valid() || len(nestedOnly.Warnings) != 0 {
		t.Fatalf("a dotted condition key must not traverse nested tables: %#v", nestedOnly)
	}
	literal := schema.Validate(map[string]any{"value": map[string]any{
		"engine.kind": "sqlite",
	}})
	if !literal.Valid() || len(literal.Warnings) != 1 {
		t.Fatalf("a dotted condition key must address the literal direct child: %#v", literal)
	}
}

func TestSchemaPropertyNamesRemainLegalImplicitTableChildren(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[elements.value.if]
type = "string"

[elements.value.then]
type = "integer"

[elements.value.else]
type = "boolean"
`)
	result := schema.Validate(map[string]any{"value": map[string]any{
		"if": "condition", "then": int64(1), "else": true,
	}})
	if !result.Valid() {
		t.Fatalf("schema-key-colliding child definitions must remain legal: %#v", result.Errors)
	}
}

func TestConditionalDeclaredDiscriminatorDoesNotOpenBranch(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.selected]
type = "table"
[types.selected.engine]
type = "string"
[types.selected.value]
type = "string"

[types.fallback]
type = "table"
[types.fallback.engine]
type = "string"
optional = true
[types.fallback.other]
type = "string"

[elements.item]
if = { key = "engine", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"
`)
	result := schema.Validate(map[string]any{"item": map[string]any{
		"engine": "sqlite", "value": "ok", "unexpected": true,
	}})
	if result.Valid() || !hasPath(result, "$.item.unexpected") {
		t.Fatalf("declaring the discriminator must not open the selected branch: %#v", result.Errors)
	}
}

func TestConditionalSelectorComposesWithAllOf(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.common]
type = "table"
[types.common.id]
type = "integer"

[types.sqlite]
type = "table"
[types.sqlite.engine]
type = "string"
[types.sqlite.file]
type = "string"

[types.server]
type = "table"
[types.server.engine]
type = "string"
[types.server.host]
type = "string"

[types.database]
if = { key = "engine", equals = "sqlite" }
then = "types.sqlite"
else = "types.server"
allof = ["types.common"]

[elements.database]
type = "types.database"

[elements.composed]
type = "table"
allof = ["types.database"]
`)
	valid := map[string]any{
		"database": map[string]any{"id": int64(1), "engine": "sqlite", "file": "db.sqlite"},
		"composed": map[string]any{"id": int64(2), "engine": "postgresql", "host": "db.internal"},
	}
	if result := schema.Validate(valid); !result.Valid() {
		t.Fatalf("selected conditional branch must contribute to effective closure: %#v", result.Errors)
	}
	invalid := schema.Validate(map[string]any{
		"database": map[string]any{"engine": "sqlite", "file": "db.sqlite"},
		"composed": map[string]any{"id": int64(2), "engine": "sqlite", "host": "wrong-branch"},
	})
	if invalid.Valid() || !hasPath(invalid, "$.database.id") ||
		!hasPath(invalid, "$.composed.file") || !hasPath(invalid, "$.composed.host") {
		t.Fatalf("expected composed selected-branch diagnostics: %#v", invalid.Errors)
	}
}

func TestRejectsMalformedConditionalSelectors(t *testing.T) {
	tableBranch := `
[types.left]
type = "table"
[types.left.engine]
type = "string"
[types.right]
type = "table"
[types.right.engine]
type = "string"
`
	cases := map[string]string{
		"missing-else": `if = { key = "engine", equals = "x" }
then = "types.left"`,
		"neither-predicate": `if = { key = "engine" }
then = "types.left"
else = "types.right"`,
		"both-predicates": `if = { key = "engine", equals = "x", in = ["x"] }
then = "types.left"
else = "types.right"`,
		"empty-in": `if = { key = "engine", in = [] }
then = "types.left"
else = "types.right"`,
		"non-string-key": `if = { key = 1, equals = "x" }
then = "types.left"
else = "types.right"`,
		"unknown-if-property": `if = { key = "engine", equals = "x", other = true }
then = "types.left"
else = "types.right"`,
		"builtin-branch": `if = { key = "engine", equals = "x" }
then = "table"
else = "types.right"`,
		"unknown-branch": `if = { key = "engine", equals = "x" }
then = "types.missing"
else = "types.right"`,
		"other-selector": `type = "table"
if = { key = "engine", equals = "x" }
then = "types.left"
else = "types.right"`,
		"ordinary-constraint": `if = { key = "engine", equals = "x" }
then = "types.left"
else = "types.right"
minlength = 1`,
		"nested-child": `if = { key = "engine", equals = "x" }
then = "types.left"
else = "types.right"
[elements.value.child]
type = "string"`,
	}
	for name, definition := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := write(t, dir, "invalid.tosd", fmt.Sprintf(`
[toml-schema]
version = "1.0.0"
%s
[elements.value]
%s
`, tableBranch, definition))
			if _, err := LoadSchema(path); err == nil {
				t.Fatal("expected malformed conditional selector to be rejected")
			}
		})
	}
}

func TestRejectsConditionalKindAndReferenceCycles(t *testing.T) {
	dir := t.TempDir()
	incompatible := write(t, dir, "incompatible.tosd", `
[toml-schema]
version = "1.0.0"
[types.tableBranch]
type = "table"
[types.tableBranch.engine]
type = "string"
[types.collectionBranch]
type = "collection"
itemtype = "string"
[types.collectionBranch.engine]
type = "string"
[elements.value]
if = { key = "engine", equals = "x" }
then = "types.tableBranch"
else = "types.collectionBranch"
`)
	if _, err := LoadSchema(incompatible); err == nil ||
		!strings.Contains(err.Error(), "incompatible") {
		t.Fatalf("expected incompatible conditional branches to be rejected, got %v", err)
	}

	cycle := write(t, dir, "cycle.tosd", `
[toml-schema]
version = "1.0.0"
[types.fallback]
type = "table"
[types.fallback.engine]
type = "string"
[types.first]
if = { key = "engine", equals = "x" }
then = "types.second"
else = "types.fallback"
[types.second]
type = "types.first"
[elements.value]
type = "types.fallback"
`)
	if _, err := LoadSchema(cycle); err == nil || !strings.Contains(err.Error(), "cyclic") {
		t.Fatalf("expected conditional selector cycle to be rejected, got %v", err)
	}
}
