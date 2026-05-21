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
import static org.junit.jupiter.api.Assertions.assertThrows;
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
    void validatesArrayOfTablesWithItemSchema() throws IOException {
        Path schema = write("products.tosd", """
                [toml-schema]
                version = "1"

                [types.product]
                type = "table"

                    [types.product.name]
                    type = "string"

                    [types.product.sku]
                    type = "integer"

                [elements.products]
                type = "array"
                arraytype = "table"
                itemtype = "types.product"
                minlength = 2
                """);
        Path document = write("products.toml", """
                [[products]]
                name = "Hammer"
                sku = 738594937

                [[products]]
                name = "Nail"
                sku = 284758393
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void validatesArraysOfInlineTablesWithItemSchema() throws IOException {
        Path schema = write("points.tosd", """
                [toml-schema]
                version = "1"

                [types.point]
                type = "table"

                    [types.point.x]
                    type = "integer"

                    [types.point.y]
                    type = "integer"

                [elements.points]
                type = "array"
                arraytype = "table"
                itemtype = "types.point"
                """);
        Path document = write("points.toml", """
                points = [
                  { x = 1, y = 2 },
                  { x = 3, y = 4 }
                ]
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void supportsQuotedDottedAndEmptyTomlKeysWithChildrenTable() throws IOException {
        Path schema = write("special-keys.tosd", """
                [toml-schema]
                version = "1"

                [elements.site]
                type = "table"

                    [elements.site.children]
                    "google.com" = { type = "boolean" }

                [elements.children]
                "" = { type = "string" }
                """);
        Path document = write("special-keys.toml", """
                "" = "blank"

                [site]
                "google.com" = true
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void quotesSpecialKeysInValidationErrorPaths() throws IOException {
        Path schema = write("special-key-error.tosd", """
                [toml-schema]
                version = "1"

                [elements.site]
                type = "table"

                    [elements.site.children]
                    "google.com" = { type = "boolean" }
                """);
        Path document = write("special-key-error.toml", """
                [site]
                "google.com" = "yes"
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertFalse(result.isValid());
        assertTrue(result.errors().stream().anyMatch(error -> error.path().equals("$.site.\"google.com\"")));
    }

    @Test
    void validatesAnyOfAndOneOfDefinitions() throws IOException {
        Path schema = write("unions.tosd", """
                [toml-schema]
                version = "1"

                [types.stringId]
                type = "string"
                pattern = "^[a-z]+$"

                [types.intId]
                type = "integer"
                min = 1

                [types.named]
                type = "table"

                    [types.named.name]
                    type = "string"

                [types.numbered]
                type = "table"

                    [types.numbered.id]
                    type = "integer"

                [elements.id]
                anyof = [ "types.stringId", "types.intId" ]

                [elements.entries]
                type = "array"
                arraytype = "table"
                itemtype = "types.namedOrNumbered"

                [types.namedOrNumbered]
                oneof = [ "types.named", "types.numbered" ]
                """);
        Path document = write("unions.toml", """
                id = "abc"
                entries = [
                  { name = "alpha" },
                  { id = 1 }
                ]
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void reportsUnionValidationFailures() throws IOException {
        Path schema = write("union-failure.tosd", """
                [toml-schema]
                version = "1"

                [types.named]
                type = "table"

                    [types.named.name]
                    type = "string"

                [types.numbered]
                type = "table"

                    [types.numbered.id]
                    type = "integer"

                [elements.entry]
                oneof = [ "types.named", "types.numbered" ]
                """);
        Path document = write("union-failure.toml", """
                [entry]
                name = "alpha"
                id = 1
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertFalse(result.isValid());
        assertTrue(result.errors().stream().anyMatch(error -> error.message().contains("exactly one")));
    }

    @Test
    void validatesNumericAndDateTimeBoundaries() throws IOException {
        Path schema = write("boundaries.tosd", """
                [toml-schema]
                version = "1"

                [elements.port]
                type = "integer"
                min = 1
                max = 65535

                [elements.deadline]
                type = "offset-date-time"
                min = 2026-01-01T00:00:00Z

                [elements.thresholds]
                type = "array"
                arraytype = "float"
                min = -inf
                max = inf
                """);
        Path document = write("boundaries.toml", """
                port = 443
                deadline = 2026-05-21T10:00:00Z
                thresholds = [ -1.0, 0.0, 1.0 ]
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void rejectsMalformedBoundarySchemas() throws IOException {
        Path anySchema = write("any-min.tosd", """
                [toml-schema]
                version = "1"

                [elements.payload]
                type = "any"
                min = 1
                """);
        Path nanSchema = write("nan-min.tosd", """
                [toml-schema]
                version = "1"

                [elements.value]
                type = "float"
                min = nan
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(anySchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(nanSchema));
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
