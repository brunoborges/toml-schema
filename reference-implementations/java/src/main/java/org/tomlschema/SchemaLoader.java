package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseError;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.nio.file.Files;
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
            "type", "description", "itemtype", "items", "allowedvalues", "pattern", "format",
            "keypattern", "optional", "min", "max", "minlength", "maxlength",
            "oneof", "anyof", "dependentrequired", "mutuallyexclusive", "exactlyone",
            "if", "then", "else", "allof", "uniqueitems", "default", "deprecated"
    );
    private static final Set<String> NAMED_REFERENCE_KEYS = Set.of(
            "type", "description", "optional", "allof", "default", "deprecated");
    private static final Set<String> UNION_KEYS = Set.of(
            "oneof", "anyof", "description", "optional", "allof", "default", "deprecated");
    private static final Set<String> CONDITIONAL_KEYS = Set.of(
            "if", "then", "else", "description", "optional", "allof", "default", "deprecated");
    private List<String> sourceLines = List.of();

    TomlSchema load(Path schemaPath) {
        TomlParseResult parsed;
        try {
            sourceLines = Files.readAllLines(schemaPath);
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
        validateAllowedValueTypes(types, types);
        validateAllowedValueTypes(types, elements);
        validateArrayRangeConstraints(types, types);
        validateArrayRangeConstraints(types, elements);
        validateDefinitionSemantics(types, types);
        validateDefinitionSemantics(types, elements);
        TomlSchema schema = new TomlSchema(schemaPath, version, types, elements);
        validateDefaults(schema, types);
        validateDefaults(schema, elements);
        return schema;
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
            if (prefix.equals("types") && key.startsWith("types.")) {
                throw new SchemaException("[types." + key + "] uses the reserved type-reference prefix");
            }
            if (!(table.get(List.of(key)) instanceof TomlTable definitionTable)) {
                throw new SchemaException("[" + prefix + "] entry must be a table: " + key);
            }
            definitions.put(key, parseDefinition(prefix + "." + key, definitionTable));
        }
        return definitions;
    }

    private SchemaDefinition parseDefinition(String name, TomlTable table) {
        String typeSelector = getString(table, "type");
        String normalizedTypeSelector = normalizeReference(typeSelector);
        SchemaType type = typeSelector == null
                ? null
                : SchemaType.fromSchemaNameOptional(normalizedTypeSelector).orElse(null);
        String normalizedReference = typeSelector != null && type == null
                ? normalizedTypeSelector
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
        boolean hasItems = getPropertyValue(table, "items") != null;
        List<String> items = getStringArrayValues(table, "items").stream().map(this::normalizeReference).toList();
        if (hasItems && items.isEmpty()) {
            throw new SchemaException(name + " items must contain at least one type reference");
        }
        Boolean optional = getBoolean(table, "optional");
        Pattern pattern = getPattern(name, table, "pattern");
        String formatName = getString(table, "format");
        SchemaStringFormat format = formatName == null
                ? null : SchemaStringFormat.fromSchemaName(formatName);
        Pattern keyPattern = getPattern(name, table, "keypattern");
        Integer minLength = getInteger(table, "minlength");
        Integer maxLength = getInteger(table, "maxlength");
        boolean hasAllowedValues = getPropertyValue(table, "allowedvalues") != null;
        List<Object> allowedValues = getArrayValues(table, "allowedvalues");
        if (hasAllowedValues && allowedValues.isEmpty()) {
            throw new SchemaException(name + " allowedvalues must contain at least one entry");
        }
        boolean hasOneOf = getPropertyValue(table, "oneof") != null;
        boolean hasAnyOf = getPropertyValue(table, "anyof") != null;
        boolean hasConditionalKeyword = isProperty(table, "if")
                || isProperty(table, "then")
                || isProperty(table, "else");
        List<String> oneOf = getStringArrayValues(table, "oneof");
        List<String> anyOf = getStringArrayValues(table, "anyof");
        ConditionalParts conditional = hasConditionalKeyword ? getConditional(name, table) : null;
        boolean hasAllOf = getPropertyValue(table, "allof") != null;
        List<String> allOf = getStringArrayValues(table, "allof");
        if (hasAllOf && allOf.isEmpty()) {
            throw new SchemaException(name + " allof must contain at least one type reference");
        }
        validateAlternativeReferences(name, "allof", allOf);
        Map<String, List<String>> dependentRequired = getDependentRequired(name, table);
        List<List<String>> mutuallyExclusive = getNameGroups(name, table, "mutuallyexclusive");
        List<List<String>> exactlyOne = getNameGroups(name, table, "exactlyone");
        Boolean uniqueItems = getBoolean(table, "uniqueitems");
        boolean hasDefault = isProperty(table, "default");
        Object defaultValue = hasDefault ? table.get(List.of("default")) : null;
        if (conditional != null && hasDefault && !(defaultValue instanceof TomlTable)) {
            throw new SchemaException(name + " conditional default must be a table");
        }
        Boolean deprecated = getBoolean(table, "deprecated");
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
                + (hasAnyOf ? 1 : 0)
                + (conditional == null ? 0 : 1);
        if (typeSelectors > 1) {
            throw new SchemaException(
                    name + " cannot define more than one of type, oneof, anyof, and if/then/else");
        }

        Map<String, SchemaDefinition> children = new LinkedHashMap<>();
        TomlTable escapedChildren = table.getTable("children");
        boolean hasEscapedChildren = escapedChildren != null
                && !isProperty(table, "children")
                && !hasDefinitionMarker(escapedChildren);
        if (hasEscapedChildren) {
            if (escapedChildren.keySet().isEmpty()) {
                throw new SchemaException(name + ".children must contain at least one escaped child");
            }
            for (String key : escapedChildren.keySet()) {
                if (!DEFINITION_KEYS.contains(key) && !key.equals("children")) {
                    throw new SchemaException(
                            name + ".children may only contain schema-key conflicts, found: " + key);
                }
                Object value = escapedChildren.get(List.of(key));
                if (!(value instanceof TomlTable childTable)) {
                    throw new SchemaException(name + ".children." + key + " must be a table");
                }
                children.put(key, parseDefinition(name + "." + key, childTable));
            }
        }
        for (String key : table.keySet()) {
            Object value = table.get(List.of(key));
            if (key.equals("children") && hasEscapedChildren) {
                continue;
            }
            if (DEFINITION_KEYS.contains(key)
                    && isProperty(table, key)) {
                continue;
            }
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
        if (conditional != null) {
            for (String key : table.keySet()) {
                if (!CONDITIONAL_KEYS.contains(key)) {
                    throw new SchemaException(name + " conditional cannot define " + key);
                }
            }
        }
        if (type == null && normalizedReference == null && !hasOneOf && !hasAnyOf
                && conditional == null) {
            if (children.isEmpty()) {
                throw new SchemaException(
                        name + " must define type, oneof, anyof, if/then/else, or child definitions");
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
            if (hasAllowedValues) {
                throw new SchemaException(name + " cannot define allowedvalues together with items");
            }
            if (getPropertyValue(table, "min") != null || getPropertyValue(table, "max") != null) {
                throw new SchemaException(name + " cannot define min or max together with items");
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
        if (format != null && type != SchemaType.STRING) {
            throw new SchemaException(name + " can only define format when type is string");
        }
        if (hasAllowedValues && (type == SchemaType.TABLE || type == SchemaType.COLLECTION)) {
            throw new SchemaException(name + " can only define allowedvalues for scalar, unconstrained, or array types");
        }
        if ((minLength != null || maxLength != null)
                && type != SchemaType.STRING
                && type != SchemaType.ARRAY
                && type != SchemaType.COLLECTION) {
            throw new SchemaException(name
                    + " can only define minlength or maxlength when type is string, array, or collection");
        }
        if (type == SchemaType.COLLECTION && itemReference == null && allOf.isEmpty()) {
            throw new SchemaException(name + " must define itemtype when type is collection");
        }
        Object min = getPropertyValue(table, "min");
        Object max = getPropertyValue(table, "max");
        validateRangeConstraints(name, type, itemReference, min, max);
        validateAllowedValuesConstraints(
                name, type, allowedValues, pattern, format, min, max, minLength, maxLength);
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
                format,
                keyPattern,
                min,
                max,
                minLength,
                maxLength,
                oneOf.stream().map(this::normalizeReference).toList(),
                anyOf.stream().map(this::normalizeReference).toList(),
                conditional == null ? null : conditional.condition(),
                conditional == null ? null : conditional.thenReference(),
                conditional == null ? null : conditional.elseReference(),
                allOf.stream().map(this::normalizeReference).toList(),
                dependentRequired,
                mutuallyExclusive,
                exactlyOne,
                uniqueItems,
                hasDefault,
                defaultValue,
                deprecated != null && deprecated,
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
            validateReference(types, definition.name(), definition.thenReference());
            validateReference(types, definition.name(), definition.elseReference());
            for (String reference : definition.allOf()) {
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
        if (definition.condition() != null) {
            validateSelectorCycle(definition.thenReference(), types, visiting, visited);
            validateSelectorCycle(definition.elseReference(), types, visiting, visited);
        }
        for (String reference : definition.allOf()) {
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
        Map<String, String> seen = new LinkedHashMap<>();
        for (String reference : references) {
            String normalizedReference = normalizeReference(reference);
            rejectBareCollectionReference(name, property, normalizedReference);
            if (SchemaType.ANY.schemaName().equals(normalizedReference)) {
                throw new SchemaException(name + " cannot use any directly in " + property);
            }
            String first = seen.putIfAbsent(normalizedReference, reference);
            if (first != null) {
                throw new SchemaException(name + " " + property
                        + " contains duplicate type references \"" + first + "\" and \"" + reference
                        + "\"; both resolve to " + normalizedReference);
            }
        }
    }

    private ConditionalParts getConditional(String name, TomlTable table) {
        if (!isProperty(table, "if")
                || !isProperty(table, "then")
                || !isProperty(table, "else")) {
            throw new SchemaException(name + " must define if, then, and else together");
        }
        if (!(table.get(List.of("if")) instanceof TomlTable conditionTable)) {
            throw new SchemaException(name + " if must be an inline table");
        }
        for (String key : conditionTable.keySet()) {
            if (!Set.of("key", "equals", "in").contains(key)) {
                throw new SchemaException(name + " if contains unsupported property: " + key);
            }
        }
        String key = getString(conditionTable, "key");
        if (key == null) {
            throw new SchemaException(name + " if.key must be a string");
        }
        boolean hasEquals = conditionTable.contains(List.of("equals"));
        boolean hasIn = conditionTable.contains(List.of("in"));
        if (hasEquals == hasIn) {
            throw new SchemaException(name + " if must define exactly one of equals and in");
        }
        Object equalsValue = hasEquals ? conditionTable.get(List.of("equals")) : null;
        List<Object> inValues = hasIn ? getArrayValues(conditionTable, "in") : List.of();
        if (hasIn && inValues.isEmpty()) {
            throw new SchemaException(name + " if.in must contain at least one value");
        }
        String thenReference = requiredConditionalReference(name, table, "then");
        String elseReference = requiredConditionalReference(name, table, "else");
        return new ConditionalParts(
                new SchemaCondition(key, hasEquals, equalsValue, inValues),
                thenReference,
                elseReference);
    }

    private String requiredConditionalReference(String name, TomlTable table, String key) {
        if (!isProperty(table, key)) {
            throw new SchemaException(name + " " + key + " must be a named reusable type reference");
        }
        String reference = getString(table, key);
        String normalized = normalizeReference(reference);
        if (normalized.isEmpty() || SchemaType.fromSchemaNameOptional(normalized).isPresent()) {
            throw new SchemaException(name + " " + key + " must be a named reusable type reference");
        }
        return normalized;
    }

    private record ConditionalParts(
            SchemaCondition condition,
            String thenReference,
            String elseReference
    ) {
    }

    private Map<String, List<String>> getDependentRequired(String name, TomlTable table) {
    if (!isProperty(table, "dependentrequired")) {
        return Map.of();
    }
    Object value = table.get(List.of("dependentrequired"));
    if (!(value instanceof TomlTable dependencies)) {
        throw new SchemaException(name + " dependentrequired must be an inline table");
    }
    if (dependencies.isEmpty()) {
        throw new SchemaException(name + " dependentrequired must not be empty");
    }
    Map<String, List<String>> result = new LinkedHashMap<>();
    for (String trigger : dependencies.keySet()) {
        Object requiredValue = dependencies.get(List.of(trigger));
        if (!(requiredValue instanceof TomlArray requiredArray)) {
            throw new SchemaException(name + " dependentrequired." + trigger + " must be an array");
        }
        List<String> required = stringValues(name + " dependentrequired." + trigger, requiredArray);
        if (required.isEmpty()) {
            throw new SchemaException(name + " dependentrequired." + trigger + " must not be empty");
        }
        rejectDuplicates(name + " dependentrequired." + trigger, required);
        result.put(trigger, required);
    }
    return result;
    }

    private List<List<String>> getNameGroups(String name, TomlTable table, String key) {
    if (!isProperty(table, key)) {
        return List.of();
    }
    Object value = table.get(List.of(key));
    if (!(value instanceof TomlArray groups)) {
        throw new SchemaException(name + " " + key + " must be an array");
    }
    if (groups.isEmpty()) {
        throw new SchemaException(name + " " + key + " must not be empty");
    }
    List<List<String>> result = new ArrayList<>();
    for (int i = 0; i < groups.size(); i++) {
        Object groupValue = groups.get(i);
        if (!(groupValue instanceof TomlArray groupArray)) {
            throw new SchemaException(name + " " + key + "[" + i + "] must be an array");
        }
        List<String> group = stringValues(name + " " + key + "[" + i + "]", groupArray);
        if (group.size() < 2) {
            throw new SchemaException(name + " " + key + "[" + i + "] must contain at least two names");
        }
        rejectDuplicates(name + " " + key + "[" + i + "]", group);
        result.add(group);
    }
    return result;
    }

    private List<String> stringValues(String property, TomlArray array) {
    List<String> result = new ArrayList<>();
    for (int i = 0; i < array.size(); i++) {
        if (!(array.get(i) instanceof String stringValue)) {
            throw new SchemaException(property + " must contain only strings");
        }
        result.add(stringValue);
    }
    return result;
    }

    private void rejectDuplicates(String property, List<String> values) {
    if (new HashSet<>(values).size() != values.size()) {
        throw new SchemaException(property + " must contain unique names");
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
        validatePortablePattern(definitionName, key, pattern);
        try {
            return Pattern.compile(toJavaPattern(pattern));
        } catch (PatternSyntaxException e) {
            throw new SchemaException(
                    "invalid-pattern: " + definitionName + " has invalid " + key + ": " + pattern, e);
        }
    }

    private void validatePortablePattern(String definitionName, String key, String pattern) {
        boolean inCharacterClass = false;
        for (int index = 0; index < pattern.length(); index++) {
            char current = pattern.charAt(index);
            if (current == '\\' && index + 1 < pattern.length()) {
                char escaped = pattern.charAt(index + 1);
                if ("\\.^$*+?()[]{}|-tnrfva".indexOf(escaped) < 0) {
                    throw new SchemaException("unsupported-pattern: " + definitionName + " " + key
                            + " uses non-portable escape \\" + escaped);
                }
                index++;
            } else if (current == '[') {
                inCharacterClass = true;
            } else if (current == ']') {
                inCharacterClass = false;
            } else if (!inCharacterClass && current == '(' && index + 1 < pattern.length()
                    && pattern.charAt(index + 1) == '?'
                    && (index + 2 >= pattern.length() || pattern.charAt(index + 2) != ':')) {
                throw new SchemaException("unsupported-pattern: " + definitionName + " " + key
                        + " uses non-portable group syntax");
            } else if (!inCharacterClass && "?*+}".indexOf(current) >= 0 && index + 1 < pattern.length()
                    && "?+".indexOf(pattern.charAt(index + 1)) >= 0) {
                throw new SchemaException("unsupported-pattern: " + definitionName + " " + key
                        + " uses a non-greedy or possessive quantifier");
            }
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
            validateOrderedRange(name, min, max, type);
        }
    }

    private void validateOrderedRange(String name, Object min, Object max, SchemaType comparableKind) {
        if (comparableKind == SchemaType.INTEGER) {
            if (min instanceof Double value && value.isInfinite()) {
                throw new SchemaException(name + " cannot use infinity as min when comparable kind is integer");
            }
            if (max instanceof Double value && value.isInfinite()) {
                throw new SchemaException(name + " cannot use infinity as max when comparable kind is integer");
            }
        }
        if (min != null && max != null && ValueSemantics.compare(min, max) > 0) {
            throw new SchemaException(name + " min must not be greater than max");
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
                validateOrderedRange(definition.name(), definition.min(), definition.max(), itemType);
            }
            validateArrayRangeConstraints(types, definition.children());
        }
    }

    private void validateAllowedValueTypes(
            Map<String, SchemaDefinition> types,
            Map<String, SchemaDefinition> definitions
    ) {
        for (SchemaDefinition definition : definitions.values()) {
            Set<SchemaType> permittedTypes = Set.of();
            if (!definition.allowedValues().isEmpty()) {
                if (definition.type() == SchemaType.ARRAY && definition.itemReference() != null) {
                    permittedTypes = resolveItemTypes(definition.itemReference(), types, new HashSet<>());
                } else if (definition.type() != SchemaType.ARRAY) {
                    permittedTypes = Set.of(definition.type());
                }
                for (int index = 0; index < definition.allowedValues().size(); index++) {
                    Object value = definition.allowedValues().get(index);
                    if (!permittedTypes.isEmpty()
                            && permittedTypes.stream().noneMatch(type -> valueMatchesType(value, type))) {
                        throw new SchemaException(definition.name() + " allowedvalues[" + index
                                + "] does not match the permitted TOML type");
                    }
                }
            }
            validateAllowedValueTypes(types, definition.children());
        }
    }

    private boolean valueMatchesType(Object value, SchemaType type) {
        return switch (type) {
            case ANY -> true;
            case STRING -> value instanceof String;
            case INTEGER -> value instanceof Long;
            case FLOAT -> value instanceof Double;
            case BOOLEAN -> value instanceof Boolean;
            case OFFSET_DATE_TIME -> value instanceof OffsetDateTime;
            case LOCAL_DATE_TIME -> value instanceof LocalDateTime;
            case LOCAL_DATE -> value instanceof LocalDate;
            case LOCAL_TIME -> value instanceof LocalTime;
            case ARRAY -> value instanceof TomlArray;
            case TABLE, COLLECTION -> value instanceof TomlTable;
        };
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
        if (definition.condition() != null) {
            Set<SchemaType> itemTypes = new HashSet<>();
            itemTypes.addAll(resolveItemTypes(
                    definition.thenReference(), types, new HashSet<>(seenReferences)));
            itemTypes.addAll(resolveItemTypes(
                    definition.elseReference(), types, new HashSet<>(seenReferences)));
            return itemTypes;
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
            SchemaStringFormat format,
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
            if (format != null && (!(allowed instanceof String stringValue) || !format.isValid(stringValue))) {
                throw new SchemaException(entry + " does not satisfy format " + format.schemaName());
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

    private boolean isProperty(TomlTable table, String key) {
        if (!table.contains(List.of(key))) {
            return false;
        }
        Object value = table.get(List.of(key));
        if (!(value instanceof TomlTable)) {
            return true;
        }
        var position = table.inputPositionOf(List.of(key));
        if (position == null || position.line() < 1 || position.line() > sourceLines.size()) {
            return false;
        }
        String line = sourceLines.get(position.line() - 1);
        int index = position.column() - 1;
        if (index < 0 || index >= line.length() || line.charAt(index) == '[') {
            return false;
        }
        int equals = line.indexOf('=', index);
        if (equals < 0) {
            return false;
        }
        int valueStart = equals + 1;
        while (valueStart < line.length() && Character.isWhitespace(line.charAt(valueStart))) {
            valueStart++;
        }
        return valueStart < line.length() && line.charAt(valueStart) == '{';
    }

    private boolean hasDefinitionMarker(TomlTable table) {
        return isProperty(table, "type")
                || isProperty(table, "oneof")
                || isProperty(table, "anyof")
                || isProperty(table, "if");
    }

    private void validateDefinitionSemantics(
            Map<String, SchemaDefinition> types,
            Map<String, SchemaDefinition> definitions
    ) {
        for (SchemaDefinition definition : definitions.values()) {
            Set<SchemaType> kinds = effectiveKinds(definition, types, new HashSet<>());
            if (!definition.allOf().isEmpty() && kinds.size() != 1) {
                throw new SchemaException(definition.name() + " allof components must resolve to one compatible kind");
            }
            boolean hasPresenceRules = !definition.dependentRequired().isEmpty()
                    || !definition.mutuallyExclusive().isEmpty()
                    || !definition.exactlyOne().isEmpty();
            if (hasPresenceRules && kinds.stream().anyMatch(kind ->
                    kind != SchemaType.TABLE && kind != SchemaType.COLLECTION)) {
                throw new SchemaException(definition.name()
                        + " presence rules require an effective table or collection");
            }
            if (definition.uniqueItems() != null
                    && (kinds.size() != 1 || !kinds.contains(SchemaType.ARRAY))) {
                throw new SchemaException(definition.name() + " uniqueitems requires an effective array");
            }
            if (kinds.size() == 1 && kinds.contains(SchemaType.COLLECTION)
                    && !hasCollectionItemConstraint(definition, types, new HashSet<>())) {
                throw new SchemaException(definition.name()
                        + " effective collection must define at least one itemtype");
            }
            if (hasPresenceRules) {
                Set<String> fixedChildren = determinateFixedChildren(definition, types, new HashSet<>());
                validateRuleNames(definition, fixedChildren);
            }
            if (definition.condition() != null) {
                for (Map.Entry<String, String> branchEntry : Map.of(
                        "then", definition.thenReference(),
                        "else", definition.elseReference()).entrySet()) {
                    SchemaDefinition branch = referenceDefinition(branchEntry.getValue(), types);
                    Set<SchemaType> branchKinds = effectiveKinds(branch, types, new HashSet<>());
                    if (branchKinds.size() == 1 && branchKinds.contains(SchemaType.COLLECTION)) {
                        continue;
                    }
                    Set<String> fixedChildren =
                            determinateFixedChildren(branch, types, new HashSet<>());
                    if (!fixedChildren.isEmpty()
                            && !fixedChildren.contains(definition.condition().key())) {
                        throw new SchemaException(definition.name() + " " + branchEntry.getKey()
                                + " branch has a non-empty determinate fixed-child set that omits discriminator "
                                + definition.condition().key());
                    }
                }
            }
            validateDefinitionSemantics(types, definition.children());
        }
    }

    private Set<SchemaType> effectiveKinds(
            SchemaDefinition definition,
            Map<String, SchemaDefinition> types,
            Set<String> visiting
    ) {
        Set<SchemaType> localKinds = new HashSet<>();
        if (definition.reference() != null) {
            localKinds.addAll(effectiveKinds(referenceDefinition(definition.reference(), types), types,
                    addVisit(definition.reference(), visiting)));
        } else if (definition.condition() != null) {
            Set<SchemaType> thenKinds = effectiveKinds(
                    referenceDefinition(definition.thenReference(), types), types,
                    addVisit(definition.thenReference(), visiting));
            Set<SchemaType> elseKinds = effectiveKinds(
                    referenceDefinition(definition.elseReference(), types), types,
                    addVisit(definition.elseReference(), visiting));
            if (thenKinds.size() != 1 || !thenKinds.equals(elseKinds)) {
                throw new SchemaException(definition.name()
                        + " conditional branches must resolve to compatible effective TOML kinds");
            }
            SchemaType kind = thenKinds.iterator().next();
            if (kind != SchemaType.TABLE && kind != SchemaType.COLLECTION) {
                throw new SchemaException(definition.name()
                        + " conditional branches must resolve to table or collection");
            }
            localKinds.add(kind);
        } else if (!definition.oneOf().isEmpty() || !definition.anyOf().isEmpty()) {
            List<String> alternatives = definition.oneOf().isEmpty() ? definition.anyOf() : definition.oneOf();
            for (String alternative : alternatives) {
                localKinds.addAll(effectiveKinds(referenceDefinition(alternative, types), types,
                        new HashSet<>(visiting)));
            }
        } else if (definition.type() != null) {
            localKinds.add(definition.type());
        }
        for (String reference : definition.allOf()) {
            Set<SchemaType> componentKinds = effectiveKinds(referenceDefinition(reference, types), types,
                    addVisit(reference, visiting));
            if (localKinds.size() != 1 || componentKinds.size() != 1
                    || !localKinds.equals(componentKinds)) {
                throw new SchemaException(definition.name()
                        + " allof components must resolve to compatible effective TOML kinds");
            }
        }
        return localKinds;
    }

    private Set<String> determinateFixedChildren(
            SchemaDefinition definition,
            Map<String, SchemaDefinition> types,
            Set<String> visiting
    ) {
        Set<String> children = new HashSet<>(definition.children().keySet());
        if (definition.reference() != null) {
            children.addAll(determinateReferenceFixedChildren(definition.reference(), types, visiting));
        }
        for (String component : definition.allOf()) {
            children.addAll(determinateReferenceFixedChildren(component, types, visiting));
        }
        return children;
    }

    private Set<String> determinateReferenceFixedChildren(
            String reference,
            Map<String, SchemaDefinition> types,
            Set<String> visiting
    ) {
        if (SchemaType.fromSchemaNameOptional(reference).isPresent()) {
            return Set.of();
        }
        SchemaDefinition target = referenceDefinition(reference, types);
        return determinateFixedChildren(target, types, addVisit(reference, visiting));
    }

    private boolean hasCollectionItemConstraint(
            SchemaDefinition definition,
            Map<String, SchemaDefinition> types,
            Set<String> visiting
    ) {
        if (definition.condition() != null || !definition.oneOf().isEmpty() || !definition.anyOf().isEmpty()) {
            return true;
        }
        if (definition.itemReference() != null) {
            return true;
        }
        if (definition.reference() != null) {
            SchemaDefinition target = referenceDefinition(definition.reference(), types);
            if (hasCollectionItemConstraint(
                    target, types, addVisit(definition.reference(), visiting))) {
                return true;
            }
        }
        for (String component : definition.allOf()) {
            SchemaDefinition target = referenceDefinition(component, types);
            if (target.condition() == null && target.oneOf().isEmpty() && target.anyOf().isEmpty()
                    && hasCollectionItemConstraint(target, types, addVisit(component, visiting))) {
                return true;
            }
        }
        return false;
    }

    private SchemaDefinition referenceDefinition(String reference, Map<String, SchemaDefinition> types) {
        SchemaType builtIn = SchemaType.fromSchemaNameOptional(reference).orElse(null);
        if (builtIn != null) {
            return builtInDefinition(reference, builtIn);
        }
        SchemaDefinition definition = types.get(reference);
        if (definition == null) {
            throw new SchemaException("Unknown schema type reference: types." + reference);
        }
        return definition;
    }

    private Set<String> addVisit(String reference, Set<String> visiting) {
        Set<String> next = new HashSet<>(visiting);
        if (SchemaType.fromSchemaNameOptional(reference).isEmpty() && !next.add(reference)) {
            throw new SchemaException("Cyclic schema reference involving types." + reference);
        }
        return next;
    }

    private SchemaDefinition builtInDefinition(String name, SchemaType type) {
        return new SchemaDefinition(name, type, null, null, null, List.of(), false,
                List.of(), null, null, null, null, null, null, null, List.of(), List.of(),
                null, null, null, List.of(), Map.of(), List.of(), List.of(), null,
                false, null, false, Map.of());
    }

    private void validateRuleNames(SchemaDefinition definition, Set<String> fixedChildren) {
        for (Map.Entry<String, List<String>> entry : definition.dependentRequired().entrySet()) {
            requireFixedChild(definition.name(), "dependentrequired", entry.getKey(), fixedChildren);
            for (String required : entry.getValue()) {
                requireFixedChild(definition.name(), "dependentrequired", required, fixedChildren);
            }
        }
        for (List<String> group : definition.mutuallyExclusive()) {
            for (String operand : group) {
                requireFixedChild(definition.name(), "mutuallyexclusive", operand, fixedChildren);
            }
        }
        for (List<String> group : definition.exactlyOne()) {
            for (String operand : group) {
                requireFixedChild(definition.name(), "exactlyone", operand, fixedChildren);
            }
        }
    }

    private void requireFixedChild(String name, String property, String operand, Set<String> fixedChildren) {
        if (!fixedChildren.contains(operand)) {
            throw new SchemaException(name + " " + property + " operand " + operand
                    + " is not an effective fixed child");
        }
    }

    private void validateDefaults(TomlSchema schema, Map<String, SchemaDefinition> definitions) {
        for (SchemaDefinition definition : definitions.values()) {
            EffectiveDefault effective = effectiveDefault(definition, schema.types(), new HashSet<>());
            if (effective.present()) {
                ValidationResult result = new TomlSchemaValidator(schema)
                        .validateDefinitionDefault(effective.value(), definition);
                if (!result.isValid()) {
                    throw new SchemaException(definition.name() + " has invalid default: "
                            + result.errors().getFirst().message());
                }
            }
            validateDefaults(schema, definition.children());
        }
    }

    static EffectiveDefault effectiveDefault(
            SchemaDefinition definition,
            Map<String, SchemaDefinition> types,
            Set<String> visiting
    ) {
        if (definition.hasDefault()) {
            return new EffectiveDefault(true, definition.defaultValue());
        }
        List<Object> inherited = new ArrayList<>();
        if (definition.reference() != null) {
            EffectiveDefault candidate = effectiveDefaultReference(definition.reference(), types, visiting);
            if (candidate.present()) {
                inherited.add(candidate.value());
            }
        }
        for (String component : definition.allOf()) {
            EffectiveDefault candidate = effectiveDefaultReference(component, types, new HashSet<>(visiting));
            if (candidate.present()) {
                inherited.add(candidate.value());
            }
        }
        if (inherited.isEmpty()) {
            return new EffectiveDefault(false, null);
        }
        Object first = inherited.getFirst();
        if (inherited.stream().skip(1).anyMatch(value -> !ValueSemantics.valuesEqual(first, value))) {
            throw new SchemaException(definition.name() + " inherits conflicting allof defaults");
        }
        return new EffectiveDefault(true, first);
    }

    private static EffectiveDefault effectiveDefaultReference(
            String reference,
            Map<String, SchemaDefinition> types,
            Set<String> visiting
    ) {
        if (SchemaType.fromSchemaNameOptional(reference).isPresent()) {
            return new EffectiveDefault(false, null);
        }
        Set<String> next = new HashSet<>(visiting);
        if (!next.add(reference)) {
            throw new SchemaException("Cyclic schema reference involving types." + reference);
        }
        SchemaDefinition referenced = types.get(reference);
        if (referenced == null) {
            throw new SchemaException("Unknown schema type reference: types." + reference);
        }
        return effectiveDefault(referenced, types, next);
    }

    record EffectiveDefault(boolean present, Object value) {
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
