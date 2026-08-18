package tomlschema

import (
	"sort"
	"strings"
	"testing"
)

func TestEffectiveAnnotationsTerminateOnRecursiveNamedTypes(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.node]
type = "table"
description = "A tree node."

[types.node.name]
type = "string"
default = "root"

[types.node.child]
type = "types.node"
optional = true

[elements.tree]
type = "types.node"
`)

	element, ok := schema.Element("tree")
	if !ok {
		t.Fatal("expected the tree element")
	}
	if element.Description() != "A tree node." {
		t.Fatalf("unexpected inherited description: %q", element.Description())
	}
	named, ok := schema.Type("types.node")
	if !ok {
		t.Fatal("expected the node type")
	}
	if named.Description() != "A tree node." {
		t.Fatalf("unexpected named description: %q", named.Description())
	}

	current := element
	for depth := range 3 {
		name, ok := current.Child("name")
		if !ok {
			t.Fatalf("expected a name child at depth %d", depth)
		}
		if value, hasDefault := name.Default(); !hasDefault || value != "root" {
			t.Fatalf("unexpected default at depth %d: %#v %v", depth, value, hasDefault)
		}
		child, ok := current.Child("child")
		if !ok {
			t.Fatalf("expected a recursive child at depth %d", depth)
		}
		current = child
	}

	document := map[string]any{"tree": map[string]any{
		"name": "a",
		"child": map[string]any{
			"name":  "b",
			"child": map[string]any{"name": "c"},
		},
	}}
	if result := schema.Validate(document); !result.Valid() {
		t.Fatalf("expected recursive document to validate: %#v", result.Errors)
	}
}

func TestEffectiveAnnotationsTerminateOnMutuallyRecursiveTypes(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.left]
type = "table"
description = "Left."

[types.left.right]
type = "types.right"
optional = true

[types.right]
type = "table"
description = "Right."

[types.right.left]
type = "types.left"
optional = true

[elements.root]
type = "types.left"
`)

	root, ok := schema.Element("root")
	if !ok {
		t.Fatal("expected the root element")
	}
	right, ok := root.Child("right")
	if !ok {
		t.Fatal("expected the right child")
	}
	if right.Description() != "Right." {
		t.Fatalf("unexpected inherited description: %q", right.Description())
	}
	if _, ok := right.Child("left"); !ok {
		t.Fatal("expected the mutually recursive left child")
	}
}

func TestAllOfAcceptsUnionComponentsWithUnambiguousKind(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.base]
type = "table"
[types.base.id]
type = "integer"

[types.named]
type = "table"
[types.named.name]
type = "string"

[types.labelled]
type = "table"
[types.labelled.label]
type = "string"

[types.identity]
oneof = ["types.named", "types.labelled"]

[elements.item]
type = "table"
allof = ["types.base", "types.identity"]

