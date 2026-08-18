package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlParseError;
import org.tomlj.TomlParseResult;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

public final class TomlSchema {
    private final Path source;
    private final String version;
    private final Map<String, SchemaDefinition> types;
    private final Map<String, SchemaDefinition> elements;

    TomlSchema(Path source, String version, Map<String, SchemaDefinition> types, Map<String, SchemaDefinition> elements) {
        this.source = source;
        this.version = version;
        this.types = Map.copyOf(types);
        this.elements = Map.copyOf(elements);
    }

    public static TomlSchema load(Path schemaPath) {
        return new SchemaLoader().load(schemaPath);
    }

    public ValidationResult validate(Path tomlPath) throws IOException {
        TomlParseResult document = Toml.parse(tomlPath);
        if (document.hasErrors()) {
            return parseErrors(document.errors());
        }
        return new TomlSchemaValidator(this).validate(document);
    }

    public ValidationResult validate(TomlParseResult document) {
        if (document.hasErrors()) {
            return parseErrors(document.errors());
        }
        return new TomlSchemaValidator(this).validate(document);
    }

    Path source() {
        return source;
    }

    public String version() {
        return version;
    }

    public Optional<Object> defaultValue(String... elementPath) {
        if (elementPath.length == 0) {
            throw new IllegalArgumentException("elementPath must not be empty");
        }
        SchemaDefinition definition = elements.get(elementPath[0]);
        for (int i = 1; definition != null && i < elementPath.length; i++) {
            definition = definition.children().get(elementPath[i]);
        }
        if (definition == null) {
            return Optional.empty();
        }
        SchemaLoader.EffectiveDefault effective =
                SchemaLoader.effectiveDefault(definition, types, new java.util.HashSet<>());
        return effective.present() ? Optional.of(effective.value()) : Optional.empty();
    }

    public Optional<Object> typeDefaultValue(String typeName) {
        String normalized = typeName.startsWith("types.")
                ? typeName.substring("types.".length()) : typeName;
        SchemaDefinition definition = types.get(normalized);
        if (definition == null) {
            return Optional.empty();
        }
        SchemaLoader.EffectiveDefault effective =
                SchemaLoader.effectiveDefault(definition, types, new java.util.HashSet<>());
        return effective.present() ? Optional.of(effective.value()) : Optional.empty();
    }

    Map<String, SchemaDefinition> types() {
        return types;
    }

    Map<String, SchemaDefinition> elements() {
        return elements;
    }

    private static ValidationResult parseErrors(List<TomlParseError> errors) {
        return new ValidationResult(errors.stream()
                .map(error -> new ValidationError("$", error.toString()))
                .collect(Collectors.toList()));
    }
}
