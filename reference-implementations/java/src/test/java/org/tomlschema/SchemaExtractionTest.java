package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.tomlj.Toml;
import org.tomlj.TomlParseResult;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SchemaExtractionTest {
    @TempDir
    Path tempDir;

    @Test
    void generatesDeterministicSchemaWithQuotedKeys() {
        TomlParseResult document = Toml.parse("""
                zebra = "last"
                alpha = 1
                ratio = 1.5
                flag = true
                numbers = [1, 2]
                mixed = [1, "two"]
                [nested]
                "google.com" = "value"
                [toml-schema]
                location = "ignored.tosd"
                """);

        String schema = TomlSchema.generateSchema(document);

        assertTrue(schema.contains("[elements.alpha]\ntype = \"integer\""));
        assertTrue(schema.contains("[elements.numbers]\ntype = \"array\"\nitemtype = \"integer\""));
        assertTrue(schema.contains("[elements.mixed]\ntype = \"array\"\nitemtype = \"any\""));
        assertTrue(schema.contains("[elements.nested.\"google.com\"]\ntype = \"string\""));
        assertFalse(schema.contains("[elements.toml-schema]"));
        assertFalse(schema.contains("default ="));
        assertTrue(schema.indexOf("[elements.alpha]") < schema.indexOf("[elements.zebra]"));
    }

    @Test
    void extractsReloadableSchemaWithAllTemporalTypes() throws IOException {
        Path document = tempDir.resolve("source.toml");
        Files.writeString(document, """
                title = "Example"
                offset = 1979-05-27T07:32:00-08:00
                local_datetime = 1979-05-27T07:32:00
                local_date = 1979-05-27
                local_time = 07:32:00
                ports = [8080, 8081]
                [owner]
                name = "Ada"
                [toml-schema]
                location = "ignored.tosd"
                """);
        Path extracted = tempDir.resolve("generated.tosd");

        TomlSchema.extractSchemaFile(document, extracted);

        String schema = Files.readString(extracted);
        assertTrue(schema.contains("type = \"offset-date-time\""));
        assertTrue(schema.contains("type = \"local-date-time\""));
        assertTrue(schema.contains("type = \"local-date\""));
        assertTrue(schema.contains("type = \"local-time\""));
        ValidationResult result = TomlSchema.load(extracted).validate(document);
        assertTrue(result.isValid(), () -> "Validation failed: " + result.errors());
    }
}
