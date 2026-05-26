package tomlschema

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

var tokenCommentPattern = regexp.MustCompile(`;\s*"([^"]+)"`)

func TestSchemaLoaderDefinitionKeysMatchAbnfSchemaKeys(t *testing.T) {
	abnf := readAbnf(t)
	expected := alternativesFor("schema-key", abnf)
	actual := mapKeys(definitionKeys)

	assertSameStrings(t, actual, expected)
}

func TestSchemaTypesMatchAbnfBuiltInTypes(t *testing.T) {
	abnf := readAbnf(t)
	implementationTypes := []string{
		string(TypeAny),
		string(TypeString),
		string(TypeInteger),
		string(TypeFloat),
		string(TypeBoolean),
		string(TypeOffsetDateTime),
		string(TypeLocalDateTime),
		string(TypeLocalDate),
		string(TypeLocalTime),
		string(TypeArray),
		string(TypeTable),
		string(TypeCollection),
	}

	assertSameStrings(t, implementationTypes, builtInTypeTokens(abnf))
}

func readAbnf(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(abnfPath())
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

func abnfPath() string {
	if _, err := os.Stat("toml-schema.abnf"); err == nil {
		return "toml-schema.abnf"
	}
	return filepath.Join("..", "..", "toml-schema.abnf")
}

func alternativesFor(ruleName, abnf string) []string {
	expression := ruleExpression(ruleName, abnf)
	tokens := []string{}
	for _, token := range strings.Split(expression, "/") {
		token = strings.TrimSpace(token)
		if token == "" || token == "version" {
			continue
		}
		tokens = append(tokens, token)
	}
	return tokens
}

func ruleExpression(ruleName, abnf string) string {
	var expression strings.Builder
	inRule := false
	for _, line := range strings.Split(abnf, "\n") {
		if strings.HasPrefix(line, ruleName+" =") {
			_, value, _ := strings.Cut(line, "=")
			expression.WriteString(strings.TrimSpace(value))
			inRule = true
			continue
		}
		if inRule {
			if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
				expression.WriteString(" ")
				expression.WriteString(strings.TrimSpace(line))
				continue
			}
			break
		}
	}
	return expression.String()
}

func builtInTypeTokens(abnf string) []string {
	tokens := []string{}
	for _, line := range strings.Split(abnf, "\n") {
		matches := tokenCommentPattern.FindStringSubmatch(line)
		if len(matches) != 2 {
			continue
		}
		token := matches[1]
		if definitionKeys[token] {
			continue
		}
		tokens = append(tokens, token)
	}
	return tokens
}

func mapKeys(values map[string]bool) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}

func assertSameStrings(t *testing.T, actual, expected []string) {
	t.Helper()
	slices.Sort(actual)
	slices.Sort(expected)
	if !slices.Equal(actual, expected) {
		t.Fatalf("got %v, want %v", actual, expected)
	}
}