[elements.item.enabled]
type = "boolean"
optional = true
`)

	valid := []map[string]any{
		{"id": int64(1), "name": "a"},
		{"id": int64(1), "label": "a"},
		{"id": int64(1), "name": "a", "enabled": true},
	}

	for _, item := range valid {
		if result := schema.Validate(map[string]any{"item": item}); !result.Valid() {
			t.Fatalf("expected %#v to validate: %#v", item, result.Errors)
		}
	}

	// Each alternative stays closed against the keys exclusive to its sibling
	// alternatives, so a value carrying both cannot select either branch.
	both := schema.Validate(map[string]any{"item": map[string]any{
		"id": int64(1), "name": "a", "label": "b",
	}})
	if len(both.Errors) != 1 || both.Errors[0].Path != "$.item" ||
		!strings.Contains(both.Errors[0].Message, "but found 0") {
		t.Fatalf("expected a single aggregated oneof diagnostic: %#v", both.Errors)
	}

	none := schema.Validate(map[string]any{"item": map[string]any{"id": int64(1)}})
	if len(none.Errors) != 1 {
		t.Fatalf("failed union branches must not leak diagnostics: %#v", none.Errors)
	}
	if none.Errors[0].Path != "$.item" || !strings.Contains(none.Errors[0].Message, "but found 0") {
		t.Fatalf("unexpected aggregated union diagnostic: %#v", none.Errors[0])
	}

	unknown := schema.Validate(map[string]any{"item": map[string]any{
		"id": int64(1), "name": "a", "bogus": true,
	}})
	if unknown.Valid() {
		t.Fatal("expected a closed composed union table")
	}
	for _, diagnostic := range unknown.Errors {
		if diagnostic.Path != "$.item.bogus" && diagnostic.Path != "$.item" {
			t.Fatalf("failed union branches must not leak diagnostics: %#v", unknown.Errors)
		}
	}
	if !containsDiagnostic(unknown.Errors, "$.item.bogus", "unexpected key") {
		t.Fatalf("expected an unexpected-key diagnostic: %#v", unknown.Errors)
	}

	missing := schema.Validate(map[string]any{"item": map[string]any{"name": "a"}})
	if len(missing.Errors) != 1 || missing.Errors[0].Path != "$.item.id" {
		t.Fatalf("expected only the missing component child: %#v", missing.Errors)
	}
}

func TestAllOfUnionClosurePreservesOverlappingStructuralChildren(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.base]
type = "table"
[types.base.name]
type = "string"

[types.withName]
type = "table"
[types.withName.name]
type = "string"
[types.withName.git]
type = "string"
optional = true

[types.plain]
type = "table"
[types.plain.path]
type = "string"

[types.identity]
oneof = ["types.withName", "types.plain"]

[elements.item]
type = "table"
allof = ["types.base", "types.identity"]
`)

	valid := schema.Validate(map[string]any{"item": map[string]any{
		"name": "a",
		"path": "p",
	}})
	if !valid.Valid() {
		t.Fatalf("expected overlapping structural child to remain in branch closure: %#v", valid.Errors)
	}

	both := schema.Validate(map[string]any{"item": map[string]any{
		"name": "a",
		"path": "p",
		"git":  "https://example.invalid/repo",
	}})
	if both.Valid() || len(both.Errors) != 1 ||
		!strings.Contains(both.Errors[0].Message, "but found 0") {
		t.Fatalf("expected sibling-exclusive keys to keep both branches closed: %#v", both.Errors)
	}
}

func TestAllOfClosesOpenUnionAlternativesWhenCompositionDefinesChildren(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.base]
type = "table"
[types.base.name]
type = "string"

[types.open]
type = "table"

[types.closed]
type = "table"
[types.closed.known]
type = "string"

[types.identity]
oneof = ["types.open", "types.closed"]

[elements.element]
type = "table"
allof = ["types.base", "types.identity"]
`)

	valid := schema.Validate(map[string]any{"element": map[string]any{
		"name":  "alpha",
		"known": "value",
	}})
	if !valid.Valid() {
		t.Fatalf("expected the closed alternative to be the sole match: %#v", valid.Errors)
	}

	invalid := schema.Validate(map[string]any{"element": map[string]any{
		"name":      "alpha",
		"arbitrary": true,
	}})
	hasUnionFailure := false
	for _, diagnostic := range invalid.Errors {
		if diagnostic.Path == "$.element" && strings.Contains(diagnostic.Message, "found 0") {
			hasUnionFailure = true
		}
	}
	if invalid.Valid() || !hasUnionFailure {
		t.Fatalf("expected composition to close the childless alternative: %#v", invalid.Errors)
	}
}

func TestAllOfAcceptsAnyOfComponentsForScalarsAndCollections(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.low]
type = "integer"
max = 10

[types.high]
type = "integer"
min = 100

[types.bounded]
anyof = ["types.low", "types.high"]

[elements.count]
type = "integer"
min = 0
allof = ["types.bounded"]

[types.shortEntry]
type = "string"
maxlength = 4

[types.longEntry]
type = "string"
minlength = 8

[types.shortCollection]
type = "collection"
itemtype = "types.shortEntry"

[types.longCollection]
type = "collection"
itemtype = "types.longEntry"

[types.entries]
anyof = ["types.shortCollection", "types.longCollection"]

[elements.registry]
type = "collection"
itemtype = "string"
allof = ["types.entries"]
`)

	if result := schema.Validate(map[string]any{
		"count": int64(5), "registry": map[string]any{"a": "abcd"},
	}); !result.Valid() {
		t.Fatalf("expected composed anyof to validate: %#v", result.Errors)
	}
	if result := schema.Validate(map[string]any{
		"count": int64(500), "registry": map[string]any{"a": "abcdefgh"},
	}); !result.Valid() {
		t.Fatalf("expected the second anyof alternative to validate: %#v", result.Errors)
	}

	result := schema.Validate(map[string]any{
		"count": int64(50), "registry": map[string]any{"a": "abcdef"},
	})
	paths := diagnosticPaths(result.Errors)
	if len(paths) != 2 || paths[0] != "$.count" || paths[1] != "$.registry" {
		t.Fatalf("expected one aggregated diagnostic per composed anyof: %#v", result.Errors)
	}
	for _, diagnostic := range result.Errors {
		if !strings.Contains(diagnostic.Message, "at least one matching type from anyof") {
			t.Fatalf("failed anyof branches must not leak diagnostics: %#v", diagnostic)
		}
	}
}

