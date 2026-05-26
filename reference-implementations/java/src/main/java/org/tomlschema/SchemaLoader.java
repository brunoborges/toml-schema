package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlArray;
import org.tomlj.TomlParseError;
import org.tomlj.TomlParseResult;
import org.tomlj.TomlTable;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
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
            "type", "typeof", "arraytype", "itemtype", "items", "allowedvalues", "pattern",
            "optional", "default", "min", "max", "minlength", "maxlength",
            "oneof", "anyof", "children"
    );

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
        validateTopLevel(parsed);
        Map<String, SchemaDefinition> types = parseDefinitions("types", parsed.getTable("types"), false);
        Map<String, SchemaDefinition> elements = parseDefinitions("elements", parsed.getTable("elements"), true);
        return new TomlSchema(schemaPath, types, elements);
    }

    private void validateTopLevel(TomlTable schema) {
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
        TomlSchemaVersion.validate(metadata.get("version"));
        for (String key : metadata.keySet()) {
            if (!key.equals("version") && !key.equals("meta")) {
                throw new SchemaException("Unsupported [toml-schema] key: " + key);
            }
        }
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
            Object value = table.get(List.of(key));
            if (key.equals("children") && value instanceof TomlTable childrenTable && !hasDefinitionMarker(childrenTable)) {
                for (String childKey : childrenTable.keySet()) {
                    Object childValue = childrenTable.get(List.of(childKey));
                    if (!(childValue instanceof TomlTable childDefinitionTable)) {
                        throw new SchemaException("[" + prefix + ".children] entry must be a table: " + childKey);
                    }
                    definitions.put(childKey, parseDefinition(prefix + "." + childKey, childDefinitionTable));
                }
                continue;
            }
            if (!(value instanceof TomlTable definitionTable)) {
                throw new SchemaException("[" + prefix + "] entry must be a table: " + key);
            }
            definitions.put(key, parseDefinition(prefix + "." + key, definitionTable));
        }
        return definitions;
    }

    private SchemaDefinition parseDefinition(String name, TomlTable table) {
        SchemaType type = getSchemaType(table, "type");
        String reference = getString(table, "typeof");
        String normalizedReference = normalizeReference(reference);
        SchemaType arrayType = getSchemaType(table, "arraytype");
        String itemReference = normalizeReference(getString(table, "itemtype"));
        List<String> items = getStringArrayValues(table, "items").stream().map(this::normalizeReference).toList();
        Boolean optional = getBoolean(table, "optional");
        Pattern pattern = getPattern(name, table);
        Integer minLength = getInteger(table, "minlength");
        Integer maxLength = getInteger(table, "maxlength");
        List<Object> allowedValues = getArrayValues(table, "allowedvalues");
        List<String> oneOf = getStringArrayValues(table, "oneof");
        List<String> anyOf = getStringArrayValues(table, "anyof");
        if (!oneOf.isEmpty() && !anyOf.isEmpty()) {
            throw new SchemaException(name + " cannot define both oneof and anyof");
        }

        Map<String, SchemaDefinition> children = new LinkedHashMap<>();
        TomlTable explicitChildren = table.getTable("children");
        if (explicitChildren != null) {
            for (String key : explicitChildren.keySet()) {
                Object value = explicitChildren.get(List.of(key));
                if (!(value instanceof TomlTable childTable)) {
                    throw new SchemaException(name + ".children." + key + " must be a table");
                }
                children.put(key, parseDefinition(name + "." + key, childTable));
            }
        }
        for (String key : table.keySet()) {
            Object value = table.get(List.of(key));
            if (value instanceof TomlTable childTable) {
                if (DEFINITION_KEYS.contains(key)) {
                    if (!key.equals("children")) {
                        throw new SchemaException(name + "." + key + " must not be a table");
                    }
                    continue;
                }
                if (children.containsKey(key)) {
                    throw new SchemaException(name + " defines child " + key + " more than once");
                }
                children.put(key, parseDefinition(name + "." + key, childTable));
            } else if (!DEFINITION_KEYS.contains(key)) {
                throw new SchemaException(name + " contains unsupported property: " + key);
            }
        }
        if (type == null && normalizedReference == null && oneOf.isEmpty() && anyOf.isEmpty()) {
            throw new SchemaException(name + " must define type, typeof, oneof, or anyof");
        }
        if (type != SchemaType.ARRAY && arrayType != null) {
            throw new SchemaException(name + " can only define arraytype when type is array");
        }
        if (type != SchemaType.ARRAY && itemReference != null) {
            throw new SchemaException(name + " can only define itemtype when type is array");
        }
        if (type != SchemaType.ARRAY && !items.isEmpty()) {
            throw new SchemaException(name + " can only define items when type is array");
        }
        if (!items.isEmpty()) {
            if (arrayType != null) {
                throw new SchemaException(name + " cannot define both items and arraytype");
            }
            if (itemReference != null) {
                throw new SchemaException(name + " cannot define both items and itemtype");
            }
            if (minLength != null || maxLength != null) {
                throw new SchemaException(name + " cannot define minlength or maxlength together with items");
            }
        }
        validateRangeConstraints(name, type, arrayType, itemReference, table.get("min"), table.get("max"));
        return new SchemaDefinition(
                name,
                type,
                normalizedReference,
                arrayType,
                itemReference,
                items,
                optional != null && optional,
                allowedValues,
                pattern,
                table.get("min"),
                table.get("max"),
                minLength,
                maxLength,
                oneOf.stream().map(this::normalizeReference).toList(),
                anyOf.stream().map(this::normalizeReference).toList(),
                children
        );
    }

    private SchemaType getSchemaType(TomlTable table, String key) {
        String value = getString(table, key);
        return value == null ? null : SchemaType.fromSchemaName(value);
    }

    private boolean hasDefinitionMarker(TomlTable table) {
        return table.contains(List.of("type"))
                || table.contains(List.of("typeof"));
    }

    private String getString(TomlTable table, String key) {
        Object value = table.get(key);
        if (value == null) {
            return null;
        }
        if (!(value instanceof String stringValue)) {
            throw new SchemaException("Expected " + key + " to be a string");
        }
        return stringValue;
    }

    private Boolean getBoolean(TomlTable table, String key) {
        Object value = table.get(key);
        if (value == null) {
            return null;
        }
        if (!(value instanceof Boolean booleanValue)) {
            throw new SchemaException("Expected " + key + " to be a boolean");
        }
        return booleanValue;
    }

    private Integer getInteger(TomlTable table, String key) {
        Object value = table.get(key);
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

    private Pattern getPattern(String definitionName, TomlTable table) {
        String pattern = getString(table, "pattern");
        if (pattern == null) {
            return null;
        }
        try {
            return Pattern.compile(pattern);
        } catch (PatternSyntaxException e) {
            throw new SchemaException(definitionName + " has invalid pattern: " + pattern, e);
        }
    }

    private List<Object> getArrayValues(TomlTable table, String key) {
        Object value = table.get(key);
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

    private void validateRangeConstraints(String name, SchemaType type, SchemaType arrayType, String itemReference, Object min, Object max) {
        if (min == null && max == null) {
            return;
        }
        rejectNaNBoundary(name, "min", min);
        rejectNaNBoundary(name, "max", max);
        if (type == SchemaType.ANY) {
            throw new SchemaException(name + " cannot define min or max when type is any");
        }
        if (type == SchemaType.ARRAY) {
            if (itemReference != null) {
                throw new SchemaException(name + " cannot define min or max together with itemtype");
            }
            SchemaType itemType = arrayType == null ? SchemaType.ANY : arrayType;
            if (!isRangeComparable(itemType)) {
                throw new SchemaException(name + " can only define min or max for arrays with numeric or date/time arraytype");
            }
            return;
        }
        if (type != null && !isRangeComparable(type)) {
            throw new SchemaException(name + " can only define min or max for integer, float, date/time, or compatible array types");
        }
    }

    private void rejectNaNBoundary(String name, String key, Object value) {
        if (value instanceof Double doubleValue && doubleValue.isNaN()) {
            throw new SchemaException(name + " cannot use NaN as " + key);
        }
    }

    private boolean isRangeComparable(SchemaType type) {
        return switch (type) {
            case INTEGER, FLOAT, OFFSET_DATE_TIME, LOCAL_DATE_TIME, LOCAL_DATE, LOCAL_TIME -> true;
            default -> false;
        };
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
