package io.github.brunoborges.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TomlSchemaTest {
    @TempDir
    Path tempDir;

    @Test
    void validatesCheckedInExample() throws IOException {
        ValidationResult result = TomlSchema.load(fixture("config.tosd")).validate(fixture("config.toml"));

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void selfSchemaValidatesSchemaDocuments() throws IOException {
        TomlSchema schemaSchema = TomlSchema.load(fixture("toml-schema.tosd"));

        assertTrue(schemaSchema.validate(fixture("config.tosd")).isValid());
        assertTrue(schemaSchema.validate(fixture("toml-schema.tosd")).isValid());
    }

    @Test
    void enforcesSemverSchemaVersions() throws IOException {
        Path compatiblePatchSchema = write("compatible-version.tosd", """
                [toml-schema]
                version = "1.0.1+build.1"

                [elements.title]
                type = "string"
                """);

        assertDoesNotThrow(() -> TomlSchema.load(compatiblePatchSchema));

        for (String version : List.of("1", "1.0", "01.0.0", "1.1.0", "2.0.0")) {
            Path schema = write("invalid-version-" + version.replace('.', '-') + ".tosd", """
                    [toml-schema]
                    version = "%s"

                    [elements.title]
                    type = "string"
                    """.formatted(version));

            assertThrows(SchemaException.class, () -> TomlSchema.load(schema), version);
        }
    }

    @Test
    void reportsValidationErrors() throws IOException {
        Path schema = write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

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
    void stringLengthCountsUnicodeScalarValues() throws IOException {
        Path schema = write("unicode-length.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.emoji]
                type = "string"
                minlength = 1
                maxlength = 1

                [elements.composed]
                type = "string"
                maxlength = 1
                """);
        Path validDocument = write("unicode-length-valid.toml", """
                emoji = "\\U0001F600"
                composed = "\\u00E9"
                """);
        Path invalidDocument = write("unicode-length-invalid.toml", """
                emoji = "\\U0001F600"
                composed = "e\\u0301"
                """);

        TomlSchema tomlSchema = TomlSchema.load(schema);

        assertTrue(tomlSchema.validate(validDocument).isValid());
        ValidationResult invalidResult = tomlSchema.validate(invalidDocument);
        assertFalse(invalidResult.isValid());
        assertTrue(invalidResult.errors().stream().anyMatch(error -> error.path().equals("$.composed")));
    }

    @Test
    void supportsLegacyReferenceAndCollectionAliases() throws IOException {
        Path schema = write("legacy.tosd", """
                [toml-schema]
                version = "1.0.0"

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
                version = "1.0.0"

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
                version = "1.0.0"

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
    void validatesTupleArraysByPosition() throws IOException {
        Path schema = write("tuple-array.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.coordinate]
                type = "float"

                [types.label]
                type = "string"

                [types.scalar]
                oneof = [ "types.coordinate", "types.integerCoordinate" ]

                [types.integerCoordinate]
                type = "integer"

                [types.coordinateLabel]
                type = "array"
                items = [ "types.coordinate", "types.label" ]

                [elements.value]
                type = "array"
                items = [ "types.coordinateLabel", "types.scalar" ]
                """);
        Path document = write("tuple-array.toml", """
                value = [ [ 1.5, "Hello" ], 2 ]
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void rejectsInvalidTupleArrays() throws IOException {
        Path schema = write("tuple-array-invalid.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.coordinate]
                type = "float"

                [types.label]
                type = "string"

                [elements.value]
                type = "array"
                items = [ "types.coordinate", "types.label" ]
                """);
        Path wrongOrder = write("tuple-array-wrong-order.toml", """
                value = [ "Hello", 1.5 ]
                """);
        Path tooShort = write("tuple-array-short.toml", """
                value = [ 1.5 ]
                """);
        Path tooLong = write("tuple-array-long.toml", """
                value = [ 1.5, "Hello", true ]
                """);

        ValidationResult wrongOrderResult = TomlSchema.load(schema).validate(wrongOrder);
        assertFalse(wrongOrderResult.isValid());
        assertTrue(wrongOrderResult.errors().stream().anyMatch(error -> error.path().equals("$.value[0]")));
        assertTrue(wrongOrderResult.errors().stream().anyMatch(error -> error.path().equals("$.value[1]")));

        ValidationResult tooShortResult = TomlSchema.load(schema).validate(tooShort);
        assertFalse(tooShortResult.isValid());
        assertTrue(tooShortResult.errors().stream().anyMatch(error -> error.path().equals("$.value") && error.message().contains("expected array length 2")));

        ValidationResult tooLongResult = TomlSchema.load(schema).validate(tooLong);
        assertFalse(tooLongResult.isValid());
        assertTrue(tooLongResult.errors().stream().anyMatch(error -> error.path().equals("$.value") && error.message().contains("expected array length 2")));
    }

    @Test
    void rejectsTupleArraySchemaWithConflictingProperties() throws IOException {
        Path withArrayType = write("tuple-arraytype-conflict.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "array"
                items = [ "types.coordinate", "types.label" ]
                arraytype = "string"
                """);
        Path withLength = write("tuple-length-conflict.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "array"
                items = [ "types.coordinate", "types.label" ]
                minlength = 2
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(withArrayType));
        assertThrows(SchemaException.class, () -> TomlSchema.load(withLength));
    }

    @Test
    void supportsQuotedDottedAndEmptyTomlKeysWithChildrenTable() throws IOException {
        Path schema = write("special-keys.tosd", """
                [toml-schema]
                version = "1.0.0"

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
                version = "1.0.0"

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
                version = "1.0.0"

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
                version = "1.0.0"

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
                version = "1.0.0"

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
                version = "1.0.0"

                [elements.payload]
                type = "any"
                min = 1
                """);
        Path nanSchema = write("nan-min.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "float"
                min = nan
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(anySchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(nanSchema));
    }

    @Test
    void ignoresReservedTomlSchemaMetadataUnlessSchemaDefinesIt() throws IOException {
        Path schema = write("metadata-ignored.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        Path document = write("metadata-ignored.toml", """
                title = "Example"

                [toml-schema]
                version = 1
                location = "metadata-ignored.tosd"
                extra = "ignored"
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void validatesReservedTomlSchemaMetadataWhenSchemaDefinesIt() throws IOException {
        Path schema = write("metadata-defined.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.toml-schema]
                type = "table"

                    [elements.toml-schema.version]
                    type = "string"

                    [elements.toml-schema.location]
                    type = "string"

                [elements.title]
                type = "string"
                """);
        Path document = write("metadata-defined.toml", """
                title = "Example"

                [toml-schema]
                version = 1
                location = "metadata-defined.tosd"
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertFalse(result.isValid());
        assertTrue(result.errors().stream().anyMatch(error -> error.path().equals("$.toml-schema.version")));
    }

    @Test
    void cliLocatesSchemaFromDocumentMetadata() throws IOException {
        write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                version = "1.0.0"
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

    @Test
    void cliExtractsSchemaFromTomlDocument() throws IOException {
        Path document = write("extract-source.toml", """
                title = "Example"
                enabled = true
                ports = [8080, 8081]

                [owner]
                name = "Alice"

                [toml-schema]
                version = "1.0.0"
                location = "ignored.tosd"
                """);
        Path extractedSchema = tempDir.resolve("extract-output.tosd");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"extract", document.toString(), extractedSchema.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(0, exitCode, err::toString);
        assertTrue(out.toString(StandardCharsets.UTF_8).contains("Extracted schema to"));

        String schemaText = Files.readString(extractedSchema, StandardCharsets.UTF_8);
        assertTrue(schemaText.contains("version = \"1.0.0\""));
        assertTrue(schemaText.contains("[elements.title]"));
        assertTrue(schemaText.contains("type = \"string\""));
        assertTrue(schemaText.contains("[elements.owner]"));
        assertTrue(schemaText.contains("[elements.owner.name]"));
        assertFalse(schemaText.contains("[elements.toml-schema]"));

        ValidationResult validationResult = TomlSchema.load(extractedSchema).validate(document);
        assertTrue(validationResult.isValid(), () -> validationResult.errors().toString());
    }

    private Path write(String fileName, String content) throws IOException {
        Path path = tempDir.resolve(fileName);
        Files.writeString(path, content, StandardCharsets.UTF_8);
        return path;
    }

    private Path fixture(String fileName) {
        Path fromRepositoryRoot = Path.of(fileName);
        if (Files.exists(fromRepositoryRoot)) {
            return fromRepositoryRoot;
        }
        return Path.of("..", "..", fileName);
    }
}
