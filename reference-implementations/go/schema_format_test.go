package tomlschema

import (
	"strings"
	"testing"
)

func TestStringFormatsValidateDocuments(t *testing.T) {
	tests := map[string]struct {
		valid   string
		invalid string
	}{
		"email":    {`"much.more unusual"@example.com`, "a..b@example.com"},
		"uuid":     {"01234567-89ab-CDEF-8123-456789abcdef", "0123456789ab-cdef-8123-456789abcdef"},
		"uri":      {"https://example.com/a%20b?q=x#part", "relative/path"},
		"hostname": {"service-1.example.com.", "-service.example.com"},
		"ipv4":     {"192.0.2.1", "192.168.001.1"},
		"ipv6":     {"2001:db8::192.0.2.1", "2001:db8::192.168.001.1"},
	}
	for format, test := range tests {
		t.Run(format, func(t *testing.T) {
			schema := loadSemanticsSchema(t, "\n[elements.value]\ntype = \"string\"\nformat = \""+format+"\"\n")
			if result := schema.Validate(map[string]any{"value": test.valid}); !result.Valid() {
				t.Fatalf("expected %q to be a valid %s: %#v", test.valid, format, result.Errors)
			}
			result := schema.Validate(map[string]any{"value": test.invalid})
			if result.Valid() || !strings.Contains(result.Errors[0].Message, "format "+format) {
				t.Fatalf("expected clear %s format error for %q: %#v", format, test.invalid, result.Errors)
			}
		})
	}
}

func TestEmailFormatRFC5321Cases(t *testing.T) {
	valid := []string{
		"simple@example.com",
		"customer/department=shipping@example.com",
		`"quoted local"@example.com`,
		`"escaped\\backslash\"quote"@example.com`,
		`"contains@sign"@example.com`,
		"user@[192.0.2.1]",
		"user@[IPv6:2001:db8::1]",
		"user@[example-tag:opaque:value]",
		strings.Repeat("a", 64) + "@example.com",
	}
	invalid := []string{
		"",
		"plainaddress",
		".leading@example.com",
		"trailing.@example.com",
		"two..dots@example.com",
		`unquoted space@example.com`,
		`"unterminated@example.com`,
		`"bad\` + "\n" + `"@example.com`,
		"ü@example.com",
		"user@-example.com",
		"user@example..com",
		"user@[IPv6:2001:db8:::1]",
		"user@example.com.",
		strings.Repeat("a", 65) + "@example.com",
		strings.Repeat("a", 64) + "@" + strings.Repeat("b", 63) + "." +
			strings.Repeat("c", 63) + "." + strings.Repeat("d", 62),
	}

	for _, value := range valid {
		if !validEmail(value) {
			t.Errorf("expected valid RFC 5321 mailbox: %q", value)
		}
	}

	for _, value := range invalid {
		if validEmail(value) {
			t.Errorf("expected invalid RFC 5321 mailbox: %q", value)
		}
	}
}

func TestURIFormatRFC3986EdgeCases(t *testing.T) {
	for _, value := range []string{"scheme:", "http://[v1.fe]/"} {
		if !validURI(value) {
			t.Errorf("expected valid absolute RFC 3986 URI: %q", value)
		}
	}
	for _, value := range []string{
		"http://example.com/#first#second",
		"http://[fe80::1%25eth0]/",
	} {
		if validURI(value) {
			t.Errorf("expected invalid RFC 3986 URI: %q", value)
		}
	}
}

func TestFormatSchemaLoadErrors(t *testing.T) {
	tests := map[string]string{
		"unknown":      "type = \"string\"\nformat = \"date\"",
		"incompatible": "type = \"integer\"\nformat = \"uuid\"",
		"non-string":   "type = \"string\"\nformat = 42",
	}
	for name, definition := range tests {
		t.Run(name, func(t *testing.T) {
			path := write(t, t.TempDir(), "schema.tosd",
				"[toml-schema]\nversion = \"1.0.0\"\n\n[elements.value]\n"+definition+"\n")
			if _, err := LoadSchema(path); err == nil {
				t.Fatal("expected format schema-load error")
			}
		})
	}
}

func TestFormatConstrainsAllowedValuesAtSchemaLoad(t *testing.T) {
	path := write(t, t.TempDir(), "schema.tosd", `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
format = "ipv4"
allowedvalues = ["192.168.001.1"]
`)
	if _, err := LoadSchema(path); err == nil || !strings.Contains(err.Error(), "does not satisfy format ipv4") {
		t.Fatalf("expected invalid formatted allowedvalue to fail schema loading, got %v", err)
	}
}
