package org.tomlschema;

import java.util.Optional;

enum SchemaType {
    ANY("any"),
    STRING("string"),
    INTEGER("integer"),
    FLOAT("float"),
    BOOLEAN("boolean"),
    OFFSET_DATE_TIME("offset-date-time"),
    LOCAL_DATE_TIME("local-date-time"),
    LOCAL_DATE("local-date"),
    LOCAL_TIME("local-time"),
    ARRAY("array"),
    TABLE("table"),
    COLLECTION("collection");

    private final String schemaName;

    SchemaType(String schemaName) {
        this.schemaName = schemaName;
    }

    String schemaName() {
        return schemaName;
    }

    static SchemaType fromSchemaName(String value) {
        return fromSchemaNameOptional(value)
                .orElseThrow(() -> new SchemaException("Unsupported schema type: " + value));
    }

    static Optional<SchemaType> fromSchemaNameOptional(String value) {
        return switch (value) {
            case "any" -> Optional.of(ANY);
            case "string" -> Optional.of(STRING);
            case "integer" -> Optional.of(INTEGER);
            case "float" -> Optional.of(FLOAT);
            case "boolean" -> Optional.of(BOOLEAN);
            case "offset-date-time" -> Optional.of(OFFSET_DATE_TIME);
            case "local-date-time" -> Optional.of(LOCAL_DATE_TIME);
            case "local-date" -> Optional.of(LOCAL_DATE);
            case "local-time" -> Optional.of(LOCAL_TIME);
            case "array" -> Optional.of(ARRAY);
            case "table" -> Optional.of(TABLE);
            case "collection" -> Optional.of(COLLECTION);
            default -> Optional.empty();
        };
    }
}
