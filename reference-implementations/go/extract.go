package main

import (
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	toml "github.com/pelletier/go-toml/v2"
)

var bareTomlKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func extract(documentPath, schemaPath string, out, errOut io.Writer) int {
	document, err := parseTOMLFile(documentPath)
	if err != nil {
		fmt.Fprintln(errOut, err)
		return 1
	}
	if err := os.WriteFile(schemaPath, []byte(generateSchema(document)), 0o644); err != nil {
		fmt.Fprintln(errOut, err)
		return 2
	}
	fmt.Fprintf(out, "Extracted schema to %s\n", schemaPath)
	return 0
}

func generateSchema(document map[string]any) string {
	var schema strings.Builder
	schema.WriteString("[toml-schema]\n")
	fmt.Fprintf(&schema, "version = %q\n\n", currentTomlSchemaVersion)
	schema.WriteString("[elements]\n")
	for _, key := range sortedKeys(document) {
		if key == "toml-schema" {
			continue
		}
		appendDefinition(&schema, []string{"elements", key}, document[key])
	}
	return schema.String()
}

func appendDefinition(schema *strings.Builder, path []string, value any) {
	schema.WriteString("\n[")
	for i, part := range path {
		if i > 0 {
			schema.WriteByte('.')
		}
		schema.WriteString(encodeTomlKey(part))
	}
	schema.WriteString("]\n")
	typeName := schemaType(value)
	fmt.Fprintf(schema, "type = %q\n", typeName)
	if typeName == string(TypeArray) {
		fmt.Fprintf(schema, "arraytype = %q\n", inferArrayType(value.([]any)))
	}
	if table, ok := value.(map[string]any); ok {
		for _, childKey := range sortedKeys(table) {
			childPath := append(append([]string{}, path...), childKey)
			appendDefinition(schema, childPath, table[childKey])
		}
	}
}

func schemaType(value any) string {
	switch value.(type) {
	case string:
		return string(TypeString)
	case int64:
		return string(TypeInteger)
	case float64:
		return string(TypeFloat)
	case bool:
		return string(TypeBoolean)
	case time.Time:
		return string(TypeOffsetDateTime)
	case toml.LocalDateTime:
		return string(TypeLocalDateTime)
	case toml.LocalDate:
		return string(TypeLocalDate)
	case toml.LocalTime:
		return string(TypeLocalTime)
	case []any:
		return string(TypeArray)
	case map[string]any:
		return string(TypeTable)
	default:
		return string(TypeAny)
	}
}

func inferArrayType(array []any) string {
	if len(array) == 0 {
		return string(TypeAny)
	}
	firstType := schemaType(array[0])
	for _, item := range array[1:] {
		if schemaType(item) != firstType {
			return string(TypeAny)
		}
	}
	return firstType
}

func encodeTomlKey(key string) string {
	if bareTomlKeyPattern.MatchString(key) {
		return key
	}
	var encoded strings.Builder
	encoded.WriteByte('"')
	for _, current := range key {
		switch current {
		case '\\':
			encoded.WriteString(`\\`)
		case '"':
			encoded.WriteString(`\"`)
		case '\b':
			encoded.WriteString(`\b`)
		case '\t':
			encoded.WriteString(`\t`)
		case '\n':
			encoded.WriteString(`\n`)
		case '\f':
			encoded.WriteString(`\f`)
		case '\r':
			encoded.WriteString(`\r`)
		default:
			if current < 0x20 {
				fmt.Fprintf(&encoded, `\u%04X`, current)
			} else {
				encoded.WriteRune(current)
			}
		}
	}
	encoded.WriteByte('"')
	return encoded.String()
}

func sortedKeys(table map[string]any) []string {
	keys := make([]string, 0, len(table))
	for key := range table {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
