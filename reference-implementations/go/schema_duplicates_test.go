package tomlschema

import (
	"fmt"
	"strings"
	"testing"
)

func TestRejectsDuplicateCompositionReferencesByResolvedIdentity(t *testing.T) {
	for _, property := range []string{"oneof", "anyof", "allof"} {
		t.Run(property, func(t *testing.T) {
			localType := ""
			if property == "allof" {
				localType = "type = \"string\"\n"
			}
			schemaPath := write(t, t.TempDir(), property+".tosd", fmt.Sprintf(`
[toml-schema]
version = "1.0.0"

[types.foo]
type = "string"

[elements.value]
%s%s = ["types.foo", "foo"]
`, localType, property))

			_, err := LoadSchema(schemaPath)
			if err == nil {
				t.Fatal("expected duplicate reference to fail schema loading")
			}
			expected := fmt.Sprintf(
				`elements.value %s contains duplicate type references "types.foo" and "foo"; both resolve to foo`,
				property)
			if err.Error() != expected {
				t.Fatalf("unexpected error:\nwant: %s\n got: %s", expected, err)
			}
		})
	}
}

func TestAllowsRepeatedTupleItemReferences(t *testing.T) {
	dir := t.TempDir()
	schemaPath := write(t, dir, "tuple.tosd", `
[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[elements.point]
type = "array"
items = ["types.coordinate", "types.coordinate"]
`)
	documentPath := write(t, dir, "tuple.toml", strings.TrimSpace(`
point = [1.0, 2.0]
`))

	schema, err := LoadSchema(schemaPath)
	if err != nil {
		t.Fatalf("repeated tuple items must load: %v", err)
	}
	if result, _ := schema.ValidateFile(documentPath); !result.Valid() {
		t.Fatalf("repeated tuple items must validate: %#v", result.Errors)
	}
}