func TestDependentRequiredTriggersOnDirectPresenceOnly(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.settings]
type = "table"
dependentrequired = { a = ["b"], b = ["c"] }

[types.settings.a]
type = "string"
optional = true
[types.settings.b]
type = "string"
optional = true
[types.settings.c]
type = "string"
optional = true

[elements.settings]
type = "types.settings"
`)

	result := schema.Validate(map[string]any{"settings": map[string]any{"a": "x"}})
	if len(result.Errors) != 1 {
		t.Fatalf("absent dependencies must not trigger their own mappings: %#v", result.Errors)
	}
	diagnostic := result.Errors[0]
	if diagnostic.Path != "$.settings.b" ||
		diagnostic.Message != `required by dependentrequired triggered by sibling "a"` {
		t.Fatalf("unexpected dependentrequired diagnostic: %#v", diagnostic)
	}

	present := schema.Validate(map[string]any{"settings": map[string]any{"a": "x", "b": "y"}})
	if len(present.Errors) != 1 || present.Errors[0].Path != "$.settings.c" {
		t.Fatalf("expected only the directly triggered dependency: %#v", present.Errors)
	}

	if result := schema.Validate(map[string]any{"settings": map[string]any{
		"a": "x", "b": "y", "c": "z",
	}}); !result.Valid() {
		t.Fatalf("expected satisfied dependencies to validate: %#v", result.Errors)
	}
	if result := schema.Validate(map[string]any{"settings": map[string]any{"c": "z"}}); !result.Valid() {
		t.Fatalf("dependencies are directional: %#v", result.Errors)
	}
}

func TestDefaultDisambiguationFollowsTomlSyntax(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[elements]
inline = { type = "table", optional = true, default = { keep = true } }

[elements.range]
type = "table"
optional = true
default = { min = 1, max = 10 }

[elements.range.min]
type = "integer"
[elements.range.max]
type = "integer"

[elements.plugin]
type = "table"
optional = true
default = { type = "linter", oneof = "unused", anyof = "unused" }

[elements.options]
type = "table"

[elements.options.default]

[elements.options.default.min]
type = "integer"

[elements.entry]
type = "table"

[elements.entry.dependentrequired]
type = "string"
optional = true
`)

	inline, ok := schema.Element("inline")
	if !ok {
		t.Fatal("expected the inline element definition")
	}
	inlineDefault, ok := inline.Default()
	if !ok || !valuesEqual(inlineDefault, map[string]any{"keep": true}) {
		t.Fatalf("expected a nested inline default annotation: %#v %v", inlineDefault, ok)
	}
	if _, ok := inline.Child("default"); ok {
		t.Fatal("a nested inline default must not become a child definition")
	}

	rangeElement, _ := schema.Element("range")
	value, ok := rangeElement.Default()
	if !ok {
		t.Fatal("expected an inline table default annotation")
	}
	if !valuesEqual(value, map[string]any{"min": int64(1), "max": int64(10)}) {
		t.Fatalf("unexpected default annotation: %#v", value)
	}
	if _, ok := rangeElement.Child("default"); ok {
		t.Fatal("an inline default must not become a child definition")
	}
	if _, ok := rangeElement.Child("min"); !ok {
		t.Fatal("expected the min child definition")
	}

	plugin, _ := schema.Element("plugin")
	pluginDefault, ok := plugin.Default()
	if !ok {
		t.Fatal("an inline default is the annotation even when its members are schema keywords")
	}
	if !valuesEqual(pluginDefault, map[string]any{
		"type": "linter", "oneof": "unused", "anyof": "unused",
	}) {
		t.Fatalf("unexpected keyword-shaped default: %#v", pluginDefault)
	}

	options, _ := schema.Element("options")
	if _, ok := options.Default(); ok {
		t.Fatal("a [..default] table header must not become an annotation")
	}
	child, ok := options.Child("default")
	if !ok {
		t.Fatal("expected a child definition named default")
	}
	if _, ok := child.Child("min"); !ok {
		t.Fatal("expected the nested min child of the default child definition")
	}

	entry, _ := schema.Element("entry")
	if _, ok := entry.Child("dependentrequired"); !ok {
		t.Fatal("expected a child definition named dependentrequired")
	}

	if result := schema.Validate(map[string]any{
		"options": map[string]any{"default": map[string]any{"min": int64(1)}},
		"entry":   map[string]any{"dependentrequired": "x"},
	}); !result.Valid() {
		t.Fatalf("expected child definitions to be validated: %#v", result.Errors)
	}
	missing := schema.Validate(map[string]any{
		"options": map[string]any{},
		"entry":   map[string]any{},
	})
	if len(missing.Errors) != 1 || missing.Errors[0].Path != "$.options.default" {
		t.Fatalf("expected the default child to be required: %#v", missing.Errors)
	}
}

