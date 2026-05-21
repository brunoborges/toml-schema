package io.github.brunoborges.tomlschema;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

record SchemaDefinition(
        String name,
        SchemaType type,
        String reference,
        SchemaType arrayType,
        String itemReference,
        boolean optional,
        List<Object> allowedValues,
        Pattern pattern,
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
        children = Map.copyOf(children);
    }

}
