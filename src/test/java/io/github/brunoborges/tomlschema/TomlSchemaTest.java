package io.github.brunoborges.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TomlSchemaTest {
    @TempDir
    Path tempDir;

    @Test
    void validatesCheckedInExample() throws IOException {
        ValidationResult result = TomlSchema.load(Path.of("config.tosd")).validate(Path.of("config.toml"));

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void selfSchemaValidatesSchemaDocuments() throws IOException {
        TomlSchema schemaSchema = TomlSchema.load(Path.of("toml-schema.tosd"));

        assertTrue(schemaSchema.validate(Path.of("config.tosd")).isValid());
        assertTrue(schemaSchema.validate(Path.of("toml-schema.tosd")).isValid());
    }

    @Test
    void reportsValidationErrors() throws IOException {
        Path schema = write("schema.tosd", """
                [toml-schema]
                version = "1"

                [elements.name]
                type = "string"
                minlength = 2
                pattern = "^[a-z]+$"

                [elements.port]
                type = "integer"
                min = 1
                max = 65535
                """);
        Path document = write("document.toml", """
                name = "A"
                port = 70000
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertFalse(result.isValid());
        assertEquals(3, result.errors().size(), () -> result.errors().toString());
        assertTrue(result.errors().stream().anyMatch(error -> error.path().equals("$.name")));
        assertTrue(result.errors().stream().anyMatch(error -> error.path().equals("$.port")));
    }

    @Test
    void supportsLegacyReferenceAndCollectionAliases() throws IOException {
        Path schema = write("legacy.tosd", """
                [toml-schema]
                version = "1"

                [types.item]
                type = "table"

                    [types.item.name]
                    type = "string"

                [elements.items]
                type = "table-collection"
                typeref = "types.item"
                """);
        Path document = write("legacy.toml", """
                [items.one]
                name = "alpha"
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void cliLocatesSchemaFromDocumentMetadata() throws IOException {
        write("schema.tosd", """
                [toml-schema]
                version = "1"

                [elements.title]
                type = "string"
                """);
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                version = "1"
                location = "schema.tosd"
                """);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"validate", document.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(0, exitCode, err::toString);
        assertTrue(out.toString(StandardCharsets.UTF_8).contains("is valid"));
    }

    private Path write(String fileName, String content) throws IOException {
        Path path = tempDir.resolve(fileName);
        Files.writeString(path, content, StandardCharsets.UTF_8);
        return path;
    }
}
