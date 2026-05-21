package io.github.brunoborges.tomlschema;

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
        return switch (value) {
            case "any" -> ANY;
            case "string" -> STRING;
            case "integer" -> INTEGER;
            case "float" -> FLOAT;
            case "boolean" -> BOOLEAN;
            case "offset-date-time" -> OFFSET_DATE_TIME;
            case "local-date-time" -> LOCAL_DATE_TIME;
            case "local-date" -> LOCAL_DATE;
            case "local-time" -> LOCAL_TIME;
            case "array" -> ARRAY;
            case "table" -> TABLE;
            case "collection", "table-collection" -> COLLECTION;
            default -> throw new SchemaException("Unsupported schema type: " + value);
        };
    }
}
