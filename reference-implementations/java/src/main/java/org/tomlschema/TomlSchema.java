package org.tomlschema;

import org.tomlj.Toml;
import org.tomlj.TomlParseError;
import org.tomlj.TomlParseResult;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public final class TomlSchema {
    private final Path source;
    private final Map<String, SchemaDefinition> types;
    private final Map<String, SchemaDefinition> elements;

    TomlSchema(Path source, Map<String, SchemaDefinition> types, Map<String, SchemaDefinition> elements) {
        this.source = source;
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
