package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseError;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import java.util.stream.Collectors;

final class SchemaLoader {
    static final Set<String> TOP_LEVEL_KEYS = Set.of("toml-schema", "types", "elements");
    static final Set<String> DEFINITION_KEYS = Set.of(
            "type", "description", "itemtype", "items", "allowedvalues", "pattern",
            "keypattern", "optional", "min", "max", "minlength", "maxlength",
            "oneof", "anyof"
    );
    private static final Set<String> NAMED_REFERENCE_KEYS = Set.of("type", "description", "optional");
    private static final Set<String> UNION_KEYS = Set.of("oneof", "anyof", "description", "optional");

    TomlSchema load(Path schemaPath) {
        TomlParseResult parsed;
        try {
            parsed = Toml.parse(schemaPath);
        } catch (IOException e) {
            throw new SchemaException("Unable to read schema: " + schemaPath, e);
        }
        if (parsed.hasErrors()) {
            throw new SchemaException("Unable to parse schema " + schemaPath + ": " + formatParseErrors(parsed.errors()));
        }
        String version = validateTopLevel(parsed);
        Map<String, SchemaDefinition> types = parseDefinitions("types", parsed.getTable("types"), false);
        Map<String, SchemaDefinition> elements = parseDefinitions("elements", parsed.getTable("elements"), true);
        validateReferences(types, types);
        validateReferences(types, elements);
        validateSelectorCycles(types);
        validateArrayRangeConstraints(types, types);
        validateArrayRangeConstraints(types, elements);
        return new TomlSchema(schemaPath, version, types, elements);
    }

    private String validateTopLevel(TomlTable schema) {
        if (!schema.isTable("toml-schema")) {
            throw new SchemaException("Schema must contain a [toml-schema] table");
        }
        if (!schema.isTable("elements")) {
            throw new SchemaException("Schema must contain an [elements] table");
        }
        for (String key : schema.keySet()) {
            if (!TOP_LEVEL_KEYS.contains(key)) {
                throw new SchemaException("Unsupported top-level schema key: " + key);
            }
        }
        TomlTable metadata = schema.getTable("toml-schema");
        if (metadata == null || !metadata.contains("version")) {
            throw new SchemaException("[toml-schema] must contain version");
        }
        String version = TomlSchemaVersion.validate(metadata.get("version")).value();
        for (String key : metadata.keySet()) {
            if (!key.equals("version") && !key.equals("meta")) {
                throw new SchemaException("Unsupported [toml-schema] key: " + key);
            }
        }
        return version;
    }

    private Map<String, SchemaDefinition> parseDefinitions(String prefix, TomlTable table, boolean required) {
        if (table == null) {
            if (required) {
                throw new SchemaException("Missing required [" + prefix + "] table");
            }
            return Map.of();
        }
        Map<String, SchemaDefinition> definitions = new LinkedHashMap<>();
        for (String key : table.keySet()) {
            if (prefix.equals("types") && SchemaType.fromSchemaNameOptional(key).isPresent()) {
                throw new SchemaException("[types." + key + "] uses a reserved built-in type name");
            }
            if (!(table.get(List.of(key)) instanceof TomlTable definitionTable)) {
                throw new SchemaException("[" + prefix + "] entry must be a table: " + key);
            }
            definitions.put(key, parseDefinition(prefix + "." + key, definitionTable));
        }
        return definitions;
    }

