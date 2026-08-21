package tomlschema

import (
	"errors"
	"testing"
)

func TestNormalizesPrefixedBuiltinsBeforeSelectorClassification(t *testing.T) {
	dir := t.TempDir()
	valid := write(t, dir, "valid.tosd", `
[toml-schema]
version = "1.0.0"
[elements.port]
type = "types.integer"
min = 1
max = 65535
`)
	if _, err := LoadSchema(valid); err != nil {
		t.Fatalf("prefixed built-in must allow kind-specific siblings: %v", err)
	}

	invalid := write(t, dir, "types-any.tosd", `
[toml-schema]
version = "1.0.0"
[elements.value]
oneof = ["types.any"]
`)
	if _, err := LoadSchema(invalid); err == nil {
		t.Fatal("types.any must remain forbidden in oneof")
	}
}

func TestRejectsInvalidAndNonPortablePatternsAtSchemaLoad(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name, definition, expected string
	}{
		{"invalid", `type = "string"` + "\n" + `pattern = "["`, "invalid-pattern"},
		{"shorthand", `type = "string"` + "\n" + `pattern = "\\d+"`, "unsupported-pattern"},
		{"lookaround-key", `type = "collection"` + "\n" + `itemtype = "string"` + "\n" + `keypattern = "(?=x)"`, "unsupported-pattern"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			path := write(t, dir, test.name+".tosd",
				"[toml-schema]\nversion = \"1.0.0\"\n[elements.value]\n"+test.definition+"\n")
			_, err := LoadSchema(path)
			var schemaErr *SchemaError
			if err == nil || !errors.As(err, &schemaErr) || schemaErr.Code != test.expected {
				t.Fatalf("expected %s schema-load error, got %v", test.expected, err)
			}
		})
	}
}

func TestLoadsPortableCharacterEscapesAndEscapedMetacharacters(t *testing.T) {
	dir := t.TempDir()
	path := write(t, dir, "portable-escapes.tosd", `
[toml-schema]
version = "1.0.0"
[elements.whitespace]
type = "string"
pattern = '[ \t]'
[elements.controls]
type = "string"
pattern = '\t\n\r\f\v\a'
[elements.dot]
type = "string"
pattern = '\.'
`)
	if _, err := LoadSchema(path); err != nil {
		t.Fatalf("portable character and metacharacter escapes must load: %v", err)
	}
}

func TestRejectsClosedConditionalBranchesOmittingDiscriminator(t *testing.T) {
	dir := t.TempDir()
	for _, missing := range []string{"then", "else"} {
		t.Run(missing, func(t *testing.T) {
			thenChild, elseChild := "engine", "engine"
			if missing == "then" {
				thenChild = "value"
			} else {
				elseChild = "value"
			}
			path := write(t, dir, missing+".tosd", `[toml-schema]
version = "1.0.0"
[types.selected]
type = "table"
[types.selected.`+thenChild+`]
type = "string"
[types.fallback]
type = "table"
[types.fallback.`+elseChild+`]
type = "string"
[elements.item]
if = { key = "engine", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"
`)
			if _, err := LoadSchema(path); err == nil {
				t.Fatal("closed branch must declare the discriminator")
			}
		})
	}
}

func TestRejectsNonTableConditionalDefaultAtSchemaLoad(t *testing.T) {
	dir := t.TempDir()
	path := write(t, dir, "default.tosd", `
[toml-schema]
version = "1.0.0"
[types.selected]
type = "table"
[types.fallback]
type = "table"
[elements.item]
if = { key = "engine", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"
default = "sqlite"
`)
	if _, err := LoadSchema(path); err == nil {
		t.Fatal("conditional default must be a table")
	}
}
