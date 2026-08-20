package tomlschema

import (
	"fmt"
	"math"
	"math/big"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	toml "github.com/pelletier/go-toml/v2"
)

type SchemaType string

const (
	TypeAny            SchemaType = "any"
	TypeString         SchemaType = "string"
	TypeInteger        SchemaType = "integer"
	TypeFloat          SchemaType = "float"
	TypeBoolean        SchemaType = "boolean"
	TypeOffsetDateTime SchemaType = "offset-date-time"
	TypeLocalDateTime  SchemaType = "local-date-time"
	TypeLocalDate      SchemaType = "local-date"
	TypeLocalTime      SchemaType = "local-time"
	TypeArray          SchemaType = "array"
	TypeTable          SchemaType = "table"
	TypeCollection     SchemaType = "collection"
)

var definitionKeys = map[string]bool{
	"type": true, "description": true, "itemtype": true, "items": true,
	"allowedvalues": true, "pattern": true, "format": true, "keypattern": true, "optional": true, "min": true,
	"max": true, "minlength": true, "maxlength": true,
	"oneof": true, "anyof": true, "dependentrequired": true, "mutuallyexclusive": true,
	"exactlyone": true, "allof": true, "uniqueitems": true, "default": true, "deprecated": true,
	"if": true, "then": true, "else": true,
}

var namedReferenceKeys = map[string]bool{
	"type": true, "description": true, "optional": true, "allof": true, "default": true,
	"deprecated": true,
}
var unionKeys = map[string]bool{
	"oneof": true, "anyof": true, "description": true, "optional": true, "allof": true,
	"default": true, "deprecated": true,
}
var conditionalKeys = map[string]bool{
	"if": true, "then": true, "else": true, "description": true, "optional": true,
	"allof": true, "default": true, "deprecated": true,
}

// currentTomlSchemaVersion is the TOML Schema language version this implementation
// targets. TOML Schema 1.0.0 has not been released yet; this is the version new
// schema-language features are developed against ahead of that release.
const currentTomlSchemaVersion = "1.0.0"

var semverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)

func parseSchemaType(value string) (SchemaType, bool) {
	switch value {
	case "any":
		return TypeAny, true
	case "string":
		return TypeString, true
	case "integer":
		return TypeInteger, true
	case "float":
		return TypeFloat, true
	case "boolean":
		return TypeBoolean, true
	case "offset-date-time":
		return TypeOffsetDateTime, true
	case "local-date-time":
		return TypeLocalDateTime, true
	case "local-date":
		return TypeLocalDate, true
	case "local-time":
		return TypeLocalTime, true
	case "array":
		return TypeArray, true
	case "table":
		return TypeTable, true
	case "collection":
		return TypeCollection, true
	default:
		return "", false
	}
}

type Schema struct {
	source   string
	version  string
	warnings []string
	types    map[string]Definition
	elements map[string]Definition
}

type Definition struct {
	name              string
	typeName          SchemaType
	reference         string
	description       string
	itemReference     string
	items             []string
	optional          bool
	allowedValues     []any
	pattern           *regexp.Regexp
	format            string
	keyPattern        *regexp.Regexp
	min               any
	max               any
	minLength         *int
	maxLength         *int
	oneOf             []string
	anyOf             []string
	condition         *condition
	thenReference     string
	elseReference     string
	allOf             []string
	dependentRequired map[string][]string
	mutuallyExclusive [][]string
	exactlyOne        [][]string
	uniqueItems       *bool
	defaultValue      any
	hasDefault        bool
	deprecated        bool
	hasDeprecated     bool
	children          map[string]Definition
}

type condition struct {
	key       string
	equals    any
	in        []any
	hasEquals bool
}

type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
)

type ValidationError struct {
	Severity Severity
	Code     string
	Path     string
	Message  string
}

type Diagnostic = ValidationError

type ValidationResult struct {
	Errors      []ValidationError
	Warnings    []Diagnostic
	Diagnostics []Diagnostic
}

func (r ValidationResult) Valid() bool {
	return len(r.Errors) == 0
}

func LoadSchema(path string) (*Schema, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("unable to parse schema %s: %w", path, err)
	}
	var parsed map[string]any
	if err := toml.Unmarshal(content, &parsed); err != nil {
		return nil, fmt.Errorf("unable to parse schema %s: %w", path, err)
	}
	source := newSchemaSource(content)
	if _, ok := asMap(parsed["toml-schema"]); !ok {
		return nil, fmt.Errorf("schema must contain a [toml-schema] table")
	}
	if _, ok := asMap(parsed["elements"]); !ok {
		return nil, fmt.Errorf("schema must contain an [elements] table")
	}
	for key := range parsed {
		if key != "toml-schema" && key != "types" && key != "elements" {
			return nil, fmt.Errorf("unsupported top-level schema key: %s", key)
		}
	}
	metadata := parsed["toml-schema"].(map[string]any)
	version, ok := metadata["version"]
	if !ok {
		return nil, fmt.Errorf("[toml-schema] must contain version")
	}
	if err := validateSchemaVersion(version); err != nil {
		return nil, err
	}
	for key := range metadata {
		if key != "version" && key != "meta" {
			return nil, fmt.Errorf("unsupported [toml-schema] key: %s", key)
		}
	}
	types, err := parseDefinitions("types", mapValue(parsed["types"]), false, source)
	if err != nil {
		return nil, err
	}
	elements, err := parseDefinitions("elements", mapValue(parsed["elements"]), true, source)
	if err != nil {
		return nil, err
	}
	schema := &Schema{source: path, version: version.(string), types: types, elements: elements}
	if err := schema.validateReferences(types); err != nil {
		return nil, err
	}
	if err := schema.validateReferences(elements); err != nil {
		return nil, err
	}
	if err := schema.validateSelectorCycles(); err != nil {
		return nil, err
	}
	if err := schema.validateAllowedValueTypes(); err != nil {
		return nil, err
	}
	if err := schema.validateSemantics(); err != nil {
		return nil, err
	}
	if err := schema.validateArrayRanges(); err != nil {
		return nil, err
	}
	if err := schema.validateDefaults(); err != nil {
		return nil, err
	}
	return schema, nil
}

// Warnings returns non-fatal warnings produced while discovering this schema.
func (s *Schema) Warnings() []string {
	return append([]string(nil), s.warnings...)
}

func LoadDocument(path string) (map[string]any, error) {
	return parseTOMLFile(path)
}

func validateSchemaVersion(value any) error {
	version, ok := value.(string)
	if !ok {
		return fmt.Errorf("[toml-schema].version must be a SemVer string")
	}
	matches := semverPattern.FindStringSubmatch(version)
	if matches == nil {
		return fmt.Errorf("[toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax")
	}
	if matches[1] != "1" {
		return fmt.Errorf("unsupported TOML Schema major version: %s", version)
	}
	if matches[2] != "0" {
		return fmt.Errorf("unsupported TOML Schema minor version: %s", version)
	}
	return nil
}