    private SchemaDefinition parseDefinition(String name, TomlTable table) {
        if (getPropertyValue(table, "arraytype") != null) {
            throw new SchemaException(name + " contains unsupported property: arraytype");
        }
        String typeSelector = getString(table, "type");
        SchemaType type = typeSelector == null
                ? null
                : SchemaType.fromSchemaNameOptional(typeSelector).orElse(null);
        String normalizedReference = typeSelector != null && type == null
                ? normalizeReference(typeSelector)
                : null;
        if (normalizedReference != null) {
            for (String key : table.keySet()) {
                if (!NAMED_REFERENCE_KEYS.contains(key)) {
                    throw new SchemaException(name + " named type reference cannot define " + key);
                }
            }
        }
        String description = getString(table, "description");
        String itemReference = normalizeReference(getString(table, "itemtype"));
        List<String> items = getStringArrayValues(table, "items").stream().map(this::normalizeReference).toList();
        Boolean optional = getBoolean(table, "optional");
        Pattern pattern = getPattern(name, table, "pattern");
        Pattern keyPattern = getPattern(name, table, "keypattern");
        Integer minLength = getInteger(table, "minlength");
        Integer maxLength = getInteger(table, "maxlength");
        List<Object> allowedValues = getArrayValues(table, "allowedvalues");
        boolean hasOneOf = getPropertyValue(table, "oneof") != null;
        boolean hasAnyOf = getPropertyValue(table, "anyof") != null;
        List<String> oneOf = getStringArrayValues(table, "oneof");
        List<String> anyOf = getStringArrayValues(table, "anyof");
        if (hasOneOf && oneOf.isEmpty()) {
            throw new SchemaException(name + " oneof must contain at least one type reference");
        }
        if (hasAnyOf && anyOf.isEmpty()) {
            throw new SchemaException(name + " anyof must contain at least one type reference");
        }
        rejectBareCollectionReference(name, "itemtype", itemReference);
        rejectBareCollectionReferences(name, "items", items);
        validateAlternativeReferences(name, "oneof", oneOf);
        validateAlternativeReferences(name, "anyof", anyOf);
        if (typeSelector != null
                && type != SchemaType.COLLECTION
                && normalizeReference(typeSelector).equals(SchemaType.COLLECTION.schemaName())) {
            throw new SchemaException(name + " cannot use collection as a bare type reference");
        }
        int typeSelectors = (typeSelector == null ? 0 : 1)
                + (hasOneOf ? 1 : 0)
                + (hasAnyOf ? 1 : 0);
        if (typeSelectors > 1) {
            throw new SchemaException(name + " cannot define more than one of type, oneof, and anyof");
        }

        Map<String, SchemaDefinition> children = new LinkedHashMap<>();
        for (String key : table.keySet()) {
            Object value = table.get(List.of(key));
            if (value instanceof TomlTable childTable) {
                if (children.containsKey(key)) {
                    throw new SchemaException(name + " defines child " + key + " more than once");
                }
                children.put(key, parseDefinition(name + "." + key, childTable));
            } else if (!DEFINITION_KEYS.contains(key)) {
                throw new SchemaException(name + " contains unsupported property: " + key);
            }
        }
        if (hasOneOf || hasAnyOf) {
            for (String key : table.keySet()) {
                if (!UNION_KEYS.contains(key)) {
                    throw new SchemaException(name + " union cannot define " + key);
                }
            }
        }
        if (type == null && normalizedReference == null && !hasOneOf && !hasAnyOf) {
            if (children.isEmpty()) {
                throw new SchemaException(name + " must define type, oneof, anyof, or child definitions");
            }
            type = SchemaType.TABLE;
        }
        if (!children.isEmpty() && type != SchemaType.TABLE && type != SchemaType.COLLECTION) {
            throw new SchemaException(name + " can only define children when type is table or collection");
        }
        if (type != SchemaType.ARRAY && type != SchemaType.COLLECTION && itemReference != null) {
            throw new SchemaException(name + " can only define itemtype when type is array or collection");
        }
        if (type != SchemaType.ARRAY && !items.isEmpty()) {
            throw new SchemaException(name + " can only define items when type is array");
        }
        if (!items.isEmpty()) {
            if (itemReference != null) {
                throw new SchemaException(name + " cannot define both items and itemtype");
            }
            if (minLength != null || maxLength != null) {
                throw new SchemaException(name + " cannot define minlength or maxlength together with items");
            }
        }
        if (minLength != null && maxLength != null && minLength > maxLength) {
            throw new SchemaException(name + " minlength must not be greater than maxlength");
        }
        if (keyPattern != null && type != SchemaType.COLLECTION) {
            throw new SchemaException(name + " can only define keypattern when type is collection");
        }
        if (pattern != null && type != SchemaType.STRING) {
            throw new SchemaException(name + " can only define pattern when type is string");
        }
        if ((minLength != null || maxLength != null)
                && type != SchemaType.STRING
                && type != SchemaType.ARRAY
                && type != SchemaType.COLLECTION) {
            throw new SchemaException(name
                    + " can only define minlength or maxlength when type is string, array, or collection");
        }
        if (type == SchemaType.COLLECTION && itemReference == null) {
            throw new SchemaException(name + " must define itemtype when type is collection");
        }
        Object min = getPropertyValue(table, "min");
        Object max = getPropertyValue(table, "max");
        validateRangeConstraints(name, type, itemReference, min, max);
        validateAllowedValuesConstraints(name, type, allowedValues, pattern, min, max, minLength, maxLength);
        return new SchemaDefinition(
                name,
                type,
                normalizedReference,
                description,
                itemReference,
                items,
                optional != null && optional,
                allowedValues,
                pattern,
                keyPattern,
                min,
                max,
                minLength,
                maxLength,
                oneOf.stream().map(this::normalizeReference).toList(),
                anyOf.stream().map(this::normalizeReference).toList(),
                children
        );
    }

