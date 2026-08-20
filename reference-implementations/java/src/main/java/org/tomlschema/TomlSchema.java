package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlParseError;
import org.tomlj.TomlParseResult;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
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

    /**
     * Discovers and loads the schema referenced by a TOML document's reserved
     * {@code [toml-schema].location}, following the resolution and
     * version-compatibility rules of SPEC.md's
     * "TOML Reference of a TOML Schema" section.
     *
     * <p>A relative {@code location} is resolved against {@code documentPath}'s
     * parent, not the current working directory. An absolute local path or a
     * {@code file} URI with a hierarchical, local path is also supported.
     * Unsupported URI schemes, opaque {@code file} URIs, non-local hosts,
     * query/fragment components, and encoded path separators are rejected.
     * When the document declares an optional {@code [toml-schema].version}, a
     * major-version mismatch against the resolved schema fails discovery,
     * while any other version difference is reported as a warning on the
     * returned {@link DiscoveredSchema}.
     *
     * @param documentPath the TOML document whose schema-reference metadata is discovered
     * @return the discovered schema, the parsed document, and any version-compatibility warnings
     * @throws IOException if the document cannot be read or parsed
     * @throws SchemaException if the schema-reference metadata is missing or invalid, the
     *         location cannot be resolved safely, or the schema versions are incompatible
     */
    public static DiscoveredSchema discover(Path documentPath) throws IOException {
        return SchemaDiscovery.discover(documentPath);
    }

    /**
     * Discovers the schema referenced by a TOML document and validates that same
     * document against it in one step, without parsing the document twice.
     *
     * @param documentPath the TOML document to discover a schema for and validate
     * @return the validation result, including any discovery version-compatibility warnings
     * @throws IOException if the document cannot be read or parsed
     * @throws SchemaException if the schema-reference metadata is missing or invalid, the
     *         location cannot be resolved safely, or the schema versions are incompatible
     */
    public static ValidationResult validateDocument(Path documentPath) throws IOException {
        return discover(documentPath).validate();
    }

    /**
     * Generates a draft TOML Schema describing an already parsed TOML document.
     *
     * @param document the parsed TOML document
     * @return deterministic TOML Schema source text
     */
    public static String generateSchema(org.tomlj.TomlTable document) {
        return SchemaExtractor.generate(document);
    }

    /**
     * Reads a TOML document and writes its inferred draft schema.
     *
     * @param documentPath the source TOML document
     * @param schemaPath the draft schema destination
     * @throws IOException if either file cannot be read or written
     * @throws SchemaException if the source document is invalid TOML
     */
    public static void extractSchemaFile(Path documentPath, Path schemaPath) throws IOException {
        TomlParseResult document = Toml.parse(documentPath);
        if (document.hasErrors()) {
            throw new SchemaException("Unable to parse document " + documentPath + ": "
                    + document.errors().stream().map(Object::toString)
                    .collect(Collectors.joining("; ")));
        }
        Files.writeString(schemaPath, generateSchema(document), StandardCharsets.UTF_8);
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