func TestCollectionItemtypeMayComeFromAllOfComponent(t *testing.T) {
	schema := loadSemanticsSchema(t, `
[types.entry]
type = "string"
minlength = 2

[types.baseRegistry]
type = "collection"
itemtype = "types.entry"

[elements.registry]
type = "collection"
keypattern = "^[a-z]+$"
allof = ["types.baseRegistry"]

[elements.registry.fixed]
type = "boolean"
optional = true
`)

	if result := schema.Validate(map[string]any{"registry": map[string]any{
		"alpha": "ok", "fixed": true,
	}}); !result.Valid() {
		t.Fatalf("expected a composed collection item constraint: %#v", result.Errors)
	}
	short := schema.Validate(map[string]any{"registry": map[string]any{"alpha": "x"}})
	if len(short.Errors) != 1 || short.Errors[0].Path != "$.registry.alpha" {
		t.Fatalf("expected the composed itemtype to apply: %#v", short.Errors)
	}
	badKey := schema.Validate(map[string]any{"registry": map[string]any{"ALPHA": "ok"}})
	if len(badKey.Errors) != 1 || !strings.Contains(badKey.Errors[0].Message, "keypattern") {
		t.Fatalf("expected the local keypattern to apply: %#v", badKey.Errors)
	}
}

func TestRejectsCollectionWithoutAnyItemConstraint(t *testing.T) {
	tests := map[string]struct {
		definitions string
		message     string
	}{
		"no-itemtype": {
			definitions: `
[elements.registry]
type = "collection"
`,
			message: "must define itemtype when type is collection",
		},
		"incompatible-component": {
			definitions: `
[types.plain]
type = "table"

[types.plain.name]
type = "string"

[elements.registry]
type = "collection"
allof = ["types.plain"]
`,
			message: "incompatible effective kind",
		},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := write(t, dir, "collection.tosd",
				"[toml-schema]\nversion = \"1.0.0\"\n"+test.definitions)
			_, err := LoadSchema(path)
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("expected %q, got %v", test.message, err)
			}
		})
	}
}

func containsDiagnostic(diagnostics []ValidationError, path, message string) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Path == path && diagnostic.Message == message {
			return true
		}
	}
	return false
}

func diagnosticPaths(diagnostics []ValidationError) []string {
	paths := make([]string, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		paths = append(paths, diagnostic.Path)
	}
	sort.Strings(paths)
	return paths
}
