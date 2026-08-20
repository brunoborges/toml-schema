package org.tomlschema;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

record SchemaDefinition(
        String name,
        SchemaType type,
        String reference,
        String description,
        String itemReference,
        List<String> items,
        boolean optional,
        List<Object> allowedValues,
        Pattern pattern,
        SchemaStringFormat format,
        Pattern keyPattern,
        Object min,
        Object max,
        Integer minLength,
        Integer maxLength,
        List<String> oneOf,
        List<String> anyOf,
        SchemaCondition condition,
        String thenReference,
        String elseReference,
        List<String> allOf,
        Map<String, List<String>> dependentRequired,
        List<List<String>> mutuallyExclusive,
        List<List<String>> exactlyOne,
        Boolean uniqueItems,
        boolean hasDefault,
        Object defaultValue,
        boolean deprecated,
        Map<String, SchemaDefinition> children
) {
    SchemaDefinition {
        allowedValues = List.copyOf(allowedValues);
        oneOf = List.copyOf(oneOf);
        anyOf = List.copyOf(anyOf);
        allOf = List.copyOf(allOf);
        dependentRequired = dependentRequired.entrySet().stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(
                        Map.Entry::getKey, entry -> List.copyOf(entry.getValue())));
        mutuallyExclusive = mutuallyExclusive.stream().map(List::copyOf).toList();
        exactlyOne = exactlyOne.stream().map(List::copyOf).toList();
        items = List.copyOf(items);
        children = Map.copyOf(children);
    }

}
