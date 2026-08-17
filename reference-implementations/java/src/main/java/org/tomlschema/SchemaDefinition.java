package org.tomlschema;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

record SchemaDefinition(
        String name,
        SchemaType type,
        String reference,
        String description,
        SchemaType arrayType,
        String itemReference,
        List<String> items,
        boolean optional,
        List<Object> allowedValues,
        Pattern pattern,
        Pattern keyPattern,
        Object min,
        Object max,
        Integer minLength,
        Integer maxLength,
        List<String> oneOf,
        List<String> anyOf,
        Map<String, SchemaDefinition> children
) {
    SchemaDefinition {
        allowedValues = List.copyOf(allowedValues);
        oneOf = List.copyOf(oneOf);
        anyOf = List.copyOf(anyOf);
        items = List.copyOf(items);
        children = Map.copyOf(children);
    }

}
