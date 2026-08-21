package tomlschema

import "testing"

func TestLoadsPureAllOfMixin(t *testing.T) {
	dir := t.TempDir()
	schema := loadSemanticsSchema(t, `
[types.named]
type = "table"
[types.named.name]
type = "string"
[types.packageBase]
type = "table"
[types.packageBase.version]
type = "string"
[types.package]
allof = ["types.packageBase", "types.named"]
dependentrequired = { name = ["version"] }
[types.positive]
type = "integer"
min = 1
[types.small]
type = "integer"
max = 10
[types.count]
allof = ["types.positive", "types.small"]
[elements.pkg]
type = "types.package"
[elements.count]
type = "types.count"
`)
	document := write(t, dir, "valid.toml", "pkg = { name = \"x\", version = \"1\" }\ncount = 5")
	invalid := write(t, dir, "invalid.toml", "pkg = { name = \"x\", version = \"1\" }\ncount = 0")
	if result := schema.ValidateFile(document); !result.Valid() {
		t.Fatalf("pure allof mixin should validate: %#v", result.Errors)
	}
	if result := schema.ValidateFile(invalid); result.Valid() {
		t.Fatal("pure scalar allof constraints were not applied")
	}
}

func TestRejectsMixedKindPureAllOf(t *testing.T) {
	dir := t.TempDir()
	path := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"
[types.aTable]
type = "table"
[types.aTable.x]
type = "string"
[types.anArray]
type = "array"
itemtype = "string"
[types.bad]
allof = ["types.aTable", "types.anArray"]
[elements.value]
type = "types.bad"
`)
	if _, err := LoadSchema(path); err == nil {
		t.Fatal("mixed-kind pure allof must fail at load")
	}
}

func TestValidatesInlineArrayPattern(t *testing.T) {
	dir := t.TempDir()
	schema := loadSemanticsSchema(t, `
[elements.tags]
type = "array"
itemtype = "string"
pattern = '^[a-z]+$'
`)
	valid := write(t, dir, "valid.toml", `tags = ["alpha", "beta"]`)
	invalid := write(t, dir, "invalid.toml", `tags = ["alpha", "Beta"]`)
	if result := schema.ValidateFile(valid); !result.Valid() {
		t.Fatalf("valid tags rejected: %#v", result.Errors)
	}
	if result := schema.ValidateFile(invalid); !hasPath(result, "$.tags[1]") {
		t.Fatalf("invalid tag was not rejected: %#v", result.Errors)
	}
}

func TestValidatesInlineCollectionMemberConstraints(t *testing.T) {
	dir := t.TempDir()
	schema := loadSemanticsSchema(t, `
[elements.ports]
type = "collection"
itemtype = "integer"
min = 1
max = 65535
[elements.roles]
type = "collection"
itemtype = "string"
allowedvalues = ["admin", "reader"]
[elements.tags]
type = "collection"
itemtype = "string"
pattern = '^[a-z]+@example\.com$'
[elements.emails]
type = "collection"
itemtype = "string"
format = "email"
`)
	valid := write(t, dir, "valid.toml", "[ports]\nhttp = 80\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")
	invalid := write(t, dir, "invalid.toml", "[ports]\nlow = 0\nhigh = 70000\n[roles]\nowner = \"root\"\n[tags]\nrelease = \"Stable\"\n[emails]\nowner = \"not-an-email\"\n")
	if result := schema.ValidateFile(valid); !result.Valid() {
		t.Fatalf("valid collection members rejected: %#v", result.Errors)
	}
	result := schema.ValidateFile(invalid)
	for _, path := range []string{"$.ports.low", "$.ports.high", "$.roles.owner", "$.tags.release", "$.emails.owner"} {
		if !hasPath(result, path) {
			t.Fatalf("invalid collection member at %s was not rejected: %#v", path, result.Errors)
		}
	}
}

func TestRejectsDuplicateInlineAndItemtypeConstraint(t *testing.T) {
	dir := t.TempDir()
	path := write(t, dir, "schema.tosd", `
[toml-schema]
version = "1.0.0"
[types.item]
type = "integer"
min = 0
[elements.values]
type = "array"
itemtype = "types.item"
min = -10
`)
	if _, err := LoadSchema(path); err == nil {
		t.Fatal("duplicate member constraint must fail at load")
	}
}

func TestAllowsInlineConstraintMatchingItemtypeAllOfConstraint(t *testing.T) {
	dir := t.TempDir()
	schema := loadSemanticsSchema(t, `
[types.mixin]
type = "string"
allowedvalues = ["a", "b"]
[types.item]
type = "string"
allof = ["types.mixin"]
[elements.values]
type = "array"
itemtype = "types.item"
allowedvalues = ["b", "c"]
`)
	valid := write(t, dir, "valid.toml", `values = ["b"]`)
	inlineInvalid := write(t, dir, "inline-invalid.toml", `values = ["a"]`)
	inheritedInvalid := write(t, dir, "inherited-invalid.toml", `values = ["c"]`)
	if result := schema.ValidateFile(valid); !result.Valid() {
		t.Fatalf("intersection value should validate: %#v", result.Errors)
	}
	if result := schema.ValidateFile(inlineInvalid); result.Valid() {
		t.Fatal("inline allowedvalues constraint was not applied")
	}
	if result := schema.ValidateFile(inheritedInvalid); result.Valid() {
		t.Fatal("allof-inherited allowedvalues constraint was not applied")
	}
}