func (s *Schema) validateSemantics() error {
	for _, definitions := range []map[string]Definition{s.types, s.elements} {
		for _, definition := range definitions {
			if err := s.validateDefinitionSemantics(definition); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Schema) validateDefinitionSemantics(definition Definition) error {
	kind, resolved, err := s.effectiveKind(definition, map[string]bool{})
	if err != nil {
		return fmt.Errorf("%s: %w", definition.name, err)
	}
	hasSiblingRules := len(definition.dependentRequired) > 0 ||
		len(definition.mutuallyExclusive) > 0 || len(definition.exactlyOne) > 0
	if hasSiblingRules {
		if !resolved || (kind != TypeTable && kind != TypeCollection) {
			return fmt.Errorf("%s sibling rules require an effective table or collection", definition.name)
		}
		fixed, err := s.effectiveFixedChildren(definition, map[string]bool{})
		if err != nil {
			return fmt.Errorf("%s: %w", definition.name, err)
		}
		checkName := func(property, operand string) error {
			if !fixed[operand] {
				return fmt.Errorf("%s %s contains unknown fixed child %q", definition.name, property, operand)
			}
			return nil
		}
		for trigger, dependencies := range definition.dependentRequired {
			if err := checkName("dependentrequired", trigger); err != nil {
				return err
			}
			for _, dependency := range dependencies {
				if err := checkName("dependentrequired", dependency); err != nil {
					return err
				}
			}
		}
		for property, groups := range map[string][][]string{
			"mutuallyexclusive": definition.mutuallyExclusive,
			"exactlyone":        definition.exactlyOne,
		} {
			for _, group := range groups {
				for _, operand := range group {
					if err := checkName(property, operand); err != nil {
						return err
					}
				}
			}
		}
	}
	if definition.uniqueItems != nil && (!resolved || kind != TypeArray) {
		return fmt.Errorf("%s uniqueitems requires an effective array", definition.name)
	}
	if resolved && kind == TypeCollection {
		hasItemConstraint, err := s.hasCollectionItemConstraint(definition, map[string]bool{})
		if err != nil {
			return fmt.Errorf("%s: %w", definition.name, err)
		}
		if !hasItemConstraint {
			return fmt.Errorf("%s effective collection must define at least one itemtype", definition.name)
		}
	}
	if definition.condition != nil {
		if !resolved || (kind != TypeTable && kind != TypeCollection) {
			return fmt.Errorf("%s conditional selector requires compatible table or collection branches", definition.name)
		}
	}
	for _, child := range definition.children {
		if err := s.validateDefinitionSemantics(child); err != nil {
			return err
		}
	}
	return nil
}

func (s *Schema) effectiveKind(definition Definition, visiting map[string]bool) (SchemaType, bool, error) {
	var kind SchemaType
	var resolved bool
	var err error
	switch {
	case definition.reference != "":
		target, ok := s.types[definition.reference]
		if !ok {
			return "", false, fmt.Errorf("unknown type reference: %s", definition.reference)
		}
		if visiting[definition.reference] {
			return "", false, fmt.Errorf("cyclic type reference: %s", definition.reference)
		}
		visiting[definition.reference] = true
		kind, resolved, err = s.effectiveKind(target, visiting)
		delete(visiting, definition.reference)
		if err != nil {
			return "", false, err
		}
	case len(definition.oneOf) > 0 || len(definition.anyOf) > 0:
		alternatives := definition.oneOf
		if len(alternatives) == 0 {
			alternatives = definition.anyOf
		}
		for _, reference := range alternatives {
			alternative, err := s.definitionForReference(reference)
			if err != nil {
				return "", false, err
			}
			alternativeKind, ok, err := s.effectiveKind(alternative, visiting)
			if err != nil {
				return "", false, err
			}
			if !ok || (resolved && alternativeKind != kind) {
				resolved = false
				kind = ""
				break
			}
			kind, resolved = alternativeKind, true
		}
	case definition.condition != nil:
		for _, reference := range []string{definition.thenReference, definition.elseReference} {
			branch, err := s.definitionForReference(reference)
			if err != nil {
				return "", false, err
			}
			branchKind, ok, err := s.effectiveKind(branch, visiting)
			if err != nil {
				return "", false, err
			}
			if !ok || (resolved && branchKind != kind) {
				return "", false, fmt.Errorf("conditional branches have incompatible effective kinds")
			}
			kind, resolved = branchKind, true
		}
	default:
		kind, resolved = definition.typeName, definition.typeName != ""
	}
	if len(definition.allOf) == 0 {
		return kind, resolved, nil
	}
	if !resolved || kind == TypeAny {
		return "", false, fmt.Errorf("allof requires a determinate effective kind")
	}
	for _, reference := range definition.allOf {
		component, err := s.definitionForReference(reference)
		if err != nil {
			return "", false, err
		}
		componentKind, ok, err := s.effectiveKind(component, visiting)
		if err != nil {
			return "", false, err
		}
		if !ok || componentKind == TypeAny || componentKind != kind {
			return "", false, fmt.Errorf("allof component %s has incompatible effective kind", reference)
		}
	}
	return kind, true, nil
}

func (s *Schema) effectiveFixedChildren(definition Definition, visiting map[string]bool) (map[string]bool, error) {
	fixed := map[string]bool{}
	for name := range definition.children {
		fixed[name] = true
	}
	references := append([]string(nil), definition.allOf...)
	if definition.reference != "" {
		references = append(references, definition.reference)
	}
	references = append(references, definition.oneOf...)
	references = append(references, definition.anyOf...)
	if definition.condition != nil {
		references = append(references, definition.thenReference, definition.elseReference)
	}
	for _, reference := range references {
		if _, builtIn := parseSchemaType(reference); builtIn {
			continue
		}
		if visiting[reference] {
			return nil, fmt.Errorf("cyclic composition reference: %s", reference)
		}
		target, ok := s.types[reference]
		if !ok {
			return nil, fmt.Errorf("unknown type reference: %s", reference)
		}
		visiting[reference] = true
		targetFixed, err := s.effectiveFixedChildren(target, visiting)
		delete(visiting, reference)
		if err != nil {
			return nil, err
		}
		for name := range targetFixed {
			fixed[name] = true
		}
	}
	return fixed, nil
}

// hasCollectionItemConstraint reports whether a dynamic-entry constraint is
// supplied by this definition, by the definition it references, by a union
// alternative, or by an allof component.
func (s *Schema) hasCollectionItemConstraint(definition Definition, visiting map[string]bool) (bool, error) {
	if definition.itemReference != "" {
		return true, nil
	}
	references := []string{}
	if definition.reference != "" {
		references = append(references, definition.reference)
	}
	references = append(references, definition.oneOf...)
	references = append(references, definition.anyOf...)
	if definition.condition != nil {
		references = append(references, definition.thenReference, definition.elseReference)
	}
	references = append(references, definition.allOf...)
	for _, reference := range references {
		if _, builtIn := parseSchemaType(reference); builtIn {
			continue
		}
		if visiting[reference] {
			return false, fmt.Errorf("cyclic composition reference: %s", reference)
		}
		target, ok := s.types[reference]
		if !ok {
			return false, fmt.Errorf("unknown type reference: %s", reference)
		}
		visiting[reference] = true
		found, err := s.hasCollectionItemConstraint(target, visiting)
		delete(visiting, reference)
		if err != nil {
			return false, err
		}
		if found {
			return true, nil
		}
	}
	return false, nil
}

func (s *Schema) definitionForReference(reference string) (Definition, error) {
	normalized := normalizeReference(reference)
	if builtIn, ok := parseSchemaType(normalized); ok {
		return Definition{name: normalized, typeName: builtIn}, nil
	}
	definition, ok := s.types[normalized]
	if !ok {
		return Definition{}, fmt.Errorf("unknown type reference: %s", reference)
	}
	return definition, nil
}

// Default returns the effective, non-materializing default annotation.
func (d Definition) Default() (any, bool) {
	return d.defaultValue, d.hasDefault
}

func (d Definition) Description() string {
	return d.description
}

func (d Definition) Deprecated() bool {
	return d.deprecated
}

func (d Definition) Child(name string) (Definition, bool) {
	child, ok := d.children[name]
	return child, ok
}

// Element returns an element definition with inherited annotations resolved.
func (s *Schema) Element(name string) (Definition, bool) {
	definition, ok := s.elements[name]
	if !ok {
		return Definition{}, false
	}
	return s.withEffectiveAnnotations(definition), true
}

// Type returns a named type definition with inherited annotations resolved.
func (s *Schema) Type(name string) (Definition, bool) {
	definition, ok := s.types[normalizeReference(name)]
	if !ok {
		return Definition{}, false
	}
	return s.withEffectiveAnnotations(definition), true
}

func (s *Schema) withEffectiveAnnotations(definition Definition) Definition {
	resolver := &annotationResolver{
		schema:   s,
		visiting: map[string]bool{},
		resolved: map[string]Definition{},
	}
	effective, _ := resolver.resolve(definition)
	return effective
}

// annotationResolver materializes effective annotations for a definition tree.
// Schemas may legally recurse through child definitions that reference an
// enclosing named type, so resolution is guarded against re-entering a
// definition it is already expanding and memoizes fully expanded results.
type annotationResolver struct {
	schema   *Schema
	visiting map[string]bool
	resolved map[string]Definition
}

func (r *annotationResolver) resolve(definition Definition) (Definition, bool) {
	key := definition.name + "\x00" + definition.reference
	if cached, ok := r.resolved[key]; ok {
		return cached, true
	}
	effective := r.annotate(definition)
	if r.visiting[key] {
		return effective, false
	}
	r.visiting[key] = true
	defer delete(r.visiting, key)
	complete := true
	children := make(map[string]Definition, len(effective.children))
	for name, child := range effective.children {
		resolvedChild, childComplete := r.resolve(child)
		complete = complete && childComplete
		children[name] = resolvedChild
	}
	effective.children = children
	if complete {
		r.resolved[key] = effective
	}
	return effective, complete
}

// annotate resolves the annotations of a single node without descending into
// its children, so it always terminates.
func (r *annotationResolver) annotate(definition Definition) Definition {
	original := definition
	if resolved, err := (&validator{schema: r.schema}).resolve(definition, map[string]bool{}); err == nil {
		definition = resolved
	}
	if value, ok, err := r.schema.effectiveDefault(original, map[string]bool{}); err == nil && ok {
		definition.defaultValue, definition.hasDefault = value, true
	}
	definition.deprecated = r.schema.effectiveDeprecated(original, map[string]bool{})
	if definition.description == "" {
		definition.description = r.schema.effectiveDescription(original, map[string]bool{})
	}
	return definition
}

func (s *Schema) effectiveDescription(definition Definition, visiting map[string]bool) string {
	if definition.description != "" {
		return definition.description
	}
	reference := definition.reference
	if reference == "" {
		return ""
	}
	if _, builtIn := parseSchemaType(reference); builtIn || visiting[reference] {
		return ""
	}
	target, ok := s.types[reference]
	if !ok {
		return ""
	}
	visiting[reference] = true
	defer delete(visiting, reference)
	return s.effectiveDescription(target, visiting)
}

func (s *Schema) effectiveDeprecated(definition Definition, visiting map[string]bool) bool {
	if definition.deprecated {
		return true
	}
	references := append([]string(nil), definition.allOf...)
	if definition.reference != "" {
		references = append(references, definition.reference)
	}
	for _, reference := range references {
		if _, builtIn := parseSchemaType(reference); builtIn || visiting[reference] {
			continue
		}
		if target, ok := s.types[reference]; ok {
			visiting[reference] = true
			deprecated := s.effectiveDeprecated(target, visiting)
			delete(visiting, reference)
			if deprecated {
				return true
			}
		}
	}
	return false
}

func (s *Schema) effectiveDefault(definition Definition, visiting map[string]bool) (any, bool, error) {
	if definition.hasDefault {
		return definition.defaultValue, true, nil
	}
	var value any
	found := false
	references := append([]string(nil), definition.allOf...)
	if definition.reference != "" {
		references = append([]string{definition.reference}, references...)
	}
	for _, reference := range references {
		if _, builtIn := parseSchemaType(reference); builtIn {
			continue
		}
		if visiting[reference] {
			return nil, false, fmt.Errorf("cyclic default reference: %s", reference)
		}
		target, ok := s.types[reference]
		if !ok {
			continue
		}
		visiting[reference] = true
		candidate, hasCandidate, err := s.effectiveDefault(target, visiting)
		delete(visiting, reference)
		if err != nil {
			return nil, false, err
		}
		if !hasCandidate {
			continue
		}
		if found && !valuesEqual(value, candidate) {
			return nil, false, fmt.Errorf("%s has conflicting inherited defaults", definition.name)
		}
		value, found = candidate, true
	}
	return value, found, nil
}

func (s *Schema) validateDefaults() error {
	var validateDefinition func(Definition) error
	validateDefinition = func(definition Definition) error {
		value, hasDefault, err := s.effectiveDefault(definition, map[string]bool{})
		if err != nil {
			return err
		}
		if hasDefault {
			candidate := &validator{schema: s, suppressWarnings: true}
			candidate.validateValue(definition.name, value, definition)
			if len(candidate.errors) > 0 {
				return fmt.Errorf("%s default is invalid: %s", definition.name, candidate.errors[0].Message)
			}
		}
		for _, child := range definition.children {
			if err := validateDefinition(child); err != nil {
				return err
			}
		}
		return nil
	}
	for _, definitions := range []map[string]Definition{s.types, s.elements} {
		for _, definition := range definitions {
			if err := validateDefinition(definition); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Schema) ValidateFile(path string) ValidationResult {
	document, err := parseTOMLFile(path)
	if err != nil {
		diagnostic := ValidationError{Severity: SeverityError, Code: "document-parse-error", Path: "$", Message: err.Error()}
		return ValidationResult{Errors: []ValidationError{diagnostic}, Diagnostics: []Diagnostic{diagnostic}}
	}
	return s.Validate(document)
}

func (s *Schema) Validate(document map[string]any) ValidationResult {
	v := validator{schema: s}
	v.validateTable("$", document, s.elements)
	for key := range document {
		if _, ok := s.elements[key]; !ok && key != "toml-schema" {
			v.add("$."+encodePathKey(key), "unexpected key")
		}
	}
	diagnostics := make([]Diagnostic, 0, len(v.errors)+len(v.warnings))
	diagnostics = append(diagnostics, v.errors...)
	diagnostics = append(diagnostics, v.warnings...)
	return ValidationResult{Errors: v.errors, Warnings: v.warnings, Diagnostics: diagnostics}
}

func parseTOMLFile(path string) (map[string]any, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := toml.Unmarshal(content, &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

func parseDefinitions(prefix string, table map[string]any, required bool, source *schemaSource) (map[string]Definition, error) {
	if table == nil {
		if required {
			return nil, fmt.Errorf("missing required [%s] table", prefix)
		}
		return map[string]Definition{}, nil
	}
	definitions := map[string]Definition{}
	for key, value := range table {
		if prefix == "types" {
			if _, ok := parseSchemaType(key); ok {
				return nil, fmt.Errorf("[types.%s] uses a reserved built-in type name", key)
			}
			if strings.HasPrefix(key, "types.") {
				return nil, fmt.Errorf("[types.%s] uses the reserved type-reference prefix", key)
			}
		}
		valueMap, ok := asMap(value)
		if !ok {
			return nil, fmt.Errorf("[%s] entry must be a table: %s", prefix, key)
		}
		definition, err := parseDefinition(prefix+"."+key, []string{prefix, key}, valueMap, source)
		if err != nil {
			return nil, err
		}
		definitions[key] = definition
	}
	return definitions, nil
}

func parseDefinition(name string, path []string, table map[string]any, source *schemaSource) (Definition, error) {
	typeSelector, err := getString(table, "type")
	if err != nil {
		return Definition{}, err
	}
	if propertyValue(table, "type") != nil && typeSelector == "" {
		return Definition{}, fmt.Errorf("%s type must not be blank", name)
	}
	var typeName SchemaType
	var reference string
	if typeSelector != "" {
		if builtInType, ok := parseSchemaType(typeSelector); ok {
			typeName = builtInType
		} else {
			reference = normalizeReference(typeSelector)
		}
	}
	if reference != "" {
		for key := range table {
			if !namedReferenceKeys[key] {
				return Definition{}, fmt.Errorf("%s named type reference cannot define %s", name, key)
			}
		}
	}
	description, err := getString(table, "description")
	if err != nil {
		return Definition{}, err
	}
	itemReference, err := getString(table, "itemtype")
	if err != nil {
		return Definition{}, err
	}
	if propertyValue(table, "itemtype") != nil && itemReference == "" {
		return Definition{}, fmt.Errorf("%s itemtype must not be blank", name)
	}
	items, err := getStringArrayValues(table, "items")
	if err != nil {
		return Definition{}, err
	}
	if propertyValue(table, "items") != nil && len(items) == 0 {
		return Definition{}, fmt.Errorf("%s items must contain at least one type reference", name)
	}
	optional, err := getBool(table, "optional")
	if err != nil {
		return Definition{}, err
	}
	pattern, err := getPattern(name, table)
	if err != nil {
		return Definition{}, err
	}
	format, err := getString(table, "format")
	if err != nil {
		return Definition{}, err
	}
	if propertyValue(table, "format") != nil {
		if !supportedStringFormats[format] {
			return Definition{}, fmt.Errorf("%s contains unknown string format: %q", name, format)
		}
	}
	keyPattern, err := getPatternKey(name, table, "keypattern")
	if err != nil {
		return Definition{}, err
	}
	minLength, err := getIntegerPointer(table, "minlength")
	if err != nil {
		return Definition{}, err
	}
	maxLength, err := getIntegerPointer(table, "maxlength")
	if err != nil {
		return Definition{}, err
	}
	allowedValues, err := getArrayValues(table, "allowedvalues")
	if err != nil {
		return Definition{}, err
	}
	hasAllowedValues := propertyValue(table, "allowedvalues") != nil
	if hasAllowedValues && len(allowedValues) == 0 {
		return Definition{}, fmt.Errorf("%s allowedvalues must contain at least one entry", name)
	}
	hasOneOf := propertyValue(table, "oneof") != nil
	hasAnyOf := propertyValue(table, "anyof") != nil
	oneOf, err := getStringArrayValues(table, "oneof")
	if err != nil {
		return Definition{}, err
	}
	anyOf, err := getStringArrayValues(table, "anyof")
	if err != nil {
		return Definition{}, err
	}
	allOf, err := getStringArrayValues(table, "allof")
	if err != nil {
		return Definition{}, err
	}
	condition, thenReference, elseReference, err := getConditional(name, path, table, source)
	if err != nil {
		return Definition{}, err
	}
	for property, references := range map[string][]string{
		"items": items, "oneof": oneOf, "anyof": anyOf, "allof": allOf,
	} {
		if slices.Contains(references, "") {
			return Definition{}, fmt.Errorf("%s %s references must not be blank", name, property)
		}
	}
	if hasOneOf && len(oneOf) == 0 {
		return Definition{}, fmt.Errorf("%s oneof must contain at least one type reference", name)
	}
	if hasAnyOf && len(anyOf) == 0 {
		return Definition{}, fmt.Errorf("%s anyof must contain at least one type reference", name)
	}
	if propertyValue(table, "allof") != nil && len(allOf) == 0 {
		return Definition{}, fmt.Errorf("%s allof must contain at least one type reference", name)
	}
	if err := rejectBareCollectionReference(name, "itemtype", itemReference); err != nil {
		return Definition{}, err
	}
	if err := rejectBareCollectionReferences(name, "items", items); err != nil {
		return Definition{}, err
	}
	if err := validateAlternativeReferences(name, "oneof", oneOf); err != nil {
		return Definition{}, err
	}
	if err := validateAlternativeReferences(name, "anyof", anyOf); err != nil {
		return Definition{}, err
	}
	if err := validateAlternativeReferences(name, "allof", allOf); err != nil {
		return Definition{}, err
	}
	if typeSelector != "" && typeName != TypeCollection && normalizeReference(typeSelector) == string(TypeCollection) {
		return Definition{}, fmt.Errorf("%s cannot use collection as a bare type reference", name)
	}
	typeSelectors := 0
	if typeSelector != "" {
		typeSelectors++
	}
	if hasOneOf {
		typeSelectors++
	}
	if hasAnyOf {
		typeSelectors++
	}
	if condition != nil {
		typeSelectors++
	}
	if typeSelectors > 1 {
		return Definition{}, fmt.Errorf("%s cannot define more than one of type, oneof, anyof, and if", name)
	}
	children := map[string]Definition{}
	escapedChildren, childrenIsTable := asMap(table["children"])
	escapedPath := appendSourcePath(path, "children")
	hasEscapedChildren := childrenIsTable &&
		!source.isProperty(table, path, "children") &&
		!hasDefinitionMarker(escapedChildren, escapedPath, source)
	if hasEscapedChildren {
		if len(escapedChildren) == 0 {
			return Definition{}, fmt.Errorf("%s.children must contain at least one escaped child", name)
		}
		for key, value := range escapedChildren {
			if !definitionKeys[key] && key != "children" {
				return Definition{}, fmt.Errorf(
					"%s.children may only contain schema-key conflicts, found: %s", name, key)
			}
			childTable, ok := asMap(value)
			if !ok {
				return Definition{}, fmt.Errorf("%s.children.%s must be a table", name, key)
			}
			child, err := parseDefinition(name+"."+key, appendSourcePath(escapedPath, key), childTable, source)
			if err != nil {
				return Definition{}, err
			}
			children[key] = child
		}
	}
	for key, value := range table {
		if key == "children" && hasEscapedChildren {
			continue
		}
		if definitionKeys[key] && source.isProperty(table, path, key) {
			continue
		}
		childTable, ok := asMap(value)
		if ok {
			if _, exists := children[key]; exists {
				return Definition{}, fmt.Errorf("%s defines child %s more than once", name, key)
			}
			child, err := parseDefinition(name+"."+key, appendSourcePath(path, key), childTable, source)
			if err != nil {
				return Definition{}, err
			}
			children[key] = child
		} else if !definitionKeys[key] {
			return Definition{}, fmt.Errorf("%s contains unsupported property: %s", name, key)
		}
	}
	if hasOneOf || hasAnyOf {
		for key := range table {
			if !unionKeys[key] {
				return Definition{}, fmt.Errorf("%s union cannot define %s", name, key)
			}
		}
	}
	if condition != nil {
		for key := range table {
			if !conditionalKeys[key] {
				return Definition{}, fmt.Errorf("%s conditional selector cannot define %s", name, key)
			}
		}
		if len(children) > 0 {
			return Definition{}, fmt.Errorf("%s conditional selector cannot define child definitions", name)
		}
	}
	if typeName == "" && reference == "" && !hasOneOf && !hasAnyOf && condition == nil {
		if len(children) == 0 {
			return Definition{}, fmt.Errorf("%s must define type, oneof, anyof, or child definitions", name)
		}
		typeName = TypeTable
	}
	if len(children) > 0 && typeName != TypeTable && typeName != TypeCollection {
		return Definition{}, fmt.Errorf("%s can only define children when type is table or collection", name)
	}
	if typeName != TypeArray && typeName != TypeCollection && itemReference != "" {
		return Definition{}, fmt.Errorf("%s can only define itemtype when type is array or collection", name)
	}
	if typeName != TypeArray && len(items) > 0 {
		return Definition{}, fmt.Errorf("%s can only define items when type is array", name)
	}
	if len(items) > 0 {
		if itemReference != "" {
			return Definition{}, fmt.Errorf("%s cannot define both items and itemtype", name)
		}
		if minLength != nil || maxLength != nil {
			return Definition{}, fmt.Errorf("%s cannot define minlength or maxlength together with items", name)
		}
		if hasAllowedValues {
			return Definition{}, fmt.Errorf("%s cannot define allowedvalues together with items", name)
		}
		if propertyValue(table, "min") != nil || propertyValue(table, "max") != nil {
			return Definition{}, fmt.Errorf("%s cannot define min or max together with items", name)
		}
	}
	min := propertyValue(table, "min")
	max := propertyValue(table, "max")
	if minLength != nil && maxLength != nil && *minLength > *maxLength {
		return Definition{}, fmt.Errorf("%s minlength must not be greater than maxlength", name)
	}
	if keyPattern != nil && typeName != TypeCollection {
		return Definition{}, fmt.Errorf("%s can only define keypattern when type is collection", name)
	}
	if pattern != nil && typeName != TypeString {
		return Definition{}, fmt.Errorf("%s can only define pattern when type is string", name)
	}
	if format != "" && typeName != TypeString {
		return Definition{}, fmt.Errorf("%s can only define format when type is string", name)
	}
	if hasAllowedValues && (typeName == TypeTable || typeName == TypeCollection) {
		return Definition{}, fmt.Errorf("%s can only define allowedvalues for scalar, unconstrained, or array types", name)
	}
	if (minLength != nil || maxLength != nil) &&
		typeName != TypeString && typeName != TypeArray && typeName != TypeCollection {
		return Definition{}, fmt.Errorf(
			"%s can only define minlength or maxlength when type is string, array, or collection",
			name,
		)
	}
	if typeName == TypeCollection && itemReference == "" && len(allOf) == 0 {
		return Definition{}, fmt.Errorf("%s must define itemtype when type is collection", name)
	}
	if err := validateRangeConstraints(name, typeName, min, max); err != nil {
		return Definition{}, err
	}
	if err := validateAllowedValuesConstraints(name, typeName, allowedValues, pattern, format, min, max, minLength, maxLength); err != nil {
		return Definition{}, err
	}
	dependentRequired, err := getDependentRequired(name, path, table, source)
	if err != nil {
		return Definition{}, err
	}
	mutuallyExclusive, err := getKeyGroups(name, path, table, "mutuallyexclusive", source)
	if err != nil {
		return Definition{}, err
	}
	exactlyOne, err := getKeyGroups(name, path, table, "exactlyone", source)
	if err != nil {
		return Definition{}, err
	}
	uniqueItems, err := getOptionalBool(table, "uniqueitems")
	if err != nil {
		return Definition{}, err
	}
	deprecated, err := getOptionalBool(table, "deprecated")
	if err != nil {
		return Definition{}, err
	}
	hasDefault := source.isProperty(table, path, "default")
	var defaultValue any
	if hasDefault {
		defaultValue = table["default"]
	}
	return Definition{
		name: name, typeName: typeName, reference: reference, description: description,
		itemReference: normalizeReference(itemReference), optional: optional,
		items:         normalizeReferences(items),
		allowedValues: allowedValues, pattern: pattern, format: format, keyPattern: keyPattern, min: min, max: max,
		minLength: minLength, maxLength: maxLength, oneOf: normalizeReferences(oneOf), anyOf: normalizeReferences(anyOf),
		condition: condition, thenReference: normalizeReference(thenReference), elseReference: normalizeReference(elseReference),
		allOf: normalizeReferences(allOf), dependentRequired: dependentRequired,
		mutuallyExclusive: mutuallyExclusive, exactlyOne: exactlyOne, uniqueItems: uniqueItems,
		defaultValue: defaultValue, hasDefault: hasDefault,
		deprecated: deprecated != nil && *deprecated, hasDeprecated: deprecated != nil,
		children: children,
	}, nil
}

func (s *Schema) validateReferences(definitions map[string]Definition) error {
	for _, definition := range definitions {
		references := []string{definition.reference, definition.itemReference}
		references = append(references, definition.items...)
		references = append(references, definition.oneOf...)
		references = append(references, definition.anyOf...)
		if definition.condition != nil {
			references = append(references, definition.thenReference, definition.elseReference)
		}
		references = append(references, definition.allOf...)
		for _, reference := range references {
			if reference == "" {
				continue
			}
			if _, builtIn := parseSchemaType(reference); builtIn {
				continue
			}
			if _, exists := s.types[reference]; !exists {
				return fmt.Errorf("%s contains unknown type reference: %s", definition.name, reference)
			}
		}
		if err := s.validateReferences(definition.children); err != nil {
			return err
		}
	}
	return nil
}

func (s *Schema) validateSelectorCycles() error {
	visited := map[string]bool{}
	for typeName := range s.types {
		if err := s.validateSelectorCycle(typeName, map[string]bool{}, visited); err != nil {
			return err
		}
	}
	return nil
}

func (s *Schema) validateSelectorCycle(typeName string, visiting, visited map[string]bool) error {
	if _, builtIn := parseSchemaType(typeName); builtIn || visited[typeName] {
		return nil
	}
	if visiting[typeName] {
		return fmt.Errorf("cyclic type selector reference involving types.%s", typeName)
	}
	definition, exists := s.types[typeName]
	if !exists {
		return nil
	}
	visiting[typeName] = true
	references := []string{definition.reference}
	references = append(references, definition.oneOf...)
	references = append(references, definition.anyOf...)
	if definition.condition != nil {
		references = append(references, definition.thenReference, definition.elseReference)
	}
	references = append(references, definition.allOf...)
	for _, reference := range references {
		if reference != "" {
			if err := s.validateSelectorCycle(reference, visiting, visited); err != nil {
				return err
			}
		}
	}
	delete(visiting, typeName)
	visited[typeName] = true
	return nil
}

func rejectBareCollectionReferences(name, property string, references []string) error {
	for _, reference := range references {
		if err := rejectBareCollectionReference(name, property, normalizeReference(reference)); err != nil {
			return err
		}
	}
	return nil
}

func rejectBareCollectionReference(name, property, reference string) error {
	if normalizeReference(reference) == string(TypeCollection) {
		return fmt.Errorf("%s cannot use collection as a bare %s reference", name, property)
	}
	return nil
}

func validateAlternativeReferences(name, property string, references []string) error {
	for _, reference := range references {
		normalized := normalizeReference(reference)
		if err := rejectBareCollectionReference(name, property, normalized); err != nil {
			return err
		}
		if normalized == string(TypeAny) {
			return fmt.Errorf("%s cannot use any directly in %s", name, property)
		}
	}
	return nil
}

func validateRangeConstraints(name string, typeName SchemaType, min, max any) error {
	if min == nil && max == nil {
		return nil
	}
	if err := validateRangeBoundary(name, "min", min); err != nil {
		return err
	}
	if err := validateRangeBoundary(name, "max", max); err != nil {
		return err
	}
	if isNaN(min) {
		return fmt.Errorf("%s cannot use NaN as min", name)
	}
	if isNaN(max) {
		return fmt.Errorf("%s cannot use NaN as max", name)
	}
	if typeName == TypeAny {
		return fmt.Errorf("%s cannot define min or max when type is any", name)
	}
	if typeName == TypeArray {
		return nil
	}
	if typeName != "" && !isRangeComparable(typeName) {
		return fmt.Errorf("%s can only define min or max for integer, float, date/time, or compatible array types", name)
	}
	if typeName != "" {
		if err := validateBoundaryMatchesType(name, "min", min, typeName); err != nil {
			return err
		}
		if err := validateBoundaryMatchesType(name, "max", max, typeName); err != nil {
			return err
		}
	}
	return nil
}

func (s *Schema) validateArrayRanges() error {
	var validateDefinition func(Definition) error
	validateDefinition = func(definition Definition) error {
		if definition.typeName == TypeArray && (definition.min != nil || definition.max != nil) {
			itemType, ok, err := s.resolveItemKind(definition.itemReference, map[string]bool{})
			if err != nil {
				return fmt.Errorf("%s has invalid itemtype: %w", definition.name, err)
			}
			if !ok || !isRangeComparable(itemType) {
				return fmt.Errorf("%s can only define min or max when itemtype resolves to one comparable built-in type", definition.name)
			}
			if err := validateBoundaryMatchesType(definition.name, "min", definition.min, itemType); err != nil {
				return err
			}
			if err := validateBoundaryMatchesType(definition.name, "max", definition.max, itemType); err != nil {
				return err
			}
		}
		for _, child := range definition.children {
			if err := validateDefinition(child); err != nil {
				return err
			}
		}
		return nil
	}
	for _, definitions := range []map[string]Definition{s.types, s.elements} {
		for _, definition := range definitions {
			if err := validateDefinition(definition); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Schema) validateAllowedValueTypes() error {
	var validateDefinition func(Definition) error
	validateDefinition = func(definition Definition) error {
		permittedTypes := map[SchemaType]bool{}
		if len(definition.allowedValues) > 0 {
			if definition.typeName == TypeArray {
				if definition.itemReference != "" {
					if err := s.collectReferenceTypes(
						definition.itemReference,
						map[string]bool{},
						permittedTypes,
					); err != nil {
						return err
					}
				}
			} else if definition.typeName != "" {
				permittedTypes[definition.typeName] = true
			}
			for index, value := range definition.allowedValues {
				matches := len(permittedTypes) == 0
				for typeName := range permittedTypes {
					if isType(value, typeName) {
						matches = true
						break
					}
				}
				if !matches {
					return fmt.Errorf(
						"%s allowedvalues[%d] does not match the permitted TOML type",
						definition.name,
						index,
					)
				}
			}
		}
		for _, child := range definition.children {
			if err := validateDefinition(child); err != nil {
				return err
			}
		}
		return nil
	}
	for _, definitions := range []map[string]Definition{s.types, s.elements} {
		for _, definition := range definitions {
			if err := validateDefinition(definition); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Schema) collectReferenceTypes(
	reference string,
	seen map[string]bool,
	types map[SchemaType]bool,
) error {
	normalized := normalizeReference(reference)
	if builtInType, ok := parseSchemaType(normalized); ok {
		types[builtInType] = true
		return nil
	}
	if seen[normalized] {
		return fmt.Errorf("cyclic type reference: %s", normalized)
	}
	definition, ok := s.types[normalized]
	if !ok {
		return fmt.Errorf("unknown type reference: %s", reference)
	}
	seen[normalized] = true
	defer delete(seen, normalized)
	if definition.reference != "" {
		return s.collectReferenceTypes(definition.reference, seen, types)
	}
	if definition.condition != nil {
		for _, reference := range []string{definition.thenReference, definition.elseReference} {
			if err := s.collectReferenceTypes(reference, seen, types); err != nil {
				return err
			}
		}
		return nil
	}
	alternatives := definition.oneOf
	if len(alternatives) == 0 {
		alternatives = definition.anyOf
	}
	if len(alternatives) == 0 {
		types[definition.typeName] = true
		return nil
	}
	for _, alternative := range alternatives {
		if err := s.collectReferenceTypes(alternative, seen, types); err != nil {
			return err
		}
	}
	return nil
}

func (s *Schema) resolveItemKind(reference string, seen map[string]bool) (SchemaType, bool, error) {
	normalized := normalizeReference(reference)
	if normalized == "" {
		return "", false, nil
	}
	if builtInType, ok := parseSchemaType(normalized); ok {
		return builtInType, true, nil
	}
	if seen[normalized] {
		return "", false, fmt.Errorf("cyclic type reference: %s", normalized)
	}
	definition, ok := s.types[normalized]
	if !ok {
		return "", false, fmt.Errorf("unknown type reference: %s", reference)
	}
	seen[normalized] = true
	defer delete(seen, normalized)
	if definition.reference != "" {
		return s.resolveItemKind(definition.reference, seen)
	}
	if definition.condition != nil {
		var kind SchemaType
		for _, reference := range []string{definition.thenReference, definition.elseReference} {
			branchKind, resolved, err := s.resolveItemKind(reference, seen)
			if err != nil {
				return "", false, err
			}
			if !resolved || (kind != "" && branchKind != kind) {
				return "", false, nil
			}
			kind = branchKind
		}
		return kind, kind != "", nil
	}
	alternatives := definition.oneOf
	if len(alternatives) == 0 {
		alternatives = definition.anyOf
	}
	if len(alternatives) == 0 {
		return definition.typeName, definition.typeName != "", nil
	}
	var resolvedType SchemaType
	for _, alternative := range alternatives {
		alternativeType, resolved, err := s.resolveItemKind(alternative, seen)
		if err != nil {
			return "", false, err
		}
		if !resolved || (resolvedType != "" && alternativeType != resolvedType) {
			return "", false, nil
		}
		resolvedType = alternativeType
	}
	return resolvedType, resolvedType != "", nil
}

func validateRangeBoundary(name, key string, value any) error {
	if value == nil || isRangeBoundary(value) {
		return nil
	}
	return fmt.Errorf("%s %s must be an integer, float, or temporal value", name, key)
}

func isRangeBoundary(value any) bool {
	switch value.(type) {
	case int64, float64, time.Time, toml.LocalDateTime, toml.LocalDate, toml.LocalTime:
		return true
	default:
		return false
	}
}

func validateBoundaryMatchesType(name, key string, value any, typeName SchemaType) error {
	if value == nil || boundaryMatchesType(value, typeName) {
		return nil
	}
	return fmt.Errorf("%s %s must be comparable with %s", name, key, typeName)
}

func boundaryMatchesType(value any, typeName SchemaType) bool {
	switch typeName {
	case TypeInteger, TypeFloat:
		return isNumeric(value)
	case TypeOffsetDateTime:
		_, ok := value.(time.Time)
		return ok
	case TypeLocalDateTime:
		_, ok := value.(toml.LocalDateTime)
		return ok
	case TypeLocalDate:
		_, ok := value.(toml.LocalDate)
		return ok
	case TypeLocalTime:
		_, ok := value.(toml.LocalTime)
		return ok
	default:
		return false
	}
}

func validateAllowedValuesConstraints(
	name string,
	typeName SchemaType,
	allowedValues []any,
	pattern *regexp.Regexp,
	format string,
	min, max any,
	minLength, maxLength *int,
) error {
	if len(allowedValues) == 0 || typeName == TypeArray {
		return nil
	}
	for index, allowed := range allowedValues {
		entry := fmt.Sprintf("%s allowedvalues[%d]", name, index)
		if pattern != nil {
			stringValue, ok := allowed.(string)
			if !ok || !matchesPattern(pattern, stringValue) {
				return fmt.Errorf("%s does not satisfy pattern", entry)
			}
		}
		if format != "" {
			stringValue, ok := allowed.(string)
			if !ok || !validateStringFormat(format, stringValue) {
				return fmt.Errorf("%s does not satisfy format %s", entry, format)
			}
		}
		if (min != nil || max != nil) && isNaN(allowed) {
			return fmt.Errorf("%s does not satisfy min or max", entry)
		}
		if min != nil {
			comparison, err := compare(allowed, min)
			if err != nil {
				return fmt.Errorf("%s cannot be compared with min: %w", entry, err)
			}
			if comparison < 0 {
				return fmt.Errorf("%s is less than min", entry)
			}
		}
		if max != nil {
			comparison, err := compare(allowed, max)
			if err != nil {
				return fmt.Errorf("%s cannot be compared with max: %w", entry, err)
			}
			if comparison > 0 {
				return fmt.Errorf("%s is greater than max", entry)
			}
		}
		if minLength != nil || maxLength != nil {
			stringValue, ok := allowed.(string)
			if !ok {
				return fmt.Errorf("%s does not satisfy string length constraints", entry)
			}
			length := utf8.RuneCountInString(stringValue)
			if minLength != nil && length < *minLength {
				return fmt.Errorf("%s is shorter than minlength", entry)
			}
			if maxLength != nil && length > *maxLength {
				return fmt.Errorf("%s is longer than maxlength", entry)
			}
		}
	}
	return nil
}

type validator struct {
	schema           *Schema
	errors           []ValidationError
	warnings         []Diagnostic
	suppressWarnings bool
}

func (v *validator) validateTable(path string, table map[string]any, definitions map[string]Definition) {
	for key, definition := range definitions {
		resolved, err := v.resolve(definition, map[string]bool{})
		if err != nil {
			v.add(appendPath(path, key), err.Error())
			continue
		}
		value, ok := table[key]
		childPath := appendPath(path, key)
		if !ok || value == nil {
			if !resolved.optional {
				v.add(childPath, "required value is missing")
			}
			continue
		}
		v.validateValue(childPath, value, resolved)
	}
}

func (v *validator) validateValue(path string, value any, definition Definition) {
	candidate := &validator{schema: v.schema, suppressWarnings: v.suppressWarnings}
	candidate.validateValueInternal(path, value, definition)
	v.errors = append(v.errors, candidate.errors...)
	if len(candidate.errors) == 0 {
		v.appendWarnings(candidate.warnings)
	}
}

func (v *validator) validateValueInternal(path string, value any, definition Definition) {
	resolved, err := v.resolve(definition, map[string]bool{})
	if err != nil {
		v.add(path, err.Error())
		return
	}
	if resolved.condition != nil {
		v.validateConditional(path, value, resolved)
	} else if len(resolved.oneOf) > 0 || len(resolved.anyOf) > 0 {
		v.validateUnion(path, value, resolved)
	} else if len(resolved.allOf) > 0 {
		v.validateAllOf(path, value, resolved)
	} else {
		v.validatePlainValue(path, value, resolved)
	}
	if len(v.errors) == 0 && resolved.deprecated {
		v.warn(path, "deprecated", "value is deprecated")
	}
}

func (v *validator) validateConditional(path string, value any, definition Definition) {
	reference := definition.elseReference
	if table, ok := value.(map[string]any); ok && conditionMatches(table, definition.condition) {
		reference = definition.thenReference
	}
	branch, err := v.resolveReference(reference, map[string]bool{})
	if err != nil {
		v.add(path, err.Error())
		return
	}
	branch.allOf = append(branch.allOf, definition.allOf...)
	v.validateValue(path, value, branch)
}

func conditionMatches(table map[string]any, condition *condition) bool {
	value, present := table[condition.key]
	if !present {
		return false
	}
	if condition.hasEquals {
		return valuesEqual(condition.equals, value)
	}
	for _, candidate := range condition.in {
		if valuesEqual(candidate, value) {
			return true
		}
	}
	return false
}

func (v *validator) validatePlainValue(path string, value any, definition Definition) {
	typeName := definition.typeName
	if typeName == "" {
		typeName = TypeAny
	}
	v.validateType(path, value, typeName)
	if !isType(value, typeName) {
		return
	}
	v.validateCommonConstraints(path, value, definition)
	switch typeName {
	case TypeTable:
		v.validateTableValue(path, value.(map[string]any), definition)
	case TypeCollection:
		v.validateCollection(path, value.(map[string]any), definition)
	case TypeArray:
		v.validateArray(path, value.([]any), definition)
	}
}

func (v *validator) validateUnion(path string, value any, definition Definition) {
	alternatives := definition.oneOf
	if len(alternatives) == 0 {
		alternatives = definition.anyOf
	}
	matches := 0
	successes := []*validator{}
	for _, reference := range alternatives {
		referenced, err := v.resolveReference(reference, map[string]bool{})
		if err != nil {
			v.add(path, err.Error())
			return
		}
		referenced.allOf = append(referenced.allOf, definition.allOf...)
		referenced.dependentRequired = mergeDependencies(referenced.dependentRequired, definition.dependentRequired)
		referenced.mutuallyExclusive = append(referenced.mutuallyExclusive, definition.mutuallyExclusive...)
		referenced.exactlyOne = append(referenced.exactlyOne, definition.exactlyOne...)
		if definition.uniqueItems != nil {
			referenced.uniqueItems = definition.uniqueItems
		}
		candidate := &validator{schema: v.schema, suppressWarnings: v.suppressWarnings}
		candidate.validateValue(path, value, referenced)
		if len(candidate.errors) == 0 {
			matches++
			successes = append(successes, candidate)
		}
	}
	if len(definition.oneOf) > 0 && matches != 1 {
		v.add(path, fmt.Sprintf("expected exactly one matching type from oneof but found %d", matches))
	} else if len(definition.oneOf) > 0 {
		v.appendWarnings(successes[0].warnings)
	}
	if len(definition.anyOf) > 0 && matches == 0 {
		v.add(path, "expected at least one matching type from anyof")
	} else if len(definition.anyOf) > 0 {
		for _, candidate := range successes {
			v.appendWarnings(candidate.warnings)
		}
	}
}

func (v *validator) validateAllOf(path string, value any, definition Definition) {
	kind, resolved, err := v.schema.effectiveKind(definition, map[string]bool{})
	if err != nil || !resolved {
		if err == nil {
			err = fmt.Errorf("allof has no determinate effective kind")
		}
		v.add(path, err.Error())
		return
	}
	if kind == TypeTable || kind == TypeCollection {
		v.validateComposedStructure(path, value, kind, definition, nil)
		return
	}
	local := definition
	local.allOf = nil
	v.validatePlainValue(path, value, local)
	for _, reference := range definition.allOf {
		component, err := v.resolveReference(reference, map[string]bool{})
		if err != nil {
			v.add(path, err.Error())
			continue
		}
		v.validateValue(path, value, component)
	}
}

// compositionParts separates the contributors of a composed table or collection
// into structural contributors, which carry fixed children and dynamic-entry
// constraints directly, and union contributors, whose alternatives are selected
// per document value.
type compositionParts struct {
	structural   []Definition
	unions       []Definition
	conditionals []Definition
}

func (v *validator) compositionParts(definition Definition, visiting map[string]bool) (compositionParts, error) {
	resolved, err := v.resolve(definition, map[string]bool{})
	if err != nil {
		return compositionParts{}, err
	}
	references := append([]string(nil), resolved.allOf...)
	resolved.allOf = nil
	parts := compositionParts{}
	if resolved.condition != nil {
		parts.conditionals = append(parts.conditionals, resolved)
	} else if len(resolved.oneOf) > 0 || len(resolved.anyOf) > 0 {
		parts.unions = append(parts.unions, resolved)
	} else {
		parts.structural = append(parts.structural, resolved)
	}
	for _, reference := range references {
		if visiting[reference] {
			return compositionParts{}, fmt.Errorf("cyclic composition reference: %s", reference)
		}
		visiting[reference] = true
		component, err := v.resolveReference(reference, map[string]bool{})
		if err != nil {
			delete(visiting, reference)
			return compositionParts{}, err
		}
		nested, err := v.compositionParts(component, visiting)
		delete(visiting, reference)
		if err != nil {
			return compositionParts{}, err
		}
		parts.structural = append(parts.structural, nested.structural...)
		parts.unions = append(parts.unions, nested.unions...)
		parts.conditionals = append(parts.conditionals, nested.conditionals...)
	}
	return parts, nil
}

func (v *validator) validateComposedStructure(
	path string,
	value any,
	kind SchemaType,
	definition Definition,
	inheritedKeys map[string]bool,
) {
	parts, err := v.compositionParts(definition, map[string]bool{})
	if err != nil {
		v.add(path, err.Error())
		return
	}
	v.validateComposedParts(path, value, kind, parts, inheritedKeys)
}

func (v *validator) validateComposedParts(
	path string,
	value any,
	kind SchemaType,
	parts compositionParts,
	inheritedKeys map[string]bool,
) {
	table, ok := value.(map[string]any)
	if !ok {
		v.validateType(path, value, kind)
		return
	}
	children := map[string][]Definition{}
	hasFixedStructure := len(inheritedKeys) > 0
	for _, component := range parts.structural {
		if component.typeName != kind {
			v.add(path, fmt.Sprintf("expected %s component but found %s", kind, component.typeName))
			continue
		}
		if len(component.children) > 0 {
			hasFixedStructure = true
		}
		for name, child := range component.children {
			children[name] = append(children[name], child)
		}
	}
	knownKeys := map[string]bool{}
	for name := range inheritedKeys {
		knownKeys[name] = true
	}
	for name := range children {
		knownKeys[name] = true
	}
	unions := make([]Definition, 0, len(parts.unions))
	unionKeys := make([]map[string]bool, 0, len(parts.unions))
	for _, union := range parts.unions {
		alternativeKeys, err := v.schema.effectiveFixedChildren(union, map[string]bool{})
		if err != nil {
			v.add(path, err.Error())
			continue
		}
		if len(alternativeKeys) > 0 {
			hasFixedStructure = true
		}
		for name := range alternativeKeys {
			knownKeys[name] = true
		}
		unions = append(unions, union)
		unionKeys = append(unionKeys, alternativeKeys)
	}
	conditionals := make([]Definition, 0, len(parts.conditionals))
	conditionalKeys := make([]map[string]bool, 0, len(parts.conditionals))
	for _, conditional := range parts.conditionals {
		branchKeys, err := v.schema.effectiveFixedChildren(conditional, map[string]bool{})
		if err != nil {
			v.add(path, err.Error())
			continue
		}
		if len(branchKeys) > 0 {
			hasFixedStructure = true
		}
		for name := range branchKeys {
			knownKeys[name] = true
		}
		conditionals = append(conditionals, conditional)
		conditionalKeys = append(conditionalKeys, branchKeys)
	}
	selectorKeys := append(append([]map[string]bool{}, unionKeys...), conditionalKeys...)
	for name, definitions := range children {
		childPath := appendPath(path, name)
		childValue, present := table[name]
		for _, child := range definitions {
			resolved, err := v.resolve(child, map[string]bool{})
			if err != nil {
				v.add(childPath, err.Error())
				continue
			}
			if !present {
				if !resolved.optional {
					v.add(childPath, "required value is missing")
				}
				continue
			}
			v.validateValue(childPath, childValue, child)
		}
	}
	for index, union := range unions {
		// A branch is closed against the keys contributed by the rest of the
		// composition, but not against the keys exclusive to its sibling
		// alternatives.
		branchKeys := map[string]bool{}
		for name := range inheritedKeys {
			branchKeys[name] = true
		}
		for name := range children {
			branchKeys[name] = true
		}
		for otherIndex, keys := range selectorKeys {
			if otherIndex == index {
				continue
			}
			for name := range keys {
				branchKeys[name] = true
			}
		}
		v.validateComposedUnion(path, value, kind, union, branchKeys)
	}
	for index, conditional := range conditionals {
		branchKeys := map[string]bool{}
		for name := range inheritedKeys {
			branchKeys[name] = true
		}
		for name := range children {
			branchKeys[name] = true
		}
		selectorIndex := len(unions) + index
		for otherIndex, keys := range selectorKeys {
			if otherIndex == selectorIndex {
				continue
			}
			for name := range keys {
				branchKeys[name] = true
			}
		}
		v.validateComposedConditional(path, value, kind, conditional, branchKeys)
	}
	for _, component := range parts.structural {
		v.validateSiblingRules(path, table, component)
	}
	for _, union := range unions {
		v.validateSiblingRules(path, table, union)
	}
	if kind == TypeTable {
		if hasFixedStructure {
			for key := range table {
				if !knownKeys[key] {
					v.add(appendPath(path, key), "unexpected key")
				}
			}
		}
	} else {
		for _, component := range parts.structural {
			dynamicEntries := 0
			for key, entry := range table {
				if knownKeys[key] {
					continue
				}
				dynamicEntries++
				childPath := appendPath(path, key)
				if component.keyPattern != nil && !matchesPattern(component.keyPattern, key) {
					v.add(childPath, "key does not match keypattern "+component.keyPattern.String())
				}
				// A composed collection may take its dynamic-entry constraint
				// entirely from another contributor.
				if component.itemReference == "" {
					continue
				}
				item, err := v.resolveReference(component.itemReference, map[string]bool{})
				if err != nil {
					v.add(childPath, err.Error())
				} else {
					v.validateValue(childPath, entry, item)
				}
			}
			v.validateLength(path, dynamicEntries, component)
		}
	}
	for _, component := range parts.structural {
		if component.deprecated {
			v.warn(path, "deprecated", "value is deprecated")
		}
	}
	for _, union := range unions {
		if union.deprecated {
			v.warn(path, "deprecated", "value is deprecated")
		}
	}
	for _, conditional := range conditionals {
		if conditional.deprecated {
			v.warn(path, "deprecated", "value is deprecated")
		}
	}
}

// validateComposedUnion selects an alternative of a union contributor against
// the composed value. Alternatives are validated in isolated validators so a
// failed branch never leaks its own diagnostics; only the aggregate union
// outcome is reported.
func (v *validator) validateComposedUnion(
	path string,
	value any,
	kind SchemaType,
	definition Definition,
	knownKeys map[string]bool,
) {
	alternatives := definition.oneOf
	if len(alternatives) == 0 {
		alternatives = definition.anyOf
	}

	matches := 0
	successes := []*validator{}
	for _, reference := range alternatives {
		alternative, err := v.resolveReference(reference, map[string]bool{})
		if err != nil {
			v.add(path, err.Error())
			return
		}
		candidate := &validator{schema: v.schema, suppressWarnings: v.suppressWarnings}
		alternativeKind, resolved, err := v.schema.effectiveKind(alternative, map[string]bool{})
		switch {
		case err != nil:
			candidate.add(path, err.Error())
		case !resolved || alternativeKind != kind:
			candidate.add(path, fmt.Sprintf("expected %s alternative but found %s", kind, alternativeKind))
		default:
			candidate.validateComposedStructure(path, value, kind, alternative, knownKeys)
		}
		if len(candidate.errors) == 0 {
			matches++
			successes = append(successes, candidate)
		}
	}
	if len(definition.oneOf) > 0 {
		if matches != 1 {
			v.add(path, fmt.Sprintf("expected exactly one matching type from oneof but found %d", matches))
			return
		}
		v.appendWarnings(successes[0].warnings)
		return
	}
	if matches == 0 {
		v.add(path, "expected at least one matching type from anyof")
		return
	}
	for _, candidate := range successes {
		v.appendWarnings(candidate.warnings)
	}
}

func (v *validator) validateComposedConditional(
	path string,
	value any,
	kind SchemaType,
	definition Definition,
	knownKeys map[string]bool,
) {
	reference := definition.elseReference
	if table, ok := value.(map[string]any); ok && conditionMatches(table, definition.condition) {
		reference = definition.thenReference
	}
	branch, err := v.resolveReference(reference, map[string]bool{})
	if err != nil {
		v.add(path, err.Error())
		return
	}
	branchKind, resolved, err := v.schema.effectiveKind(branch, map[string]bool{})
	switch {
	case err != nil:
		v.add(path, err.Error())
	case !resolved || branchKind != kind:
		v.add(path, fmt.Sprintf("expected %s conditional branch but found %s", kind, branchKind))
	default:
		v.validateComposedStructure(path, value, kind, branch, knownKeys)
	}
}

func (v *validator) validateTableValue(path string, table map[string]any, definition Definition) {
	if len(definition.children) == 0 {
		return
	}
	v.validateTable(path, table, definition.children)
	for key := range table {
		if _, ok := definition.children[key]; !ok {
			v.add(appendPath(path, key), "unexpected key")
		}
	}
	v.validateSiblingRules(path, table, definition)
}

func (v *validator) validateCollection(path string, table map[string]any, definition Definition) {
	dynamicEntries := 0
	for key, value := range table {
		childPath := appendPath(path, key)
		if fixedChild, ok := definition.children[key]; ok {
			v.validateValue(childPath, value, fixedChild)
			continue
		}
		dynamicEntries++
		if definition.keyPattern != nil && !matchesPattern(definition.keyPattern, key) {
			v.add(childPath, "key does not match keypattern "+definition.keyPattern.String())
		}
		if definition.itemReference == "" {
			v.add(childPath, "collection entry has no itemtype reference")
			continue
		}
		referenced, err := v.resolveReference(definition.itemReference, map[string]bool{})
		if err != nil {
			v.add(childPath, err.Error())
			continue
		}
		v.validateValue(childPath, value, referenced)
	}
	v.validateLength(path, dynamicEntries, definition)
	for key, child := range definition.children {
		resolved, err := v.resolve(child, map[string]bool{})
		if err != nil {
			v.add(appendPath(path, key), err.Error())
			continue
		}
		if _, ok := table[key]; !ok && !resolved.optional {
			v.add(appendPath(path, key), "required value is missing")
		}
	}
	v.validateSiblingRules(path, table, definition)
}

func (v *validator) validateArray(path string, array []any, definition Definition) {
	v.validateLength(path, len(array), definition)
	if definition.uniqueItems != nil && *definition.uniqueItems {
		for index := range array {
			for previous := range index {
				if valuesEqual(array[previous], array[index]) {
					v.add(fmt.Sprintf("%s[%d]", path, index),
						fmt.Sprintf("duplicate item equals item at index %d", previous))
					break
				}
			}
		}
	}
	if len(definition.items) > 0 {
		v.validateTupleArray(path, array, definition)
		return
	}
	if definition.itemReference == "" {
		if len(definition.allowedValues) == 0 {
			return
		}
		for i, item := range array {
			v.validateAllowedValues(fmt.Sprintf("%s[%d]", path, i), item, definition)
		}
		return
	}
	itemDefinition, err := v.resolveReference(definition.itemReference, map[string]bool{})
	if err != nil {
		v.add(path, err.Error())
		return
	}
	rangeType, hasRangeType, _ := v.schema.resolveItemKind(definition.itemReference, map[string]bool{})
	for i, item := range array {
		itemPath := fmt.Sprintf("%s[%d]", path, i)
		v.validateValue(itemPath, item, itemDefinition)
		if len(definition.allowedValues) > 0 {
			v.validateAllowedValues(itemPath, item, definition)
		}
		if hasRangeType && isType(item, rangeType) {
			v.validateRange(itemPath, item, definition)
		}
	}
}

func (v *validator) validateSiblingRules(path string, table map[string]any, definition Definition) {
	// dependentrequired is evaluated on direct presence only. A mapping whose
	// trigger is absent never fires, so it cannot be reached through another
	// mapping that merely requires the trigger.
	for trigger, dependencies := range definition.dependentRequired {
		if _, present := table[trigger]; !present {
			continue
		}
		for _, dependency := range dependencies {
			if _, present := table[dependency]; !present {
				v.add(appendPath(path, dependency),
					fmt.Sprintf("required by dependentrequired triggered by sibling %q", trigger))
			}
		}
	}
	for _, group := range definition.mutuallyExclusive {
		present := presentGroupMembers(table, group)
		if len(present) > 1 {
			v.add(path, fmt.Sprintf("mutuallyexclusive group has multiple present members: %s",
				strings.Join(present, ", ")))
		}
	}
	for _, group := range definition.exactlyOne {
		present := presentGroupMembers(table, group)
		if len(present) != 1 {
			v.add(path, fmt.Sprintf("exactlyone group requires exactly one present member from: %s",
				strings.Join(group, ", ")))
		}
	}
}

func presentGroupMembers(table map[string]any, group []string) []string {
	present := []string{}
	for _, name := range group {
		if _, ok := table[name]; ok {
			present = append(present, name)
		}
	}
	return present
}

func (v *validator) validateTupleArray(path string, array []any, definition Definition) {
	if len(array) != len(definition.items) {
		v.add(path, fmt.Sprintf("expected array length %d but found %d", len(definition.items), len(array)))
	}
	upperBound := min(len(definition.items), len(array))
	for i := range upperBound {
		itemPath := fmt.Sprintf("%s[%d]", path, i)
		itemDefinition, err := v.resolveReference(definition.items[i], map[string]bool{})
		if err != nil {
			v.add(itemPath, err.Error())
			continue
		}
		v.validateValue(itemPath, array[i], itemDefinition)
	}
}

func (v *validator) validateType(path string, value any, typeName SchemaType) {
	if !isType(value, typeName) {
		v.add(path, fmt.Sprintf("expected %s but found %s", typeName, typeNameOf(value)))
	}
}

func (v *validator) validateCommonConstraints(path string, value any, definition Definition) {
	if array, ok := value.([]any); ok {
		v.validateLength(path, len(array), definition)
		return
	}
	v.validateAllowedValues(path, value, definition)
	if len(definition.allowedValues) > 0 {
		return
	}
	v.validateRange(path, value, definition)
	if stringValue, ok := value.(string); ok {
		v.validateLength(path, utf8.RuneCountInString(stringValue), definition)
		if definition.pattern != nil && !matchesPattern(definition.pattern, stringValue) {
			v.add(path, "does not match pattern "+definition.pattern.String())
		}
		if definition.format != "" && !validateStringFormat(definition.format, stringValue) {
			v.add(path, "invalid string for format "+definition.format)
		}
	}
}

func (v *validator) validateAllowedValues(path string, value any, definition Definition) {
	if len(definition.allowedValues) == 0 {
		return
	}
	for _, allowed := range definition.allowedValues {
		if valuesEqual(allowed, value) {
			return
		}
	}
	v.add(path, "value is not in allowedvalues")
}

func (v *validator) validateRange(path string, value any, definition Definition) {
	if definition.min != nil {
		comparison, err := compare(value, definition.min)
		if err != nil {
			v.add(path, err.Error())
		} else if comparison < 0 {
			v.add(path, "value is less than min")
		}
	}
	if definition.max != nil {
		comparison, err := compare(value, definition.max)
		if err != nil {
			v.add(path, err.Error())
		} else if comparison > 0 {
			v.add(path, "value is greater than max")
		}
	}
}

func (v *validator) validateLength(path string, length int, definition Definition) {
	if definition.minLength != nil && length < *definition.minLength {
		v.add(path, "length is less than minlength")
	}
	if definition.maxLength != nil && length > *definition.maxLength {
		v.add(path, "length is greater than maxlength")
	}
}

func (v *validator) resolve(definition Definition, seenReferences map[string]bool) (Definition, error) {
	if definition.reference == "" {
		return definition, nil
	}
	referenced, err := v.resolveReference(definition.reference, seenReferences)
	if err != nil {
		return Definition{}, err
	}
	referenced.name = definition.name
	if definition.description != "" {
		referenced.description = definition.description
	}
	referenced.optional = definition.optional || referenced.optional
	referenced.allOf = append(referenced.allOf, definition.allOf...)
	referenced.dependentRequired = mergeDependencies(referenced.dependentRequired, definition.dependentRequired)
	referenced.mutuallyExclusive = append(referenced.mutuallyExclusive, definition.mutuallyExclusive...)
	referenced.exactlyOne = append(referenced.exactlyOne, definition.exactlyOne...)
	if definition.uniqueItems != nil {
		referenced.uniqueItems = definition.uniqueItems
	}
	if definition.hasDefault {
		referenced.defaultValue, referenced.hasDefault = definition.defaultValue, true
	}
	referenced.deprecated = definition.deprecated || referenced.deprecated
	return referenced, nil
}

func mergeDependencies(left, right map[string][]string) map[string][]string {
	if len(left) == 0 && len(right) == 0 {
		return nil
	}
	merged := map[string][]string{}
	for trigger, dependencies := range left {
		merged[trigger] = append(merged[trigger], dependencies...)
	}
	for trigger, dependencies := range right {
		merged[trigger] = append(merged[trigger], dependencies...)
	}
	return merged
}

func (v *validator) resolveReference(reference string, seenReferences map[string]bool) (Definition, error) {
	normalized := normalizeReference(reference)
	if builtInType, ok := parseSchemaType(normalized); ok {
		return Definition{name: normalized, typeName: builtInType}, nil
	}
	if seenReferences[normalized] {
		return Definition{}, fmt.Errorf("cyclic type reference: %s", normalized)
	}
	definition, ok := v.schema.types[normalized]
	if !ok {
		return Definition{}, fmt.Errorf("unknown type reference: %s", reference)
	}
	seenReferences[normalized] = true
	defer delete(seenReferences, normalized)
	return v.resolve(definition, seenReferences)
}

func (v *validator) add(path, message string) {
	v.errors = append(v.errors, ValidationError{
		Severity: SeverityError, Code: "validation-error", Path: path, Message: message,
	})
}

func (v *validator) warn(path, code, message string) {
	if v.suppressWarnings {
		return
	}
	v.appendWarnings([]Diagnostic{{
		Severity: SeverityWarning, Code: code, Path: path, Message: message,
	}})
}

func (v *validator) appendWarnings(warnings []Diagnostic) {
	for _, warning := range warnings {
		duplicate := false
		for _, existing := range v.warnings {
			if existing.Code == warning.Code && existing.Path == warning.Path &&
				existing.Message == warning.Message {
				duplicate = true
				break
			}
		}
		if !duplicate {
			v.warnings = append(v.warnings, warning)
		}
	}
}

func SchemaFromDocument(documentPath string) (*Schema, map[string]any, error) {
	document, err := parseTOMLFile(documentPath)
	if err != nil {
		return nil, nil, err
	}
	metadata, ok := asMap(document["toml-schema"])
	if !ok {
		return nil, nil, fmt.Errorf("document does not contain [toml-schema].location")
	}
	for key, value := range metadata {
		if !isSchemaReferenceScalar(value) {
			return nil, nil, fmt.Errorf("document [toml-schema].%s must be a scalar value", key)
		}
	}
	location, ok := metadata["location"].(string)
	if !ok || strings.TrimSpace(location) == "" {
		return nil, nil, fmt.Errorf("document does not contain [toml-schema].location")
	}

	schemaPath, err := resolveSchemaLocation(documentPath, location)
	if err != nil {
		return nil, nil, err
	}
	schema, err := LoadSchema(schemaPath)
	if err != nil {
		return nil, nil, err
	}
	if expectedVersion, present := metadata["version"]; present {
		warning, err := compareDocumentSchemaVersion(expectedVersion, schema.version)
		if err != nil {
			return nil, nil, err
		}
		if warning != "" {
			schema.warnings = append(schema.warnings, warning)
		}
	}
	return schema, document, nil
}

func isSchemaReferenceScalar(value any) bool {
	switch value.(type) {
	case string, int64, float64, bool, time.Time, toml.LocalDateTime, toml.LocalDate, toml.LocalTime:
		return true
	default:
		return false
	}
}

func resolveSchemaLocation(documentPath, location string) (string, error) {
	if filepath.IsAbs(location) {
		return filepath.Clean(location), nil
	}
	if hasInvalidURIReferenceCharacter(location) {
		return "", fmt.Errorf("invalid [toml-schema].location URI: %s", location)
	}
	reference, err := url.Parse(location)
	if err != nil {
		return "", fmt.Errorf("invalid [toml-schema].location URI: %s: %w", location, err)
	}
	absoluteDocumentPath, err := filepath.Abs(documentPath)
	if err != nil {
		return "", fmt.Errorf("invalid document path: %w", err)
	}
	base := &url.URL{Scheme: "file", Path: filepath.ToSlash(absoluteDocumentPath)}
	resolved := base.ResolveReference(reference)
	if !strings.EqualFold(resolved.Scheme, "file") {
		return "", fmt.Errorf("unsupported schema location URI scheme: %s", resolved.Scheme)
	}
	path, err := localPathFromFileURI(resolved)
	if err != nil {
		return "", fmt.Errorf("invalid file schema location: %s: %w", location, err)
	}
	return filepath.Clean(path), nil
}

func hasInvalidURIReferenceCharacter(reference string) bool {
	for _, character := range reference {
		if character <= ' ' || character == 0x7f {
			return true
		}
		switch character {
		case '\\', '"', '<', '>', '^', '`', '{', '|', '}':
			return true
		}
	}
	return false
}

func localPathFromFileURI(uri *url.URL) (string, error) {
	if uri.Opaque != "" || uri.User != nil || uri.RawQuery != "" || uri.ForceQuery || uri.Fragment != "" {
		return "", fmt.Errorf("file URI contains unsupported components")
	}
	if uri.Host != "" && !strings.EqualFold(uri.Host, "localhost") {
		return "", fmt.Errorf("file URI has a non-local host")
	}
	escapedPath := strings.ToLower(uri.EscapedPath())
	if strings.Contains(escapedPath, "%2f") || strings.Contains(escapedPath, "%5c") {
		return "", fmt.Errorf("file URI contains an encoded path separator")
	}
	path := uri.Path
	if path == "" || strings.ContainsRune(path, 0) {
		return "", fmt.Errorf("file URI does not contain a safe path")
	}
	if runtime.GOOS == "windows" && len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	path = filepath.FromSlash(path)
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("file URI path is not absolute")
	}
	return path, nil
}

func compareDocumentSchemaVersion(value any, actual string) (string, error) {
	expected, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("document [toml-schema].version must be a SemVer string")
	}
	expectedParts := semverPattern.FindStringSubmatch(expected)
	if expectedParts == nil {
		return "", fmt.Errorf("document [toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax")
	}
	actualParts := semverPattern.FindStringSubmatch(actual)
	if expectedParts[1] != actualParts[1] {
		return "", fmt.Errorf(
			"document expects TOML Schema major version %s, but resolved schema uses %s",
			expected,
			actual,
		)
	}
	if expected != actual {
		return fmt.Sprintf(
			"Warning: document expects TOML Schema version %s, but resolved schema uses %s",
			expected,
			actual,
		), nil
	}
	return "", nil
}

func propertyValue(table map[string]any, key string) any {
	value := table[key]
	if _, ok := asMap(value); ok {
		return nil
	}
	return value
}

func hasDefinitionMarker(table map[string]any, path []string, source *schemaSource) bool {
	for _, key := range []string{"type", "oneof", "anyof", "if"} {
		if source.isProperty(table, path, key) {
			return true
		}
	}
	return false
}

func getString(table map[string]any, key string) (string, error) {
	value := propertyValue(table, key)
	if value == nil {
		return "", nil
	}
	stringValue, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("expected %s to be a string", key)
	}
	return stringValue, nil
}

func getBool(table map[string]any, key string) (bool, error) {
	value := propertyValue(table, key)
	if value == nil {
		return false, nil
	}
	boolValue, ok := value.(bool)
	if !ok {
		return false, fmt.Errorf("expected %s to be a boolean", key)
	}
	return boolValue, nil
}

func getOptionalBool(table map[string]any, key string) (*bool, error) {
	value := propertyValue(table, key)
	if value == nil {
		return nil, nil
	}
	boolValue, ok := value.(bool)
	if !ok {
		return nil, fmt.Errorf("expected %s to be a boolean", key)
	}
	return &boolValue, nil
}

func getConditional(
	name string,
	path []string,
	table map[string]any,
	source *schemaSource,
) (*condition, string, string, error) {
	hasIf := source.isProperty(table, path, "if")
	hasThen := source.isProperty(table, path, "then")
	hasElse := source.isProperty(table, path, "else")
	if !hasIf && !hasThen && !hasElse {
		return nil, "", "", nil
	}
	if !hasIf || !hasThen || !hasElse {
		return nil, "", "", fmt.Errorf("%s must define if, then, and else together", name)
	}
	if !source.isProperty(table, path, "if") {
		return nil, "", "", fmt.Errorf("%s if must be an inline table", name)
	}
	rawCondition, ok := asMap(table["if"])
	if !ok {
		return nil, "", "", fmt.Errorf("%s if must be an inline table", name)
	}
	for key := range rawCondition {
		if key != "key" && key != "equals" && key != "in" {
			return nil, "", "", fmt.Errorf("%s if contains unsupported property: %s", name, key)
		}
	}
	key, ok := rawCondition["key"].(string)
	if !ok {
		return nil, "", "", fmt.Errorf("%s if.key must be a string", name)
	}
	equals, hasEquals := rawCondition["equals"]
	rawIn, hasIn := rawCondition["in"]
	if hasEquals == hasIn {
		return nil, "", "", fmt.Errorf("%s if must define exactly one of equals and in", name)
	}
	var in []any
	if hasIn {
		in, ok = rawIn.([]any)
		if !ok || len(in) == 0 {
			return nil, "", "", fmt.Errorf("%s if.in must be a non-empty array", name)
		}
	}
	thenReference, ok := table["then"].(string)
	if !ok || strings.TrimSpace(thenReference) == "" {
		return nil, "", "", fmt.Errorf("%s then must be a non-blank named type reference", name)
	}
	elseReference, ok := table["else"].(string)
	if !ok || strings.TrimSpace(elseReference) == "" {
		return nil, "", "", fmt.Errorf("%s else must be a non-blank named type reference", name)
	}
	for property, reference := range map[string]string{"then": thenReference, "else": elseReference} {
		if _, builtIn := parseSchemaType(normalizeReference(reference)); builtIn {
			return nil, "", "", fmt.Errorf("%s %s must be a named reusable type reference", name, property)
		}
	}
	return &condition{key: key, equals: equals, in: in, hasEquals: hasEquals},
		thenReference, elseReference, nil
}

func getDependentRequired(name string, path []string, table map[string]any, source *schemaSource) (map[string][]string, error) {
	if !source.isProperty(table, path, "dependentrequired") {
		return nil, nil
	}
	dependencies, ok := asMap(table["dependentrequired"])
	if !ok {
		return nil, fmt.Errorf("%s dependentrequired must be a table", name)
	}
	if len(dependencies) == 0 {
		return nil, fmt.Errorf("%s dependentrequired must not be empty", name)
	}
	result := make(map[string][]string, len(dependencies))
	for trigger, raw := range dependencies {
		values, ok := raw.([]any)
		if !ok || len(values) == 0 {
			return nil, fmt.Errorf("%s dependentrequired.%s must be a non-empty string array", name, trigger)
		}
		seen := map[string]bool{}
		for _, value := range values {
			dependency, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("%s dependentrequired.%s must contain only strings", name, trigger)
			}
			if seen[dependency] {
				return nil, fmt.Errorf("%s dependentrequired.%s contains duplicate %q", name, trigger, dependency)
			}
			seen[dependency] = true
			result[trigger] = append(result[trigger], dependency)
		}
	}
	return result, nil
}

func getKeyGroups(name string, path []string, table map[string]any, key string, source *schemaSource) ([][]string, error) {
	if !source.isProperty(table, path, key) {
		return nil, nil
	}
	groups, ok := table[key].([]any)
	if !ok || len(groups) == 0 {
		return nil, fmt.Errorf("%s %s must be a non-empty array", name, key)
	}
	result := make([][]string, 0, len(groups))
	for index, rawGroup := range groups {
		group, ok := rawGroup.([]any)
		if !ok || len(group) < 2 {
			return nil, fmt.Errorf("%s %s[%d] must contain at least two strings", name, key, index)
		}
		seen := map[string]bool{}
		converted := make([]string, 0, len(group))
		for _, rawName := range group {
			operand, ok := rawName.(string)
			if !ok {
				return nil, fmt.Errorf("%s %s[%d] must contain only strings", name, key, index)
			}
			if seen[operand] {
				return nil, fmt.Errorf("%s %s[%d] contains duplicate %q", name, key, index, operand)
			}
			seen[operand] = true
			converted = append(converted, operand)
		}
		result = append(result, converted)
	}
	return result, nil
}

func getIntegerPointer(table map[string]any, key string) (*int, error) {
	value := propertyValue(table, key)
	if value == nil {
		return nil, nil
	}
	intValue, ok := value.(int64)
	if !ok {
		return nil, fmt.Errorf("expected %s to be an integer", key)
	}
	if intValue < 0 || intValue > math.MaxInt32 {
		return nil, fmt.Errorf("%s must be between 0 and %d", key, math.MaxInt32)
	}
	converted := int(intValue)
	return &converted, nil
}

func getPattern(name string, table map[string]any) (*regexp.Regexp, error) {
	return getPatternKey(name, table, "pattern")
}

func getPatternKey(name string, table map[string]any, key string) (*regexp.Regexp, error) {
	value := propertyValue(table, key)
	if value == nil {
		return nil, nil
	}
	pattern, ok := value.(string)
	if !ok {
		return nil, fmt.Errorf("expected %s to be a string", key)
	}
	compiled, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("%s has invalid %s: %w", name, key, err)
	}
	return compiled, nil
}

func getArrayValues(table map[string]any, key string) ([]any, error) {
	value := propertyValue(table, key)
	if value == nil {
		return nil, nil
	}
	array, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("expected %s to be an array", key)
	}
	return array, nil
}

func getStringArrayValues(table map[string]any, key string) ([]string, error) {
	values, err := getArrayValues(table, key)
	if err != nil {
		return nil, err
	}
	strings := make([]string, 0, len(values))
	for _, value := range values {
		stringValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("expected %s to contain only strings", key)
		}
		strings = append(strings, stringValue)
	}
	return strings, nil
}

func isType(value any, typeName SchemaType) bool {
	switch typeName {
	case TypeAny:
		return true
	case TypeString:
		_, ok := value.(string)
		return ok
	case TypeInteger:
		_, ok := value.(int64)
		return ok
	case TypeFloat:
		_, ok := value.(float64)
		return ok
	case TypeBoolean:
		_, ok := value.(bool)
		return ok
	case TypeOffsetDateTime:
		_, ok := value.(time.Time)
		return ok
	case TypeLocalDateTime:
		_, ok := value.(toml.LocalDateTime)
		return ok
	case TypeLocalDate:
		_, ok := value.(toml.LocalDate)
		return ok
	case TypeLocalTime:
		_, ok := value.(toml.LocalTime)
		return ok
	case TypeArray:
		_, ok := value.([]any)
		return ok
	case TypeTable, TypeCollection:
		_, ok := value.(map[string]any)
		return ok
	default:
		return false
	}
}

func compare(value, boundary any) (int, error) {
	if isNumeric(value) && isNumeric(boundary) {
		return compareNumbers(value, boundary)
	}
	switch value := value.(type) {
	case time.Time:
		boundary, ok := boundary.(time.Time)
		if !ok {
			break
		}
		return compareTime(value, boundary), nil
	case toml.LocalDateTime:
		boundary, ok := boundary.(toml.LocalDateTime)
		if !ok {
			break
		}
		return compareTime(value.AsTime(time.UTC), boundary.AsTime(time.UTC)), nil
	case toml.LocalDate:
		boundary, ok := boundary.(toml.LocalDate)
		if !ok {
			break
		}
		return compareTime(value.AsTime(time.UTC), boundary.AsTime(time.UTC)), nil
	case toml.LocalTime:
		boundary, ok := boundary.(toml.LocalTime)
		if !ok {
			break
		}
		return compareLocalTime(value, boundary), nil
	}
	return 0, fmt.Errorf("cannot compare %s with boundary %s", typeNameOf(value), typeNameOf(boundary))
}

func valuesEqual(allowed, value any) bool {
	if isNumeric(allowed) && isNumeric(value) {
		if isNaN(allowed) || isNaN(value) {
			return isNaN(allowed) && isNaN(value)
		}
		comparison, err := compareNumbers(allowed, value)
		return err == nil && comparison == 0
	}
	switch allowed := allowed.(type) {
	case time.Time:
		value, ok := value.(time.Time)
		return ok && offsetDateTimesEqual(allowed, value)
	case toml.LocalDateTime:
		value, ok := value.(toml.LocalDateTime)
		return ok && allowed.LocalDate == value.LocalDate &&
			localTimesEqual(allowed.LocalTime, value.LocalTime)
	case toml.LocalDate:
		value, ok := value.(toml.LocalDate)
		return ok && allowed == value
	case toml.LocalTime:
		value, ok := value.(toml.LocalTime)
		return ok && localTimesEqual(allowed, value)
	case []any:
		value, ok := value.([]any)
		if !ok || len(allowed) != len(value) {
			return false
		}
		for index := range allowed {
			if !valuesEqual(allowed[index], value[index]) {
				return false
			}
		}
		return true
	case map[string]any:
		value, ok := value.(map[string]any)
		if !ok || len(allowed) != len(value) {
			return false
		}
		for key, allowedValue := range allowed {
			valueEntry, exists := value[key]
			if !exists || !valuesEqual(allowedValue, valueEntry) {
				return false
			}
		}
		return true
	case string:
		value, ok := value.(string)
		return ok && allowed == value
	case bool:
		value, ok := value.(bool)
		return ok && allowed == value
	}
	return allowed == nil && value == nil
}

func offsetDateTimesEqual(left, right time.Time) bool {
	_, leftOffset := left.Zone()
	_, rightOffset := right.Zone()
	return left.Year() == right.Year() &&
		left.Month() == right.Month() &&
		left.Day() == right.Day() &&
		left.Hour() == right.Hour() &&
		left.Minute() == right.Minute() &&
		left.Second() == right.Second() &&
		left.Nanosecond() == right.Nanosecond() &&
		leftOffset == rightOffset
}

func localTimesEqual(left, right toml.LocalTime) bool {
	return left.Hour == right.Hour &&
		left.Minute == right.Minute &&
		left.Second == right.Second &&
		left.Nanosecond == right.Nanosecond
}

func isNumeric(value any) bool {
	switch value.(type) {
	case int64, float64:
		return true
	default:
		return false
	}
}

func compareNumbers(left, right any) (int, error) {
	if isNaN(left) || isNaN(right) {
		return 0, fmt.Errorf("NaN is unordered")
	}
	if leftInteger, ok := left.(int64); ok {
		if rightInteger, ok := right.(int64); ok {
			switch {
			case leftInteger < rightInteger:
				return -1, nil
			case leftInteger > rightInteger:
				return 1, nil
			default:
				return 0, nil
			}
		}
	}
	leftFloat, leftIsFloat := left.(float64)
	rightFloat, rightIsFloat := right.(float64)
	if (leftIsFloat && math.IsInf(leftFloat, 0)) || (rightIsFloat && math.IsInf(rightFloat, 0)) {
		return compareFloat(numberAsFloat(left), numberAsFloat(right)), nil
	}
	return numericRat(left).Cmp(numericRat(right)), nil
}

func numberAsFloat(value any) float64 {
	if integer, ok := value.(int64); ok {
		return float64(integer)
	}
	return value.(float64)
}

func numericRat(value any) *big.Rat {
	if integer, ok := value.(int64); ok {
		return new(big.Rat).SetInt64(integer)
	}
	return new(big.Rat).SetFloat64(value.(float64))
}

func typeNameOf(value any) string {
	switch value.(type) {
	case string:
		return "string"
	case int64:
		return "integer"
	case float64:
		return "float"
	case bool:
		return "boolean"
	case time.Time:
		return "offset-date-time"
	case toml.LocalDateTime:
		return "local-date-time"
	case toml.LocalDate:
		return "local-date"
	case toml.LocalTime:
		return "local-time"
	case []any:
		return "array"
	case map[string]any:
		return "table"
	default:
		return fmt.Sprintf("%T", value)
	}
}

func appendPath(path, key string) string {
	return path + "." + encodePathKey(key)
}

func encodePathKey(key string) string {
	if key != "" && regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(key) {
		return key
	}
	return fmt.Sprintf("%q", key)
}

func matchesPattern(pattern *regexp.Regexp, value string) bool {
	return pattern.MatchString(value)
}

func asMap(value any) (map[string]any, bool) {
	mapped, ok := value.(map[string]any)
	return mapped, ok
}

func mapValue(value any) map[string]any {
	mapped, _ := asMap(value)
	return mapped
}

func normalizeReference(reference string) string {
	return strings.TrimPrefix(reference, "types.")
}

func normalizeReferences(references []string) []string {
	normalized := make([]string, len(references))
	for i, reference := range references {
		normalized[i] = normalizeReference(reference)
	}
	return normalized
}

func isRangeComparable(typeName SchemaType) bool {
	switch typeName {
	case TypeInteger, TypeFloat, TypeOffsetDateTime, TypeLocalDateTime, TypeLocalDate, TypeLocalTime:
		return true
	default:
		return false
	}
}

func isNaN(value any) bool {
	floatValue, ok := value.(float64)
	return ok && math.IsNaN(floatValue)
}

func compareFloat(left, right float64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func compareTime(left, right time.Time) int {
	if left.Before(right) {
		return -1
	}
	if left.After(right) {
		return 1
	}
	return 0
}

func compareLocalTime(left, right toml.LocalTime) int {
	leftParts := []int{left.Hour, left.Minute, left.Second, left.Nanosecond}
	rightParts := []int{right.Hour, right.Minute, right.Second, right.Nanosecond}
	for i := range leftParts {
		if leftParts[i] < rightParts[i] {
			return -1
		}
		if leftParts[i] > rightParts[i] {
			return 1
		}
	}
	return 0
}
