package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests document-driven schema discovery through {@code [toml-schema].location},
 * mirroring the behavioral cases covered by the Go and Rust reference implementations.
 */
class SchemaDiscoveryTest {
    @TempDir
    Path tempDir;

    @Test
    void discoversSchemaFromRelativeLocation() throws IOException {
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

        DiscoveredSchema discovered = TomlSchema.discover(document);
        ValidationResult result = discovered.validate();

        assertTrue(result.isValid(), () -> result.errors().toString());
        assertTrue(discovered.warnings().isEmpty());
    }

    @Test
    void validateDocumentDiscoversAndValidatesInOneStep() throws IOException {
        write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                location = "schema.tosd"
                """);

        ValidationResult result = TomlSchema.validateDocument(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void resolvesRelativeLocationAgainstDocumentDirectoryNotWorkingDirectory() throws IOException {
        Files.createDirectories(tempDir.resolve("schemas"));
        Files.createDirectories(tempDir.resolve("documents"));
        write("schemas/schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        Path document = write("documents/document.toml", """
                title = "Example"

                [toml-schema]
                location = "../schemas/schema.tosd"
                """);

        ValidationResult result = TomlSchema.validateDocument(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void resolvesAbsoluteLocalPathLocation() throws IOException {
        Path schema = write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                location = "%s"
                """.formatted(schema.toAbsolutePath().toString().replace("\\", "\\\\")));

        ValidationResult result = TomlSchema.validateDocument(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void resolvesAbsoluteFileUriLocation() throws IOException {
        Path schema = write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        String fileUri = schema.toAbsolutePath().normalize().toUri().toString();
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                location = "%s"
                """.formatted(fileUri));

        ValidationResult result = TomlSchema.validateDocument(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void failsDiscoveryWhenLocationMissing() throws IOException {
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                version = "1.0.0"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertDiscoveryError(exception, DiagnosticCodes.DISCOVERY_MISSING_LOCATION, null);
        assertTrue(exception.getMessage().contains("does not contain [toml-schema].location"),
                exception.getMessage());
    }

    @Test
    void failsDiscoveryWhenLocationIsBlank() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "   "
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("does not contain [toml-schema].location"),
                exception.getMessage());
    }

    @Test
    void failsDiscoveryWhenMetadataHasNoTomlSchemaTable() throws IOException {
        Path document = write("document.toml", """
                title = "Example"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("does not contain [toml-schema].location"),
                exception.getMessage());
    }

    @Test
    void rejectsNonScalarSchemaReferenceMetadata() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = ["schema.tosd"]
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertDiscoveryError(exception, DiagnosticCodes.DISCOVERY_INVALID_METADATA,
                "$.toml-schema.location");
        assertTrue(exception.getMessage().contains("must be a scalar value"), exception.getMessage());