    private void validateReferences(
            Map<String, SchemaDefinition> types,
            Map<String, SchemaDefinition> definitions
    ) {
        for (SchemaDefinition definition : definitions.values()) {
            validateReference(types, definition.name(), definition.reference());
            validateReference(types, definition.name(), definition.itemReference());
            for (String reference : definition.items()) {
                validateReference(types, definition.name(), reference);
            }
            for (String reference : definition.oneOf()) {
                validateReference(types, definition.name(), reference);
            }
            for (String reference : definition.anyOf()) {
                validateReference(types, definition.name(), reference);
            }
            validateReferences(types, definition.children());
        }
    }

    private void validateReference(
            Map<String, SchemaDefinition> types,
            String definitionName,
            String reference
    ) {
        if (reference == null || SchemaType.fromSchemaNameOptional(reference).isPresent()) {
            return;
        }
        if (!types.containsKey(reference)) {
            throw new SchemaException(definitionName + " contains unknown type reference: " + reference);
        }
    }

    private void validateSelectorCycles(Map<String, SchemaDefinition> types) {
        Set<String> visited = new HashSet<>();
        for (String typeName : types.keySet()) {
            validateSelectorCycle(typeName, types, new HashSet<>(), visited);
        }
    }

    private void validateSelectorCycle(
            String typeName,
            Map<String, SchemaDefinition> types,
            Set<String> visiting,
            Set<String> visited
    ) {
        if (SchemaType.fromSchemaNameOptional(typeName).isPresent() || visited.contains(typeName)) {
            return;
        }
        if (!visiting.add(typeName)) {
            throw new SchemaException("Cyclic type selector reference involving types." + typeName);
        }
        SchemaDefinition definition = types.get(typeName);
        if (definition == null) {
            return;
        }
        if (definition.reference() != null) {
            validateSelectorCycle(definition.reference(), types, visiting, visited);
        }
        for (String reference : definition.oneOf()) {
            validateSelectorCycle(reference, types, visiting, visited);
        }
        for (String reference : definition.anyOf()) {
            validateSelectorCycle(reference, types, visiting, visited);
        }
        visiting.remove(typeName);
        visited.add(typeName);
    }

    private void rejectBareCollectionReferences(String name, String property, List<String> references) {
        for (String reference : references) {
            rejectBareCollectionReference(name, property, normalizeReference(reference));
        }
    }

    private void rejectBareCollectionReference(String name, String property, String reference) {
        if (SchemaType.COLLECTION.schemaName().equals(reference)) {
            throw new SchemaException(name + " cannot use collection as a bare " + property + " reference");
        }
    }

    private void validateAlternativeReferences(String name, String property, List<String> references) {
        for (String reference : references) {
            String normalizedReference = normalizeReference(reference);
            rejectBareCollectionReference(name, property, normalizedReference);
            if (SchemaType.ANY.schemaName().equals(normalizedReference)) {
                throw new SchemaException(name + " cannot use any directly in " + property);
            }
        }
    }

    private Object getPropertyValue(TomlTable table, String key) {
        Object value = table.get(key);
        return value instanceof TomlTable ? null : value;
    }

    private String getString(TomlTable table, String key) {
        Object value = getPropertyValue(table, key);
        if (value == null) {
            return null;
        }
        if (!(value instanceof String stringValue)) {
            throw new SchemaException("Expected " + key + " to be a string");
        }
        return stringValue;
    }

    private Boolean getBoolean(TomlTable table, String key) {
        Object value = getPropertyValue(table, key);
        if (value == null) {
            return null;
        }
        if (!(value instanceof Boolean booleanValue)) {
            throw new SchemaException("Expected " + key + " to be a boolean");
        }
        return booleanValue;
    }

    private Integer getInteger(TomlTable table, String key) {
        Object value = getPropertyValue(table, key);
        if (value == null) {
            return null;
        }
        if (!(value instanceof Long longValue)) {
            throw new SchemaException("Expected " + key + " to be an integer");
        }
        if (longValue < 0 || longValue > Integer.MAX_VALUE) {
            throw new SchemaException(key + " must be between 0 and " + Integer.MAX_VALUE);
        }
        return longValue.intValue();
    }

