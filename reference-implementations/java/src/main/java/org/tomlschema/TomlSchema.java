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

/**
 * A loaded TOML Schema document that can validate parsed or file-based TOML documents.
 */
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

    /**
     * Loads a schema document from a path.
     *
     * @param schemaPath the TOML Schema document to load
     * @return the loaded schema
     * @throws SchemaException if the schema is malformed or invalid
     */
    public static TomlSchema load(Path schemaPath) {
        return new SchemaLoader().load(schemaPath);
    }

    /**
     * Validates a TOML document read from a path.
     *
     * @param tomlPath the TOML document to validate
     * @return its validation result, including TOML parse errors when present
     * @throws IOException if the document cannot be read
     */
    public ValidationResult validate(Path tomlPath) throws IOException {
        TomlParseResult document = Toml.parse(tomlPath);
        if (document.hasErrors()) {
            return parseErrors(document.errors());
        }
        return new TomlSchemaValidator(this).validate(document);
    }

    /**
     * Validates an already parsed TOML document.
     *
     * @param document the parsed document
     * @return its validation result, including parser errors when present
     */
    public ValidationResult validate(TomlParseResult document) {
        if (document.hasErrors()) {
            return parseErrors(document.errors());
        }
        return new TomlSchemaValidator(this).validate(document);
    }

    Path source() {
        return source;
    }

    /**
     * Returns the TOML Schema language version declared by this schema.
     *
     * @return the declared schema version
     */
    public String version() {
        return version;
    }

    /**
     * Returns the effective default for an element path, when one is defined.
     *
     * @param elementPath decoded element names from the root element to the requested element
     * @return the effective default, or empty when the path has no default
     * @throws IllegalArgumentException if no element path is supplied
     */
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

    /**
     * Returns the effective default for a reusable type, when one is defined.
     *
     * @param typeName a type name with or without the {@code types.} prefix
     * @return the effective default, or empty when the type is unknown or has no default
     */
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
