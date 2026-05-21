package io.github.brunoborges.tomlschema;

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
    private static final Set<String> TOP_LEVEL_KEYS = Set.of("toml-schema", "types", "elements");
    private static final Set<String> DEFINITION_KEYS = Set.of(
            "type", "typeof", "typeref", "arraytype", "allowedvalues", "pattern",
            "optional", "default", "min", "max", "minlength", "maxlength", "minoccurs", "maxoccurs",
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
            Object value = table.get(key);
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
        String legacyReference = getString(table, "typeref");
        if (reference != null && legacyReference != null && !reference.equals(legacyReference)) {
            throw new SchemaException(name + " cannot define both typeof and typeref with different values");
        }
        String normalizedReference = normalizeReference(reference != null ? reference : legacyReference);
        SchemaType arrayType = getSchemaType(table, "arraytype");
        Boolean optional = getBoolean(table, "optional");
        Pattern pattern = getPattern(name, table);
        Integer minLength = getInteger(table, "minlength");
        Integer maxLength = getInteger(table, "maxlength");
        Integer minOccurs = getInteger(table, "minoccurs");
        Integer maxOccurs = getInteger(table, "maxoccurs");
        if (minLength == null) {
            minLength = minOccurs;
        }
        if (maxLength == null) {
            maxLength = maxOccurs;
        }
        List<Object> allowedValues = getArrayValues(table, "allowedvalues");

        Map<String, SchemaDefinition> children = new LinkedHashMap<>();
        TomlTable explicitChildren = table.getTable("children");
        if (explicitChildren != null) {
            for (String key : explicitChildren.keySet()) {
                Object value = explicitChildren.get(key);
                if (!(value instanceof TomlTable childTable)) {
                    throw new SchemaException(name + ".children." + key + " must be a table");
                }
                children.put(key, parseDefinition(name + "." + key, childTable));
            }
        }
        for (String key : table.keySet()) {
            Object value = table.get(key);
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
        if (type == null && normalizedReference == null) {
            throw new SchemaException(name + " must define type, typeof, or typeref");
        }
        if (type != SchemaType.ARRAY && arrayType != null) {
            throw new SchemaException(name + " can only define arraytype when type is array");
        }
        return new SchemaDefinition(
                name,
                type,
                normalizedReference,
                arrayType,
                optional != null && optional,
                allowedValues,
                pattern,
                table.get("min"),
                table.get("max"),
                minLength,
                maxLength,
                children
        );
    }

    private SchemaType getSchemaType(TomlTable table, String key) {
        String value = getString(table, key);
        return value == null ? null : SchemaType.fromSchemaName(value);
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
