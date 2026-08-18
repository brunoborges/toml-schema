package tomlschema

import (
	"strings"

	"github.com/pelletier/go-toml/v2/unstable"
)

// schemaSource recovers the TOML syntax that was used to write each key of a
// schema document.
//
// TOML Schema disambiguates an annotation property from a child definition by
// syntax rather than by member names: `default = { ... }` is always the
// annotation, while a `[elements.options.default]` table header is always a
// child definition named `default`. A parsed TOML value erases that
// distinction, so the schema source is walked with the TOML AST to record which
// table-valued keys were written as inline tables.
type schemaSource struct {
	inlineTables map[string]bool
}

func newSchemaSource(content []byte) *schemaSource {
	source := &schemaSource{inlineTables: map[string]bool{}}
	parser := &unstable.Parser{}
	parser.Reset(content)
	var prefix []string
	for parser.NextExpression() {
		node := parser.Expression()
		switch node.Kind {
		case unstable.Table, unstable.ArrayTable:
			prefix = source.keyPath(node, nil)
		case unstable.KeyValue:
			source.recordKeyValue(prefix, node)
		}
	}
	if parser.Error() != nil {
		return &schemaSource{inlineTables: map[string]bool{}}
	}
	return source
}

func (s *schemaSource) recordKeyValue(prefix []string, node *unstable.Node) {
	value := node.Value()
	if value == nil || value.Kind != unstable.InlineTable {
		return
	}
	path := s.keyPath(node, prefix)
	s.inlineTables[sourcePathKey(path)] = true
	children := value.Children()
	for children.Next() {
		child := children.Node()
		if child.Kind == unstable.KeyValue {
			s.recordKeyValue(path, child)
		}
	}
}

func (s *schemaSource) keyPath(node *unstable.Node, prefix []string) []string {
	path := append([]string(nil), prefix...)
	keys := node.Key()
	for keys.Next() {
		path = append(path, string(keys.Node().Data))
	}
	return path
}

// isProperty reports whether key at path carries an annotation value rather
// than a nested child definition. A non-table value is always a property; a
// table value is a property only when it was written as an inline table.
func (s *schemaSource) isProperty(table map[string]any, path []string, key string) bool {
	value, present := table[key]
	if !present {
		return false
	}
	if _, isTable := asMap(value); !isTable {
		return true
	}
	if s == nil {
		return false
	}
	return s.inlineTables[sourcePathKey(appendSourcePath(path, key))]
}

func appendSourcePath(path []string, key string) []string {
	extended := make([]string, 0, len(path)+1)
	extended = append(extended, path...)
	return append(extended, key)
}

func sourcePathKey(path []string) string {
	return strings.Join(path, "\x00")
}
