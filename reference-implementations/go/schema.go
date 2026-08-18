package tomlschema

import (
	"fmt"
	"math"
	"math/big"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
	"allowedvalues": true, "pattern": true, "keypattern": true, "optional": true, "min": true,
	"max": true, "minlength": true, "maxlength": true,
	"oneof": true, "anyof": true,
}

var namedReferenceKeys = map[string]bool{"type": true, "description": true, "optional": true}
var unionKeys = map[string]bool{"oneof": true, "anyof": true, "description": true, "optional": true}

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
	name          string
	typeName      SchemaType
	reference     string
	description   string
	itemReference string
	items         []string
	optional      bool
	allowedValues []any
	pattern       *regexp.Regexp
	keyPattern    *regexp.Regexp
	min           any
	max           any
	minLength     *int
	maxLength     *int
	oneOf         []string
	anyOf         []string
	children      map[string]Definition
}

type ValidationError struct {
	Path    string
	Message string
}

type ValidationResult struct {
	Errors []ValidationError
}

func (r ValidationResult) Valid() bool {
	return len(r.Errors) == 0
}

func LoadSchema(path string) (*Schema, error) {
	parsed, err := parseTOMLFile(path)
	if err != nil {
		return nil, fmt.Errorf("unable to parse schema %s: %w", path, err)
	}
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
	types, err := parseDefinitions("types", mapValue(parsed["types"]), false)
	if err != nil {
		return nil, err
	}
	elements, err := parseDefinitions("elements", mapValue(parsed["elements"]), true)
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
	if err := schema.validateArrayRanges(); err != nil {
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

func (s *Schema) ValidateFile(path string) ValidationResult {
	document, err := parseTOMLFile(path)
	if err != nil {
		return ValidationResult{Errors: []ValidationError{{Path: "$", Message: err.Error()}}}
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
	return ValidationResult{Errors: v.errors}
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

func parseDefinitions(prefix string, table map[string]any, required bool) (map[string]Definition, error) {
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
		}
		valueMap, ok := asMap(value)
		if !ok {
			return nil, fmt.Errorf("[%s] entry must be a table: %s", prefix, key)
		}
		definition, err := parseDefinition(prefix+"."+key, valueMap)
		if err != nil {
			return nil, err
		}
		definitions[key] = definition
	}
	return definitions, nil
}

func parseDefinition(name string, table map[string]any) (Definition, error) {
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
	optional, err := getBool(table, "optional")
	if err != nil {
		return Definition{}, err
	}
	pattern, err := getPattern(name, table)
	if err != nil {
		return Definition{}, err
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
	for property, references := range map[string][]string{
		"items": items, "oneof": oneOf, "anyof": anyOf,
	} {
		for _, reference := range references {
			if reference == "" {
				return Definition{}, fmt.Errorf("%s %s references must not be blank", name, property)
			}
		}
	}
	if hasOneOf && len(oneOf) == 0 {
		return Definition{}, fmt.Errorf("%s oneof must contain at least one type reference", name)
	}
	if hasAnyOf && len(anyOf) == 0 {
		return Definition{}, fmt.Errorf("%s anyof must contain at least one type reference", name)
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
	if typeSelectors > 1 {
		return Definition{}, fmt.Errorf("%s cannot define more than one of type, oneof, and anyof", name)
	}
	children := map[string]Definition{}
	for key, value := range table {
		childTable, ok := asMap(value)
		if ok {
			if _, exists := children[key]; exists {
				return Definition{}, fmt.Errorf("%s defines child %s more than once", name, key)
			}
			child, err := parseDefinition(name+"."+key, childTable)
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
	if typeName == "" && reference == "" && !hasOneOf && !hasAnyOf {
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
	if (minLength != nil || maxLength != nil) &&
		typeName != TypeString && typeName != TypeArray && typeName != TypeCollection {
		return Definition{}, fmt.Errorf(
			"%s can only define minlength or maxlength when type is string, array, or collection",
			name,
		)
	}
	if typeName == TypeCollection && itemReference == "" {
		return Definition{}, fmt.Errorf("%s must define itemtype when type is collection", name)
	}
	if err := validateRangeConstraints(name, typeName, min, max); err != nil {
		return Definition{}, err
	}
	if err := validateAllowedValuesConstraints(name, typeName, allowedValues, pattern, min, max, minLength, maxLength); err != nil {
		return Definition{}, err
	}
	return Definition{
		name: name, typeName: typeName, reference: reference, description: description,
		itemReference: normalizeReference(itemReference), optional: optional,
		items:         normalizeReferences(items),
		allowedValues: allowedValues, pattern: pattern, keyPattern: keyPattern, min: min, max: max,
		minLength: minLength, maxLength: maxLength, oneOf: normalizeReferences(oneOf), anyOf: normalizeReferences(anyOf),
		children: children,
	}, nil
}

func (s *Schema) validateReferences(definitions map[string]Definition) error {
	for _, definition := range definitions {
		references := []string{definition.reference, definition.itemReference}
		references = append(references, definition.items...)
		references = append(references, definition.oneOf...)
		references = append(references, definition.anyOf...)
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
	schema *Schema
	errors []ValidationError
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
	resolved, err := v.resolve(definition, map[string]bool{})
	if err != nil {
		v.add(path, err.Error())
		return
	}
	if len(resolved.oneOf) > 0 || len(resolved.anyOf) > 0 {
		v.validateUnion(path, value, resolved)
		return
	}
	typeName := resolved.typeName
	if typeName == "" {
		typeName = TypeAny
	}
	v.validateType(path, value, typeName)
	if !isType(value, typeName) {
		return
	}
	v.validateCommonConstraints(path, value, resolved)
	switch typeName {
	case TypeTable:
		v.validateTableValue(path, value.(map[string]any), resolved)
	case TypeCollection:
		v.validateCollection(path, value.(map[string]any), resolved)
	case TypeArray:
		v.validateArray(path, value.([]any), resolved)
	}
}

func (v *validator) validateUnion(path string, value any, definition Definition) {
	alternatives := definition.oneOf
	if len(alternatives) == 0 {
		alternatives = definition.anyOf
	}
	matches := 0
	for _, reference := range alternatives {
		referenced, err := v.resolveReference(reference, map[string]bool{})
		if err != nil {
			v.add(path, err.Error())
			return
		}
		candidate := &validator{schema: v.schema}
		candidate.validateValue(path, value, referenced)
		if len(candidate.errors) == 0 {
			matches++
		}
	}
	if len(definition.oneOf) > 0 && matches != 1 {
		v.add(path, fmt.Sprintf("expected exactly one matching type from oneof but found %d", matches))
	}
	if len(definition.anyOf) > 0 && matches == 0 {
		v.add(path, "expected at least one matching type from anyof")
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
}

func (v *validator) validateArray(path string, array []any, definition Definition) {
	v.validateLength(path, len(array), definition)
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

func (v *validator) validateTupleArray(path string, array []any, definition Definition) {
	if len(array) != len(definition.items) {
		v.add(path, fmt.Sprintf("expected array length %d but found %d", len(definition.items), len(array)))
	}
	upperBound := len(array)
	if len(definition.items) < upperBound {
		upperBound = len(definition.items)
	}
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
	return Definition{
		name: definition.name, typeName: referenced.typeName, description: definition.description,
		itemReference: referenced.itemReference,
		items:         referenced.items,
		optional:      definition.optional || referenced.optional,
		allowedValues: referenced.allowedValues,
		pattern:       referenced.pattern,
		keyPattern:    referenced.keyPattern,
		min:           referenced.min,
		max:           referenced.max,
		minLength:     referenced.minLength,
		maxLength:     referenced.maxLength,
		oneOf:         referenced.oneOf,
		anyOf:         referenced.anyOf,
		children:      referenced.children,
	}, nil
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
	v.errors = append(v.errors, ValidationError{Path: path, Message: message})
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

func resolveSchemaLocation(documentPath, location string) (string, error) {
	absoluteDocumentPath, err := filepath.Abs(documentPath)
	if err != nil {
		return "", fmt.Errorf("invalid document path: %w", err)
	}
	base := &url.URL{Scheme: "file", Path: filepath.ToSlash(absoluteDocumentPath)}
	reference, err := url.Parse(location)
	if err != nil {
		return "", fmt.Errorf("invalid [toml-schema].location URI: %s: %w", location, err)
	}
	resolved := base.ResolveReference(reference)
	if !strings.EqualFold(resolved.Scheme, "file") {
		return "", fmt.Errorf("unsupported schema location URI scheme: %s", resolved.Scheme)
	}
	if resolved.Host != "" && !strings.EqualFold(resolved.Host, "localhost") {
		return "", fmt.Errorf("unsupported file schema location host: %s", resolved.Host)
	}
	return filepath.Clean(filepath.FromSlash(resolved.Path)), nil
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
	}
	return fmt.Sprintf("%#v", allowed) == fmt.Sprintf("%#v", value)
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
