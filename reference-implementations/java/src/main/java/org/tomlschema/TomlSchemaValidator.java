package org.tomlschema;

import org.tomlj.TomlArray;
import org.tomlj.TomlTable;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

final class TomlSchemaValidator {
    private final TomlSchema schema;
    private final List<ValidationError> errors = new ArrayList<>();

    TomlSchemaValidator(TomlSchema schema) {
        this.schema = schema;
    }

    ValidationResult validate(TomlTable document) {
        validateTable("$", document, schema.elements());
        for (String key : document.keySet()) {
            if (!schema.elements().containsKey(key) && !key.equals("toml-schema")) {
                add("$." + key, "unexpected key");
            }
        }
        return new ValidationResult(errors);
    }

    private void validateTable(String path, TomlTable table, Map<String, SchemaDefinition> definitions) {
        for (Map.Entry<String, SchemaDefinition> entry : definitions.entrySet()) {
            String key = entry.getKey();
            SchemaDefinition definition = resolve(entry.getValue(), new HashSet<>());
            Object value = table.get(List.of(key));
            String childPath = appendPath(path, key);
            if (value == null) {
                if (!definition.optional()) {
                    add(childPath, "required value is missing");
                }
                continue;
            }
            validateValue(childPath, value, definition);
        }
    }

    private void validateValue(String path, Object value, SchemaDefinition definition) {
        SchemaDefinition resolved = resolve(definition, new HashSet<>());
        if (!resolved.oneOf().isEmpty() || !resolved.anyOf().isEmpty()) {
            validateUnion(path, value, resolved);
            return;
        }
        SchemaType type = resolved.type() == null ? SchemaType.ANY : resolved.type();
        validateType(path, value, type);
        if (!isType(value, type)) {
            return;
        }
        validateCommonConstraints(path, value, resolved);
        switch (type) {
            case TABLE -> validateTableValue(path, (TomlTable) value, resolved);
            case COLLECTION -> validateCollection(path, (TomlTable) value, resolved);
            case ARRAY -> validateArray(path, (TomlArray) value, resolved);
            default -> {
            }
        }
    }

    private void validateUnion(String path, Object value, SchemaDefinition definition) {
        List<String> alternatives = definition.oneOf().isEmpty() ? definition.anyOf() : definition.oneOf();
        long matches = alternatives.stream()
                .map(reference -> validateAgainst(path, value, resolveReference(reference, new HashSet<>())))
                .filter(List::isEmpty)
                .count();
        if (!definition.oneOf().isEmpty() && matches != 1) {
            add(path, "expected exactly one matching type from oneof but found " + matches);
        }
        if (!definition.anyOf().isEmpty() && matches == 0) {
            add(path, "expected at least one matching type from anyof");
        }
    }

    private List<ValidationError> validateAgainst(String path, Object value, SchemaDefinition definition) {
        TomlSchemaValidator validator = new TomlSchemaValidator(schema);
        validator.validateValue(path, value, definition);
        return validator.errors;
    }

    private void validateTableValue(String path, TomlTable table, SchemaDefinition definition) {
        if (definition.children().isEmpty()) {
            return;
        }
        validateTable(path, table, definition.children());
        for (String key : table.keySet()) {
            if (!definition.children().containsKey(key)) {
                add(appendPath(path, key), "unexpected key");
            }
        }
    }

    private void validateCollection(String path, TomlTable table, SchemaDefinition definition) {
        int dynamicEntries = 0;
        for (Map.Entry<String, Object> entry : table.entrySet()) {
            String key = entry.getKey();
            String childPath = appendPath(path, key);
            SchemaDefinition fixedChild = definition.children().get(key);
            if (fixedChild != null) {
                validateValue(childPath, entry.getValue(), fixedChild);
                continue;
            }
            dynamicEntries++;
            String reference = definition.reference();
            if (reference == null) {
                add(childPath, "collection entry has no typeof reference");
                continue;
            }
            validateValue(childPath, entry.getValue(), resolveReference(reference, new HashSet<>()));
        }
        validateLength(path, dynamicEntries, definition);
        for (Map.Entry<String, SchemaDefinition> entry : definition.children().entrySet()) {
            if (!table.contains(List.of(entry.getKey())) && !resolve(entry.getValue(), new HashSet<>()).optional()) {
                add(appendPath(path, entry.getKey()), "required value is missing");
            }
        }
    }

