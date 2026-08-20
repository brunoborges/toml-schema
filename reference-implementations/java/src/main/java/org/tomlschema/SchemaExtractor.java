package org.tomlschema;

import org.tomlj.TomlArray;
import org.tomlj.TomlTable;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class SchemaExtractor {
    private SchemaExtractor() {
    }

    static String generate(TomlTable document) {
        StringBuilder schema = new StringBuilder()
                .append("[toml-schema]\n")
                .append("version = \"").append(TomlSchemaVersion.CURRENT).append("\"\n\n")
                .append("[elements]\n");
        for (String key : sortedKeys(document)) {
            if (!key.equals("toml-schema")) {
                appendDefinition(schema, List.of("elements", key), document.get(List.of(key)));
            }
        }
        return schema.toString();
    }

    private static void appendDefinition(StringBuilder schema, List<String> path, Object value) {
        schema.append("\n[");
        for (int index = 0; index < path.size(); index++) {
            if (index > 0) {
                schema.append('.');
            }
            schema.append(encodeKey(path.get(index)));
        }
        String type = schemaType(value);
        schema.append("]\ntype = \"").append(type).append("\"\n");
        if (value instanceof TomlArray array) {
            schema.append("itemtype = \"").append(inferItemType(array)).append("\"\n");
        }
        if (value instanceof TomlTable table) {
            for (String key : sortedKeys(table)) {
                List<String> childPath = new ArrayList<>(path);
                childPath.add(key);
                appendDefinition(schema, childPath, table.get(List.of(key)));
            }
        }
    }

    private static String schemaType(Object value) {
        return switch (value) {
            case null -> "any";
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
            default -> "any";
        };
    }

    private static String inferItemType(TomlArray array) {
        if (array.isEmpty()) {
            return "any";
        }
        String first = schemaType(array.get(0));
        for (int index = 1; index < array.size(); index++) {
            if (!schemaType(array.get(index)).equals(first)) {
                return "any";
            }
        }
        return first;
    }

    private static List<String> sortedKeys(TomlTable table) {
        List<String> keys = new ArrayList<>(table.keySet());
        Collections.sort(keys);
        return keys;
    }

    private static String encodeKey(String key) {
        if (!key.isEmpty() && key.chars().allMatch(character ->
                Character.isLetterOrDigit(character) && character < 128
                        || character == '_' || character == '-')) {
            return key;
        }
        StringBuilder encoded = new StringBuilder("\"");
        for (int index = 0; index < key.length(); index++) {
            char character = key.charAt(index);
            switch (character) {
                case '\\' -> encoded.append("\\\\");
                case '"' -> encoded.append("\\\"");
                case '\b' -> encoded.append("\\b");
                case '\t' -> encoded.append("\\t");
                case '\n' -> encoded.append("\\n");
                case '\f' -> encoded.append("\\f");
                case '\r' -> encoded.append("\\r");
                default -> {
                    if (character < 0x20 || character == 0x7f) {
                        encoded.append(String.format("\\u%04X", (int) character));
                    } else {
                        encoded.append(character);
                    }
                }
            }
        }
        return encoded.append('"').toString();
    }
}