        Path nonTable = write("non-table.toml", """
                toml-schema = "not metadata"
                """);
        SchemaException nonTableException = assertThrows(
                SchemaException.class, () -> TomlSchema.discover(nonTable));
        assertDiscoveryError(nonTableException, DiagnosticCodes.DISCOVERY_INVALID_METADATA,
                "$.toml-schema");
    }

    @Test
    void rejectsArrayOfTablesSchemaReferenceMetadata() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "schema.tosd"

                [[toml-schema.entries]]
                name = "a"

                [[toml-schema.entries]]
                name = "b"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("must be a scalar value"), exception.getMessage());
    }

    @Test
    void rejectsInlineTableSchemaReferenceMetadata() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "schema.tosd"
                meta = { author = "me" }
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("must be a scalar value"), exception.getMessage());
    }

    @Test
    void warnsOnNonMajorVersionMismatch() throws IOException {
        write("schema.tosd", """
                [toml-schema]
                version = "1.0.1"

                [elements.title]
                type = "string"
                """);
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                version = "1.0.0"
                location = "schema.tosd"
                """);

        DiscoveredSchema discovered = TomlSchema.discover(document);

        assertEquals(1, discovered.warnings().size());
        assertEquals(DiagnosticCodes.VERSION_MISMATCH, discovered.warnings().get(0).code());
        assertEquals("$.toml-schema.version", discovered.warnings().get(0).schemaPath());
        assertTrue(discovered.warnings().get(0).message().contains("1.0.0"));
        assertTrue(discovered.warnings().get(0).message().contains("1.0.1"));
        ValidationResult result = discovered.validate();
        assertTrue(result.isValid());
        assertEquals(discovered.warnings(), result.warnings());
    }

    @Test
    void failsOnMajorVersionMismatch() throws IOException {
        write("schema.tosd", """
                [toml-schema]
                version = "1.0.1"

                [elements.title]
                type = "string"
                """);
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                version = "2.0.0"
                location = "schema.tosd"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("major version"), exception.getMessage());
    }

    @Test
    void rejectsUnsupportedUriScheme() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "https://example.com/schema.tosd"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertDiscoveryError(exception, DiagnosticCodes.SCHEMA_RETRIEVAL_REFUSED,
                "$.toml-schema.location");
        assertTrue(exception.getMessage().contains("retrieval is not permitted"),
                exception.getMessage());
    }

    @Test
    void rejectsOpaqueFileUri() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "file:schema.tosd"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertDiscoveryError(exception, DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION,
                "$.toml-schema.location");
        assertTrue(exception.getMessage().contains("invalid file schema location"), exception.getMessage());
    }

    @Test
    void reportsMissingLocalSchemaAsRetrievalFailure() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "missing-schema.tosd"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertDiscoveryError(exception, DiagnosticCodes.SCHEMA_RETRIEVAL_FAILED,
                "$.toml-schema.location");
    }

    @Test
    void malformedRetrievedSchemaRemainsSchemaLoadFailure() throws IOException {
        write("schema.tosd", "[toml-schema\n");
        Path document = write("document.toml", """
                [toml-schema]
                location = "schema.tosd"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertEquals(DiagnosticPhase.SCHEMA_LOAD, exception.phase());
        assertEquals(DiagnosticCodes.SCHEMA_MALFORMED, exception.code());
    }

    @Test
    void rejectsFileUriWithQueryComponent() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "file:///schema.tosd?version=1"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("invalid file schema location"), exception.getMessage());
    }

    @Test
    void rejectsFileUriWithFragmentComponent() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "file:///schema.tosd#fragment"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("invalid file schema location"), exception.getMessage());
    }

    @Test
    void rejectsFileUriWithNonLocalHost() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "file://example.com/schema.tosd"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("non-local host"), exception.getMessage());
    }

    @Test
    void acceptsFileUriWithLocalhostHost() throws IOException {
        Path schema = write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        String hostQualifiedUri = "file://localhost" + schema.toAbsolutePath().normalize();
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                location = "%s"
                """.formatted(hostQualifiedUri));

        ValidationResult result = TomlSchema.validateDocument(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void rejectsEncodedPathSeparatorInFileUri() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "file:///tmp%2Fschema.tosd"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("encoded path separator"), exception.getMessage());
    }

    @Test
    void rejectsInvalidUriReferenceCharacters() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = "sche ma.tosd"
                """);

        SchemaException exception = assertThrows(SchemaException.class, () -> TomlSchema.discover(document));
        assertTrue(exception.getMessage().contains("invalid [toml-schema].location URI"), exception.getMessage());
    }

    @Test
    void ignoresReservedTomlSchemaTableDuringApplicationValidationByDefault() throws IOException {
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
                extra-key = "ignored by discovery, reserved for validation"
                """);

        ValidationResult result = TomlSchema.validateDocument(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void validatesReservedTomlSchemaTableWhenExplicitlyModeled() throws IOException {
        write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"

                [elements."toml-schema"]
                type = "table"
                [elements."toml-schema".location]
                type = "string"
                """);
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                location = "schema.tosd"
                """);

        ValidationResult result = TomlSchema.validateDocument(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    private Path write(String fileName, String content) throws IOException {
        Path path = tempDir.resolve(fileName);
        Files.createDirectories(path.getParent());
        Files.writeString(path, content, StandardCharsets.UTF_8);
        return path;
    }

    private static void assertDiscoveryError(
            SchemaException exception, String code, String schemaPath) {
        assertEquals(DiagnosticPhase.DISCOVERY, exception.phase());
        assertEquals(code, exception.code());
        assertEquals(schemaPath, exception.schemaPath());
    }
}