    private void validateArray(String path, TomlArray array, SchemaDefinition definition) {
        validateLength(path, array.size(), definition);
        if (!definition.items().isEmpty()) {
            validateTupleArray(path, array, definition);
            return;
        }
        SchemaType arrayType = definition.arrayType() == null ? SchemaType.ANY : definition.arrayType();
        SchemaDefinition itemDefinition = definition.itemReference() == null
                ? null
                : resolveReference(definition.itemReference(), new HashSet<>());
        if (arrayType == SchemaType.ANY && itemDefinition == null) {
            return;
        }
        for (int i = 0; i < array.size(); i++) {
            Object item = array.get(i);
            String itemPath = path + "[" + i + "]";
            boolean matchesArrayType = true;
            if (arrayType != SchemaType.ANY) {
                validateType(itemPath, item, arrayType);
                matchesArrayType = isType(item, arrayType);
            }
            if (!matchesArrayType) {
                continue;
            }
            if (itemDefinition == null) {
                validateAllowedValues(itemPath, item, definition);
                validateRange(itemPath, item, definition);
            } else {
                validateValue(itemPath, item, itemDefinition);
            }
        }
    }

    private void validateTupleArray(String path, TomlArray array, SchemaDefinition definition) {
        if (array.size() != definition.items().size()) {
            add(path, "expected array length " + definition.items().size() + " but found " + array.size());
        }
        int upperBound = Math.min(array.size(), definition.items().size());
        for (int i = 0; i < upperBound; i++) {
            String itemPath = path + "[" + i + "]";
            SchemaDefinition itemDefinition;
            try {
                itemDefinition = resolveReference(definition.items().get(i), new HashSet<>());
            } catch (SchemaException e) {
                add(itemPath, e.getMessage());
                continue;
            }
            validateValue(itemPath, array.get(i), itemDefinition);
        }
    }

    private void validateType(String path, Object value, SchemaType type) {
        if (!isType(value, type)) {
            add(path, "expected " + type.schemaName() + " but found " + typeName(value));
        }
    }