    private Pattern getPattern(String definitionName, TomlTable table, String key) {
        String pattern = getString(table, key);
        if (pattern == null) {
            return null;
        }
        try {
            return Pattern.compile(toJavaPattern(pattern));
        } catch (PatternSyntaxException e) {
            throw new SchemaException(definitionName + " has invalid " + key + ": " + pattern, e);
        }
    }

    private String toJavaPattern(String pattern) {
        StringBuilder translated = new StringBuilder(pattern.length());
        boolean escaped = false;
        boolean inCharacterClass = false;
        for (int index = 0; index < pattern.length(); index++) {
            char current = pattern.charAt(index);
            if (escaped) {
                translated.append(current);
                escaped = false;
            } else if (current == '\\') {
                translated.append(current);
                escaped = true;
            } else if (current == '[') {
                translated.append(current);
                inCharacterClass = true;
            } else if (current == ']' && inCharacterClass) {
                translated.append(current);
                inCharacterClass = false;
            } else if (current == '$' && !inCharacterClass) {
                translated.append("\\z");
            } else {
                translated.append(current);
            }
        }
        return translated.toString();
    }

    private List<Object> getArrayValues(TomlTable table, String key) {
        Object value = getPropertyValue(table, key);
        if (value == null) {
            return List.of();
        }
        if (!(value instanceof TomlArray array)) {
            throw new SchemaException("Expected " + key + " to be an array");
        }
        List<Object> values = new ArrayList<>();
        for (int i = 0; i < array.size(); i++) {
            values.add(array.get(i));
        }
        return values;
    }

    private List<String> getStringArrayValues(TomlTable table, String key) {
        List<Object> values = getArrayValues(table, key);
        List<String> strings = new ArrayList<>();
        for (Object value : values) {
            if (!(value instanceof String stringValue)) {
                throw new SchemaException("Expected " + key + " to contain only strings");
            }
            strings.add(stringValue);
        }
        return strings;
    }

    private void validateRangeConstraints(String name, SchemaType type, String itemReference, Object min, Object max) {
        if (min == null && max == null) {
            return;
        }
        validateRangeBoundary(name, "min", min);
        validateRangeBoundary(name, "max", max);
        rejectNaNBoundary(name, "min", min);
        rejectNaNBoundary(name, "max", max);
        if (type == SchemaType.ANY) {
            throw new SchemaException(name + " cannot define min or max when type is any");
        }
        if (type == SchemaType.ARRAY) {
            if (itemReference == null) {
                throw new SchemaException(name + " can only define min or max when itemtype resolves to one comparable built-in type");
            }
            return;
        }
        if (type != null && !isRangeComparable(type)) {
            throw new SchemaException(name + " can only define min or max for integer, float, date/time, or compatible array types");
        }
        if (type != null) {
            validateBoundaryMatchesType(name, "min", min, type);
            validateBoundaryMatchesType(name, "max", max, type);
        }
    }

    private void validateArrayRangeConstraints(
            Map<String, SchemaDefinition> types,
            Map<String, SchemaDefinition> definitions
    ) {
        for (SchemaDefinition definition : definitions.values()) {
            if (definition.type() == SchemaType.ARRAY && (definition.min() != null || definition.max() != null)) {
                Set<SchemaType> itemTypes = resolveItemTypes(definition.itemReference(), types, new HashSet<>());
                if (itemTypes.size() != 1 || !isRangeComparable(itemTypes.iterator().next())) {
                    throw new SchemaException(definition.name()
                            + " can only define min or max when itemtype resolves to one comparable built-in type");
                }
                SchemaType itemType = itemTypes.iterator().next();
                validateBoundaryMatchesType(definition.name(), "min", definition.min(), itemType);
                validateBoundaryMatchesType(definition.name(), "max", definition.max(), itemType);
            }
            validateArrayRangeConstraints(types, definition.children());
        }
    }

