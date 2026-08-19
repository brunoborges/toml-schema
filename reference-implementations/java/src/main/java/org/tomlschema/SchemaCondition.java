package org.tomlschema;

import java.util.List;

record SchemaCondition(
        String key,
        boolean usesEquals,
        Object equalsValue,
        List<Object> inValues
) {
    SchemaCondition {
        inValues = List.copyOf(inValues);
    }
}