    private boolean isType(Object value, SchemaType type) {
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

    private void validateCommonConstraints(String path, Object value, SchemaDefinition definition) {
        if (value instanceof TomlArray array) {
            validateLength(path, array.size(), definition);
            return;
        }
        validateAllowedValues(path, value, definition);
        validateRange(path, value, definition);
        if (value instanceof String stringValue) {
            validateLength(path, stringLength(stringValue), definition);
            if (definition.pattern() != null && !definition.pattern().matcher(stringValue).matches()) {
                add(path, "does not match pattern " + definition.pattern().pattern());
            }
        }
    }

    private void validateAllowedValues(String path, Object value, SchemaDefinition definition) {
        if (!definition.allowedValues().isEmpty() && definition.allowedValues().stream().noneMatch(allowed -> valuesEqual(allowed, value))) {
            add(path, "value is not in allowedvalues");
        }
    }

    private void validateRange(String path, Object value, SchemaDefinition definition) {
        Object min = definition.min();
        Object max = definition.max();
        if (min != null && compare(value, min) < 0) {
            add(path, "value is less than min");
        }
        if (max != null && compare(value, max) > 0) {
            add(path, "value is greater than max");
        }
    }

    private void validateLength(String path, int length, SchemaDefinition definition) {
        if (definition.minLength() != null && length < definition.minLength()) {
            add(path, "length is less than minlength");
        }
        if (definition.maxLength() != null && length > definition.maxLength()) {
            add(path, "length is greater than maxlength");
        }
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private int compare(Object value, Object boundary) {
        if (value instanceof Number valueNumber && boundary instanceof Number boundaryNumber) {
            return Double.compare(valueNumber.doubleValue(), boundaryNumber.doubleValue());
        }
        if (value instanceof Comparable valueComparable && value.getClass().isInstance(boundary)) {
            return valueComparable.compareTo(boundary);
        }
        throw new SchemaException("Cannot compare " + typeName(value) + " with boundary " + typeName(boundary));
    }

    private boolean valuesEqual(Object allowed, Object value) {
        if (allowed instanceof Number allowedNumber && value instanceof Number valueNumber) {
            return Double.compare(allowedNumber.doubleValue(), valueNumber.doubleValue()) == 0;
        }
        return Objects.equals(allowed, value);
    }

    private SchemaDefinition resolve(SchemaDefinition definition, Set<String> seenReferences) {
        if (definition.reference() == null || definition.type() == SchemaType.COLLECTION) {
            return definition;
        }
        SchemaDefinition referenced = resolveReference(definition.reference(), seenReferences);
        SchemaType type = definition.type() == null ? referenced.type() : definition.type();
        String reference = type == SchemaType.COLLECTION ? referenced.reference() : null;
        Map<String, SchemaDefinition> children = referenced.children();
        if (!definition.children().isEmpty()) {
            java.util.LinkedHashMap<String, SchemaDefinition> merged = new java.util.LinkedHashMap<>(referenced.children());
            merged.putAll(definition.children());
            children = merged;
        }
        return new SchemaDefinition(
                definition.name(),
                type,
                reference,
                definition.arrayType() == null ? referenced.arrayType() : definition.arrayType(),
                definition.itemReference() == null ? referenced.itemReference() : definition.itemReference(),
                definition.items().isEmpty() ? referenced.items() : definition.items(),
                definition.optional() || referenced.optional(),
                definition.allowedValues().isEmpty() ? referenced.allowedValues() : definition.allowedValues(),
                definition.pattern() == null ? referenced.pattern() : definition.pattern(),
                definition.min() == null ? referenced.min() : definition.min(),
                definition.max() == null ? referenced.max() : definition.max(),
                definition.minLength() == null ? referenced.minLength() : definition.minLength(),
                definition.maxLength() == null ? referenced.maxLength() : definition.maxLength(),
                definition.oneOf().isEmpty() ? referenced.oneOf() : definition.oneOf(),
                definition.anyOf().isEmpty() ? referenced.anyOf() : definition.anyOf(),
                children
        );
    }

    private SchemaDefinition resolveReference(String reference, Set<String> seenReferences) {
        String normalizedReference = normalizeReference(reference);
        SchemaType builtInType = SchemaType.fromSchemaNameOptional(normalizedReference).orElse(null);
        if (builtInType != null) {
            return builtInReference(normalizedReference, builtInType);
        }
        if (!seenReferences.add(normalizedReference)) {
            throw new SchemaException("Cyclic schema reference involving types." + normalizedReference);
        }
        SchemaDefinition referenced = schema.types().get(normalizedReference);
        if (referenced == null) {
            throw new SchemaException("Unknown schema type reference: types." + normalizedReference);
        }
        return resolve(referenced, seenReferences);
    }

    private SchemaDefinition builtInReference(String reference, SchemaType type) {
        return new SchemaDefinition(
                reference,
                type,
                null,
                null,
                null,
                List.of(),
                false,
                List.of(),
                null,
                null,
                null,
                null,
                null,
                List.of(),
                List.of(),
                Map.of()
        );
    }

    private String normalizeReference(String reference) {
        return reference.startsWith("types.") ? reference.substring("types.".length()) : reference;
    }

    private String typeName(Object value) {
        return switch (value) {
            case null -> "null";
            case String _ -> "string";
            case Long _ -> "integer";
            case Double _ -> "float";
            case Boolean _ -> "boolean";
            case OffsetDateTime _ -> "offset-date-time";
            case LocalDateTime _ -> "local-date-time";
            case LocalDate _ -> "local-date";
            case LocalTime _ -> "local-time";
            case TomlArray _ -> "array";
            case TomlTable _ -> "table";
            default -> value.getClass().getSimpleName();
        };
    }

    private int stringLength(String value) {
        return value.codePointCount(0, value.length());
    }

    private String appendPath(String path, String key) {
        return path + "." + formatKey(key);
    }

    private String formatKey(String key) {
        if (key.matches("[A-Za-z0-9_-]+")) {
            return key;
        }
        return "\"" + key.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private void add(String path, String message) {
        errors.add(new ValidationError(path, message));
    }
}