    private Set<SchemaType> resolveItemTypes(
            String reference,
            Map<String, SchemaDefinition> types,
            Set<String> seenReferences
    ) {
        SchemaType builtIn = SchemaType.fromSchemaNameOptional(reference).orElse(null);
        if (builtIn != null) {
            return Set.of(builtIn);
        }
        if (!seenReferences.add(reference)) {
            throw new SchemaException("Cyclic schema reference involving types." + reference);
        }
        SchemaDefinition definition = types.get(reference);
        if (definition == null) {
            throw new SchemaException("Unknown schema type reference: types." + reference);
        }
        if (definition.reference() != null) {
            return resolveItemTypes(definition.reference(), types, seenReferences);
        }
        List<String> alternatives = definition.oneOf().isEmpty() ? definition.anyOf() : definition.oneOf();
        if (!alternatives.isEmpty()) {
            Set<SchemaType> itemTypes = new HashSet<>();
            for (String alternative : alternatives) {
                itemTypes.addAll(resolveItemTypes(alternative, types, new HashSet<>(seenReferences)));
            }
            return itemTypes;
        }
        return Set.of(definition.type());
    }

    private void validateRangeBoundary(String name, String key, Object value) {
        if (value == null || isRangeBoundary(value)) {
            return;
        }
        throw new SchemaException(name + " " + key + " must be an integer, float, or temporal value");
    }

    private void rejectNaNBoundary(String name, String key, Object value) {
        if (value instanceof Double doubleValue && doubleValue.isNaN()) {
            throw new SchemaException(name + " cannot use NaN as " + key);
        }
    }

    private boolean isRangeBoundary(Object value) {
        return value instanceof Long
                || value instanceof Double
                || value instanceof OffsetDateTime
                || value instanceof LocalDateTime
                || value instanceof LocalDate
                || value instanceof LocalTime;
    }

    private boolean isRangeComparable(SchemaType type) {
        return switch (type) {
            case INTEGER, FLOAT, OFFSET_DATE_TIME, LOCAL_DATE_TIME, LOCAL_DATE, LOCAL_TIME -> true;
            default -> false;
        };
    }

    private void validateBoundaryMatchesType(String name, String key, Object value, SchemaType type) {
        if (value == null || boundaryMatchesType(value, type)) {
            return;
        }
        throw new SchemaException(name + " " + key + " must be comparable with " + type.schemaName());
    }

    private boolean boundaryMatchesType(Object value, SchemaType type) {
        return switch (type) {
            case INTEGER, FLOAT -> value instanceof Number;
            case OFFSET_DATE_TIME -> value instanceof OffsetDateTime;
            case LOCAL_DATE_TIME -> value instanceof LocalDateTime;
            case LOCAL_DATE -> value instanceof LocalDate;
            case LOCAL_TIME -> value instanceof LocalTime;
            default -> false;
        };
    }

    private void validateAllowedValuesConstraints(
            String name,
            SchemaType type,
            List<Object> allowedValues,
            Pattern pattern,
            Object min,
            Object max,
            Integer minLength,
            Integer maxLength
    ) {
        if (allowedValues.isEmpty() || type == SchemaType.ARRAY) {
            return;
        }
        for (int i = 0; i < allowedValues.size(); i++) {
            Object allowed = allowedValues.get(i);
            String entry = name + " allowedvalues[" + i + "]";
            if (pattern != null && (!(allowed instanceof String stringValue) || !pattern.matcher(stringValue).find())) {
                throw new SchemaException(entry + " does not satisfy pattern");
            }
            if ((min != null || max != null) && allowed instanceof Double doubleValue && doubleValue.isNaN()) {
                throw new SchemaException(entry + " does not satisfy min or max");
            }
            if (min != null && ValueSemantics.compare(allowed, min) < 0) {
                throw new SchemaException(entry + " is less than min");
            }
            if (max != null && ValueSemantics.compare(allowed, max) > 0) {
                throw new SchemaException(entry + " is greater than max");
            }
            if (minLength != null || maxLength != null) {
                if (!(allowed instanceof String stringValue)) {
                    throw new SchemaException(entry + " does not satisfy string length constraints");
                }
                int length = stringValue.codePointCount(0, stringValue.length());
                if (minLength != null && length < minLength) {
                    throw new SchemaException(entry + " is shorter than minlength");
                }
                if (maxLength != null && length > maxLength) {
                    throw new SchemaException(entry + " is longer than maxlength");
                }
            }
        }
    }

    private String normalizeReference(String reference) {
        if (reference == null) {
            return null;
        }
        return reference.startsWith("types.") ? reference.substring("types.".length()) : reference;
    }

    private String formatParseErrors(List<TomlParseError> errors) {
        return errors.stream().map(Object::toString).collect(Collectors.joining("; "));
    }
}
