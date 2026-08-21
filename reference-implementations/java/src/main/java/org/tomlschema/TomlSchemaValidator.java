package org.tomlschema;

import org.tomlj.TomlArray;
import org.tomlj.TomlTable;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class TomlSchemaValidator {
    private final TomlSchema schema;
    private final List<ValidationDiagnostic> errors = new ArrayList<>();
    private final LinkedHashSet<ValidationDiagnostic> warnings = new LinkedHashSet<>();
    private LinkedHashSet<ValidationDiagnostic> nodeWarnings = warnings;
    private boolean suppressWarnings;

    TomlSchemaValidator(TomlSchema schema) {
        this.schema = schema;
    }

    ValidationResult validate(TomlTable document) {
        validateFixedChildren("$", document, schema.elements());
        for (String key : document.keySet()) {
            if (!schema.elements().containsKey(key) && !key.equals("toml-schema")) {
                add(DiagnosticCodes.UNKNOWN_KEY, appendPath("$", key), "$.elements", "unexpected key");
            }
        }
        return result();
    }

    ValidationResult validateDefinitionDefault(Object value, SchemaDefinition definition) {
        suppressWarnings = true;
        validateNode("$default", value, definition);
        return result();
    }

    private ValidationResult result() {
        return new ValidationResult(dedup(errors), dedup(new ArrayList<>(warnings)));
    }

    private static List<ValidationDiagnostic> dedup(List<ValidationDiagnostic> diagnostics) {
        Set<List<String>> seen = new HashSet<>();
        List<ValidationDiagnostic> out = new ArrayList<>();
        for (ValidationDiagnostic diagnostic : diagnostics) {
            List<String> identity = Arrays.asList(
                    diagnostic.code(), diagnostic.instancePath(), diagnostic.schemaPath());
            if (seen.add(identity)) {
                out.add(diagnostic);
            }
        }
        return out;
    }

    private void validateFixedChildren(
            String path,
            TomlTable table,
            Map<String, SchemaDefinition> definitions
    ) {
        for (Map.Entry<String, SchemaDefinition> entry : definitions.entrySet()) {
            String key = entry.getKey();
            Object value = table.get(List.of(key));
            String childPath = appendPath(path, key);
            if (value == null) {
                if (!isOptional(entry.getValue(), new HashSet<>())) {
                    add(DiagnosticCodes.MISSING_REQUIRED, childPath, entry.getValue().schemaPath(),
                            "required value is missing");
                }
            } else {
                validateNode(childPath, value, entry.getValue());
            }
        }
    }

    private void validateNode(String path, Object value, SchemaDefinition definition) {
        validateComposedNode(path, value, definition, new HashSet<>(),
                collectEffectiveClosureChildren(definition, value, new HashSet<>()),
                !resolvesToUnionSelector(definition, new HashSet<>()), warnings);
    }

    /**
     * Validates every contributor of one composed node inside a single warning transaction.
     * Warnings produced by the node itself, including node warnings adopted from successful union
     * branches, are buffered until the whole composition has been validated and are handed to
     * {@code nodeSink} only when the node contributed no error. Descendant nodes run their own
     * transaction and commit into {@link #warnings} independently, so a valid child keeps its
     * warnings even when an ancestor or sibling contributor fails.
     */
    private void validateComposedNode(
            String path,
            Object value,
            SchemaDefinition definition,
            Set<String> externalChildren,
            Set<String> closure,
            boolean enforceClosure,
            Set<ValidationDiagnostic> nodeSink
    ) {
        LinkedHashSet<ValidationDiagnostic> enclosingWarnings = nodeWarnings;
        LinkedHashSet<ValidationDiagnostic> scopedWarnings = new LinkedHashSet<>();
        nodeWarnings = scopedWarnings;
        int errorsBefore = errors.size();
        try {
            validateContributor(path, value, definition, externalChildren, new HashSet<>());

            if (enforceClosure
                    && effectiveKind(definition, new HashSet<>()) == SchemaType.TABLE
                    && value instanceof TomlTable table
                    && !closure.isEmpty()) {
                for (String key : table.keySet()) {
                    if (!closure.contains(key)) {
                        add(DiagnosticCodes.UNKNOWN_KEY, appendPath(path, key),
                                definition.schemaPath(), "unexpected key");
                    }
                }
            }
            if (!suppressWarnings && isDeprecatedWithoutAlternatives(definition, new HashSet<>())) {
                warn(path, deprecatedSchemaPath(definition, new HashSet<>()));
            }
        } finally {
            nodeWarnings = enclosingWarnings;
        }
        if (errors.size() == errorsBefore) {
            nodeSink.addAll(scopedWarnings);
        }
    }

    /**
     * Validates one contributor of a composed node. {@code externalChildren} carries the keys that
     * other contributors of the same node already account for, so that composed unions can tell
     * externally contributed keys apart from keys owned by a sibling alternative.
     */
    private void validateContributor(
            String path,
            Object value,
            SchemaDefinition definition,
            Set<String> externalChildren,
            Set<String> visiting
    ) {
        if (definition.reference() != null) {
            Set<String> referenceExternal =
                    siblingChildren(definition, externalChildren, true, null, visiting);
            Set<String> referenceScope = new HashSet<>(visiting);
            validateContributor(path, value, reference(definition.reference(), referenceScope),
                    referenceExternal, referenceScope);
            if (value instanceof TomlTable table) {
                validatePresenceRules(path, table, definition);
            }
            if (value instanceof TomlArray array && Boolean.TRUE.equals(definition.uniqueItems())) {
                validateUniqueItems(path, array, sp(definition, "uniqueitems"));
            }
        } else if (definition.condition() != null) {
            validateConditional(path, value, definition,
                    siblingChildren(definition, externalChildren, true, null, visiting));
        } else if (!definition.oneOf().isEmpty() || !definition.anyOf().isEmpty()) {
            validateUnion(path, value, definition,
                    siblingChildren(definition, externalChildren, true, null, visiting));
            if (value instanceof TomlTable table) {
                validatePresenceRules(path, table, definition);
            }
            if (value instanceof TomlArray array && Boolean.TRUE.equals(definition.uniqueItems())) {
                validateUniqueItems(path, array, sp(definition, "uniqueitems"));
            }
        } else {
            SchemaType type = definition.type() == null ? SchemaType.ANY : definition.type();
            if (!isType(value, type)) {
                add(DiagnosticCodes.TYPE_MISMATCH, path, typeSchemaPath(definition),
                        "expected " + type.schemaName() + " but found " + typeName(value));
            } else {
                validateCommonConstraints(path, value, definition);
                switch (type) {
                    case TABLE -> validateTableContributor(path, (TomlTable) value, definition);
                    case COLLECTION -> validateCollectionContributor(
                            path, (TomlTable) value, definition,
                            nodeChildren(definition, value, externalChildren, visiting));
                    case ARRAY -> validateArray(path, (TomlArray) value, definition);
                    default -> {
                    }
                }
            }
        }
        for (String component : definition.allOf()) {
            Set<String> componentScope = new HashSet<>(visiting);
            Set<String> componentExternal =
                    siblingChildren(definition, externalChildren, false, component, visiting);
            validateContributor(path, value, reference(component, componentScope),
                    componentExternal, componentScope);
        }
    }

    /**
     * Collects every key allowed at this node by contributors of {@code definition} other than the
     * one about to be validated, merged with the keys already contributed from outside the node.
     */
    private Set<String> siblingChildren(
            SchemaDefinition definition,
            Set<String> externalChildren,
            boolean excludePrimary,
            String excludedComponent,
            Set<String> visiting
    ) {
        Set<String> result = new HashSet<>(externalChildren);
        result.addAll(definition.children().keySet());
        if (!excludePrimary) {
            result.addAll(primaryChildren(definition, visiting));
        }
        for (String component : definition.allOf()) {
            if (component.equals(excludedComponent)) {
                continue;
            }
            Set<String> scope = new HashSet<>(visiting);
            result.addAll(collectDeterminateReferenceChildren(component, scope));
        }
        return result;
    }

    private Set<String> primaryChildren(SchemaDefinition definition, Set<String> visiting) {
        if (definition.reference() != null) {
            return collectDeterminateReferenceChildren(
                    definition.reference(), new HashSet<>(visiting));
        }
        return Set.of();
    }

    private Set<String> nodeChildren(
            SchemaDefinition definition,
            Object value,
            Set<String> externalChildren,
            Set<String> visiting
    ) {
        Set<String> result = new HashSet<>(externalChildren);
        result.addAll(collectEffectiveClosureChildren(definition, value, new HashSet<>(visiting)));
        return result;
    }

    private List<String> alternatives(SchemaDefinition definition) {
        return definition.oneOf().isEmpty() ? definition.anyOf() : definition.oneOf();
    }

    /**
     * The outcome of one union alternative. {@code nodeWarnings} holds the warnings the branch
     * committed for the union node itself, and {@code result} carries the branch errors together
     * with the warnings its descendant nodes committed on their own.
     */
    private record BranchOutcome(
            ValidationResult result,
            LinkedHashSet<ValidationDiagnostic> nodeWarnings
    ) {
    }

    private void validateConditional(
            String path,
            Object value,
            SchemaDefinition definition,
            Set<String> sharedChildren
    ) {
        boolean matches = false;
        if (value instanceof TomlTable table) {
            SchemaCondition condition = definition.condition();
            Object discriminator = table.get(List.of(condition.key()));
            matches = discriminator != null
                    && (condition.usesEquals()
                    ? ValueSemantics.valuesEqual(discriminator, condition.equalsValue())
                    : condition.inValues().stream()
                    .anyMatch(candidate -> ValueSemantics.valuesEqual(discriminator, candidate)));
        }
        String selected = matches ? definition.thenReference() : definition.elseReference();

        TomlSchemaValidator branch = new TomlSchemaValidator(schema);
        branch.suppressWarnings = suppressWarnings;
        SchemaDefinition selectedDefinition = branch.reference(selected, new HashSet<>());
        Set<String> branchClosure = branch.collectEffectiveClosureChildren(
                selectedDefinition, value, new HashSet<>());
        branchClosure.addAll(sharedChildren);
        LinkedHashSet<ValidationDiagnostic> branchNodeWarnings = new LinkedHashSet<>();
        branch.validateComposedNode(path, value, selectedDefinition,
                sharedChildren, branchClosure, true, branchNodeWarnings);
        ValidationResult branchResult = branch.result();
        errors.addAll(branchResult.errors());
        if (!suppressWarnings) {
            warnings.addAll(branchResult.warnings());
            nodeWarnings.addAll(branchNodeWarnings);
        }
    }

    private void validateUnion(
            String path,
            Object value,
            SchemaDefinition definition,
            Set<String> sharedChildren
    ) {
        List<String> alternatives = alternatives(definition);
        List<BranchOutcome> successful = new ArrayList<>();
        for (String alternative : alternatives) {
            TomlSchemaValidator branch = new TomlSchemaValidator(schema);
            branch.suppressWarnings = suppressWarnings;
            SchemaDefinition alternativeDefinition = branch.reference(alternative, new HashSet<>());
            Set<String> alternativeChildren =
                    branch.collectEffectiveClosureChildren(alternativeDefinition, value, new HashSet<>());
            Set<String> branchClosure = new HashSet<>(alternativeChildren);
            branchClosure.addAll(sharedChildren);
            LinkedHashSet<ValidationDiagnostic> branchNodeWarnings = new LinkedHashSet<>();
            branch.validateComposedNode(path, value, alternativeDefinition,
                    sharedChildren, branchClosure, true, branchNodeWarnings);
            ValidationResult branchResult = branch.result();
            if (branchResult.isValid()) {
                successful.add(new BranchOutcome(branchResult, branchNodeWarnings));
            }
        }
        if (!definition.oneOf().isEmpty() && successful.size() != 1) {
            add(DiagnosticCodes.ONEOF, path, sp(definition, "oneof"),
                    "expected exactly one matching type from oneof but found " + successful.size());
            return;
        }
        if (!definition.anyOf().isEmpty() && successful.isEmpty()) {
            add(DiagnosticCodes.ANYOF, path, sp(definition, "anyof"),
                    "expected at least one matching type from anyof");
            return;
        }
        if (!suppressWarnings) {
            for (BranchOutcome outcome : successful) {
                warnings.addAll(outcome.result().warnings());
                nodeWarnings.addAll(outcome.nodeWarnings());
            }
        }
    }

    private void validateTableContributor(String path, TomlTable table, SchemaDefinition definition) {
        validateFixedChildren(path, table, definition.children());
        validatePresenceRules(path, table, definition);
    }

    private void validateCollectionContributor(
            String path,
            TomlTable table,
            SchemaDefinition definition,
            Set<String> fixedChildren
    ) {
        validateFixedChildren(path, table, definition.children());
        validatePresenceRules(path, table, definition);
        int dynamicEntries = 0;
        for (Map.Entry<String, Object> entry : table.entrySet()) {
            String key = entry.getKey();
            if (fixedChildren.contains(key)) {
                continue;
            }
            dynamicEntries++;
            String childPath = appendPath(path, key);
            if (definition.keyPattern() != null
                    && !definition.keyPattern().matcher(key).find()) {
                add(DiagnosticCodes.KEYPATTERN, childPath, sp(definition, "keypattern"),
                        "key does not match keypattern " + definition.keyPattern().pattern());
            }
            if (definition.itemReference() != null) {
                validateNode(childPath, entry.getValue(),
                        reference(definition.itemReference(), new HashSet<>()));
            }
            validateMemberValueConstraints(childPath, entry.getValue(), definition);
        }
        validateLength(path, dynamicEntries, definition);
    }

    private void validatePresenceRules(String path, TomlTable table, SchemaDefinition definition) {
        for (Map.Entry<String, List<String>> dependency : definition.dependentRequired().entrySet()) {
            if (!table.contains(List.of(dependency.getKey()))) {
                continue;
            }
            for (String required : dependency.getValue()) {
                if (!table.contains(List.of(required))) {
                    add(DiagnosticCodes.DEPENDENTREQUIRED, appendPath(path, required),
                            sp(definition, "dependentrequired"),
                            required + " is required when " + dependency.getKey() + " is present");
                }
            }
        }
        for (List<String> group : definition.mutuallyExclusive()) {
            long present = group.stream().filter(name -> table.contains(List.of(name))).count();
            if (present > 1) {
                add(DiagnosticCodes.MUTUALLYEXCLUSIVE, path, sp(definition, "mutuallyexclusive"),
                        "at most one of " + group + " may be present");
            }
        }
        for (List<String> group : definition.exactlyOne()) {
            long present = group.stream().filter(name -> table.contains(List.of(name))).count();
            if (present != 1) {
                add(DiagnosticCodes.EXACTLYONE, path, sp(definition, "exactlyone"),
                        "exactly one of " + group + " must be present");
            }
        }
    }

    private void validateArray(String path, TomlArray array, SchemaDefinition definition) {
        validateLength(path, array.size(), definition);
        if (Boolean.TRUE.equals(definition.uniqueItems())) {
            validateUniqueItems(path, array, sp(definition, "uniqueitems"));
        }
        if (!definition.items().isEmpty()) {
            if (array.size() != definition.items().size()) {
                add(DiagnosticCodes.TUPLE_LENGTH, path, sp(definition, "items"),
                        "expected array length " + definition.items().size()
                                + " but found " + array.size());
            }
            int upperBound = Math.min(array.size(), definition.items().size());
            for (int i = 0; i < upperBound; i++) {
                validateNode(path + "[" + i + "]", array.get(i),
                        reference(definition.items().get(i), new HashSet<>()));
            }
            return;
        }
        for (int i = 0; i < array.size(); i++) {
            Object item = array.get(i);
            String itemPath = path + "[" + i + "]";
            if (definition.itemReference() != null) {
                validateNode(itemPath, item,
                        reference(definition.itemReference(), new HashSet<>()));
            }
            if (!definition.allowedValues().isEmpty()) {
                validateAllowedValues(itemPath, item, definition);
            }
            if ((definition.min() != null || definition.max() != null)
                    && boundariesAreComparableWith(item, definition)) {
                validateRange(itemPath, item, definition);
            }
            if (item instanceof String stringValue) {
                if (definition.pattern() != null
                        && !definition.pattern().matcher(stringValue).find()) {
                    add(DiagnosticCodes.PATTERN, itemPath, sp(definition, "pattern"),
                            "does not match pattern " + definition.pattern().pattern());
                }
                if (definition.format() != null && !definition.format().isValid(stringValue)) {
                    add(DiagnosticCodes.FORMAT, itemPath, sp(definition, "format"),
                            "does not match format " + definition.format().schemaName());
                }
            }
        }
    }

    private void validateUniqueItems(String path, TomlArray array, String schemaPath) {
        for (int i = 0; i < array.size(); i++) {
            for (int j = 0; j < i; j++) {
                if (ValueSemantics.valuesEqual(array.get(i), array.get(j))) {
                    add(DiagnosticCodes.UNIQUEITEMS, path + "[" + i + "]", schemaPath,
                            "array item duplicates item at index " + j);
                    break;
                }
            }
        }
    }

    private void validateCommonConstraints(String path, Object value, SchemaDefinition definition) {
        if (value instanceof TomlArray) {
            return;
        }
        if (value instanceof TomlTable && definition.type() == SchemaType.COLLECTION) {
            return;
        }
        validateAllowedValues(path, value, definition);
        if (definition.allowedValues().isEmpty()) {
            validateRange(path, value, definition);
        }
        if (value instanceof String stringValue) {
            validateLength(path, stringValue.codePointCount(0, stringValue.length()), definition);
            if (definition.pattern() != null
                    && !definition.pattern().matcher(stringValue).find()) {
                add(DiagnosticCodes.PATTERN, path, sp(definition, "pattern"),
                        "does not match pattern " + definition.pattern().pattern());
            }
            if (definition.format() != null && !definition.format().isValid(stringValue)) {
                add(DiagnosticCodes.FORMAT, path, sp(definition, "format"),
                        "does not match format " + definition.format().schemaName());
            }
        }
    }

    private void validateAllowedValues(String path, Object value, SchemaDefinition definition) {
        if (!definition.allowedValues().isEmpty()
                && definition.allowedValues().stream()
                .noneMatch(allowed -> ValueSemantics.valuesEqual(allowed, value))) {
            add(DiagnosticCodes.ALLOWEDVALUES, path, sp(definition, "allowedvalues"),
                    "value is not in allowedvalues");
        }
    }

    private void validateMemberValueConstraints(
            String path,
            Object value,
            SchemaDefinition definition
    ) {
        validateAllowedValues(path, value, definition);
        if (definition.allowedValues().isEmpty()
                && (definition.min() != null || definition.max() != null)
                && boundariesAreComparableWith(value, definition)) {
            validateRange(path, value, definition);
        }
        if (value instanceof String stringValue) {
            if (definition.pattern() != null
                    && !definition.pattern().matcher(stringValue).find()) {
                add(DiagnosticCodes.PATTERN, path, sp(definition, "pattern"),
                        "does not match pattern " + definition.pattern().pattern());
            }
            if (definition.format() != null && !definition.format().isValid(stringValue)) {
                add(DiagnosticCodes.FORMAT, path, sp(definition, "format"),
                        "does not match format " + definition.format().schemaName());
            }
        }
    }

    private void validateRange(String path, Object value, SchemaDefinition definition) {
        if (definition.min() != null) {
            try {
                if (ValueSemantics.compare(value, definition.min()) < 0) {
                    add(DiagnosticCodes.MIN, path, sp(definition, "min"), "value is less than min");
                }
            } catch (SchemaException error) {
                add(DiagnosticCodes.MIN, path, sp(definition, "min"), error.getMessage());
            }
        }
        if (definition.max() != null) {
            try {
                if (ValueSemantics.compare(value, definition.max()) > 0) {
                    add(DiagnosticCodes.MAX, path, sp(definition, "max"), "value is greater than max");
                }
            } catch (SchemaException error) {
                add(DiagnosticCodes.MAX, path, sp(definition, "max"), error.getMessage());
            }
        }
    }

    private void validateLength(String path, int length, SchemaDefinition definition) {
        if (definition.minLength() != null && length < definition.minLength()) {
            add(DiagnosticCodes.MINLENGTH, path, sp(definition, "minlength"),
                    "length is less than minlength");
        }
        if (definition.maxLength() != null && length > definition.maxLength()) {
            add(DiagnosticCodes.MAXLENGTH, path, sp(definition, "maxlength"),
                    "length is greater than maxlength");
        }
    }

    private boolean boundariesAreComparableWith(Object value, SchemaDefinition definition) {
        return boundaryIsComparableWith(value, definition.min())
                && boundaryIsComparableWith(value, definition.max());
    }

    private boolean boundaryIsComparableWith(Object value, Object boundary) {
        if (boundary == null) {
            return true;
        }
        if (value instanceof Number && boundary instanceof Number) {
            return true;
        }
        return value instanceof Comparable<?> && value.getClass().isInstance(boundary);
    }

    private Set<String> collectDeterminateFixedChildren(
            SchemaDefinition definition,
            Set<String> visiting
    ) {
        Set<String> result = new HashSet<>(definition.children().keySet());
        if (definition.reference() != null) {
            result.addAll(collectDeterminateReferenceChildren(
                    definition.reference(), new HashSet<>(visiting)));
        }
        for (String component : definition.allOf()) {
            result.addAll(collectDeterminateReferenceChildren(
                    component, new HashSet<>(visiting)));
        }
        return result;
    }

    private Set<String> collectDeterminateReferenceChildren(String reference, Set<String> visiting) {
        SchemaDefinition target = reference(reference, visiting);
        return collectDeterminateFixedChildren(target, new HashSet<>(visiting));
    }

    private Set<String> collectEffectiveClosureChildren(
            SchemaDefinition definition,
            Object value,
            Set<String> visiting
    ) {
        Set<String> result = collectDeterminateFixedChildren(definition, new HashSet<>(visiting));
        if (definition.reference() != null) {
            SchemaDefinition target = reference(definition.reference(), visiting);
            result.addAll(collectEffectiveClosureChildren(target, value, new HashSet<>(visiting)));
        }
        for (String component : definition.allOf()) {
            SchemaDefinition target = reference(component, visiting);
            result.addAll(collectEffectiveClosureChildren(target, value, new HashSet<>(visiting)));
        }
        for (String alternative : alternatives(definition)) {
            SchemaDefinition target = reference(alternative, visiting);
            result.addAll(collectEffectiveClosureChildren(target, value, new HashSet<>(visiting)));
        }
        if (definition.condition() != null && value instanceof TomlTable table) {
            SchemaCondition condition = definition.condition();
            Object discriminator = table.get(List.of(condition.key()));
            boolean matches = discriminator != null
                    && (condition.usesEquals()
                    ? ValueSemantics.valuesEqual(discriminator, condition.equalsValue())
                    : condition.inValues().stream()
                    .anyMatch(candidate -> ValueSemantics.valuesEqual(discriminator, candidate)));
            String selected = matches ? definition.thenReference() : definition.elseReference();
            SchemaDefinition target = reference(selected, visiting);
            result.addAll(collectEffectiveClosureChildren(target, value, new HashSet<>(visiting)));
        }
        return result;
    }

    private SchemaType effectiveKind(SchemaDefinition definition, Set<String> visiting) {
        if (definition.reference() != null) {
            return effectiveKind(reference(definition.reference(), visiting), new HashSet<>(visiting));
        }
        if (definition.condition() != null) {
            return effectiveKind(
                    reference(definition.thenReference(), visiting), new HashSet<>(visiting));
        }
        if (!definition.oneOf().isEmpty() || !definition.anyOf().isEmpty()) {
            List<String> alternatives = definition.oneOf().isEmpty()
                    ? definition.anyOf() : definition.oneOf();
            SchemaType kind = null;
            for (String alternative : alternatives) {
                SchemaType candidate = effectiveKind(reference(alternative, visiting),
                        new HashSet<>(visiting));
                if (kind == null) {
                    kind = candidate;
                } else if (kind != candidate) {
                    return SchemaType.ANY;
                }
            }
            return kind == null ? SchemaType.ANY : kind;
        }
        if (definition.type() != null) {
            return definition.type();
        }
        if (!definition.allOf().isEmpty()) {
            return effectiveKind(
                    reference(definition.allOf().getFirst(), visiting), new HashSet<>(visiting));
        }
        return SchemaType.ANY;
    }

    private boolean resolvesToUnionSelector(SchemaDefinition definition, Set<String> visiting) {
        if (definition.condition() != null
                || !definition.oneOf().isEmpty() || !definition.anyOf().isEmpty()) {
            return true;
        }
        return definition.reference() != null
                && resolvesToUnionSelector(
                reference(definition.reference(), visiting), new HashSet<>(visiting));
    }

    private boolean isOptional(SchemaDefinition definition, Set<String> visiting) {
        if (definition.optional()) {
            return true;
        }
        return definition.reference() != null
                && isOptional(reference(definition.reference(), visiting), new HashSet<>(visiting));
    }

    private boolean isDeprecatedWithoutAlternatives(
            SchemaDefinition definition,
            Set<String> visiting
    ) {
        if (definition.deprecated()) {
            return true;
        }
        if (definition.reference() != null
                && isDeprecatedWithoutAlternatives(
                reference(definition.reference(), visiting), new HashSet<>(visiting))) {
            return true;
        }
        for (String component : definition.allOf()) {
            if (isDeprecatedWithoutAlternatives(
                    reference(component, visiting), new HashSet<>(visiting))) {
                return true;
            }
        }
        return false;
    }

    private String deprecatedSchemaPath(SchemaDefinition definition, Set<String> visiting) {
        if (definition.deprecated()) {
            return definition.schemaPath() == null ? null : definition.schemaPath() + ".deprecated";
        }
        if (definition.reference() != null) {
            SchemaDefinition target = reference(definition.reference(), visiting);
            if (isDeprecatedWithoutAlternatives(target, new HashSet<>(visiting))) {
                return deprecatedSchemaPath(target, new HashSet<>(visiting));
            }
        }
        for (String component : definition.allOf()) {
            SchemaDefinition target = reference(component, visiting);
            if (isDeprecatedWithoutAlternatives(target, new HashSet<>(visiting))) {
                return deprecatedSchemaPath(target, new HashSet<>(visiting));
            }
        }
        return definition.schemaPath() == null ? null : definition.schemaPath() + ".deprecated";
    }

    private SchemaDefinition reference(String reference, Set<String> visiting) {
        String normalized = normalizeReference(reference);
        SchemaType builtIn = SchemaType.fromSchemaNameOptional(normalized).orElse(null);
        if (builtIn != null) {
            return builtIn(normalized, builtIn);
        }
        if (!visiting.add(normalized)) {
            throw new SchemaException("Cyclic schema reference involving types." + normalized);
        }
        SchemaDefinition definition = schema.types().get(normalized);
        if (definition == null) {
            throw new SchemaException("Unknown schema type reference: types." + normalized);
        }
        return definition;
    }

    private SchemaDefinition builtIn(String name, SchemaType type) {
        return new SchemaDefinition(name, type, null, null, null, List.of(), false,
                List.of(), null, null, null, null, null, null, null, List.of(), List.of(),
                null, null, null, List.of(), Map.of(), List.of(), List.of(), null,
                false, null, false, Map.of(), null);
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

    private String normalizeReference(String reference) {
        return reference.startsWith("types.") ? reference.substring("types.".length()) : reference;
    }

    private String appendPath(String path, String key) {
        return path + "." + PathEncoding.encodeKey(key);
    }

    private void add(String code, String instancePath, String schemaPath, String message) {
        errors.add(ValidationDiagnostic.error(
                DiagnosticPhase.VALIDATION, code, instancePath, schemaPath, message));
    }

    private static String sp(SchemaDefinition definition, String property) {
        return definition.schemaPath() == null ? null : definition.schemaPath() + "." + property;
    }

    private static String typeSchemaPath(SchemaDefinition definition) {
        return sp(definition, "type");
    }

    private void warn(String instancePath, String schemaPath) {
        nodeWarnings.add(ValidationDiagnostic.warning(
                DiagnosticPhase.VALIDATION, DiagnosticCodes.DEPRECATED, instancePath, schemaPath,
                "value is deprecated"));
    }
}
