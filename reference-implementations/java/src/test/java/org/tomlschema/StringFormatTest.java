package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StringFormatTest {
    @TempDir
    Path tempDir;

    @Test
    void validatesEverySupportedFormat() {
        Map<SchemaStringFormat, List<String>> valid = Map.of(
                SchemaStringFormat.EMAIL, List.of(
                        "simple@example.com",
                        "user.name+tag@example-domain.com",
                        "\"quoted local\"@example.com",
                        "\"quote\\\"and\\\\slash\"@example.com",
                        "postmaster@[192.0.2.1]",
                        "postmaster@[IPv6:2001:db8::1]",
                        "postmaster@[TAG:opaque-data]",
                        "a".repeat(64) + "@" + longDomain(189)),
                SchemaStringFormat.UUID, List.of(
                        "550e8400-e29b-41d4-a716-446655440000",
                        "550E8400-E29B-41D4-A716-446655440000"),
                SchemaStringFormat.URI, List.of(
                        "https://example.com/a%20path?x=1#part",
                        "mailto:user@example.com", "urn:isbn:9780141036144",
                        "scheme:", "http://[v1.fe]/"),
                SchemaStringFormat.HOSTNAME, List.of(
                        "example.com", "a-b.example", "localhost", "example.com."),
                SchemaStringFormat.IPV4, List.of(
                        "0.0.0.0", "192.0.2.1", "255.255.255.255"),
                SchemaStringFormat.IPV6, List.of(
                        "::", "::1", "2001:db8::1", "2001:db8:0:1:2:3:4:5",
                        "::ffff:192.0.2.128", "2001:db8::192.0.2.1"));
        Map<SchemaStringFormat, List<String>> invalid = Map.of(
                SchemaStringFormat.EMAIL, List.of(
                        "josé@example.com", ".leading@example.com", "two..dots@example.com",
                        "missing-at.example.com", "\"unterminated@example.com",
                        "user@-example.com", "user@[300.1.1.1]", "user@[IPv6:2001:::1]",
                        "user@[TAG:bad\\data]", "user@[TAG:bad]data]",
                        "a".repeat(65) + "@example.com",
                        "a".repeat(64) + "@" + longDomain(190)),
                SchemaStringFormat.UUID, List.of(
                        "550e8400e29b41d4a716446655440000",
                        "550e8400-e29b-41d4-a716-44665544000g",
                        "550e8400-e29b-41d4-a716-4466554400000"),
                SchemaStringFormat.URI, List.of(
                        "/relative/path", "example.com/path", "https://example.com/%zz",
                        "https://example.com/é", "http://example.com/#first#second"),
                SchemaStringFormat.HOSTNAME, List.of(
                        "-example.com", "example-.com", "two..dots",
                        "a".repeat(64) + ".example", "éxample.com"),
                SchemaStringFormat.IPV4, List.of(
                        "192.168.1", "192.168.01.1", "256.0.0.1", "1.2.3.4.5", "1.2.3.-1"),
                SchemaStringFormat.IPV6, List.of(
                        "2001:db8:0:1:2:3:4", "2001:db8:0:1:2:3:4:5:6",
                        "2001:::1", "2001:db8::1::2", "fe80::1%eth0",
                        "::ffff:192.168.01.1", "::ffff:256.1.1.1"));

        valid.forEach((format, values) -> values.forEach(value ->
                assertTrue(format.isValid(value), () -> format + " should accept " + value)));
        invalid.forEach((format, values) -> values.forEach(value ->
                assertFalse(format.isValid(value), () -> format + " should reject " + value)));
    }

    @Test
    void validatesFormatsThroughLoadedSchema() throws IOException {
        Path schemaPath = write("formats.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.email]
                type = "string"
                format = "email"
                [elements.uuid]
                type = "string"
                format = "uuid"
                [elements.uri]
                type = "string"
                format = "uri"
                [elements.hostname]
                type = "string"
                format = "hostname"
                [elements.ipv4]
                type = "string"
                format = "ipv4"
                [elements.ipv6]
                type = "string"
                format = "ipv6"
                """);
        TomlSchema schema = TomlSchema.load(schemaPath);

        ValidationResult valid = schema.validate(write("valid.toml", """
                email = '"quoted local"@example.com'
                uuid = "550e8400-e29b-41d4-a716-446655440000"
                uri = "https://example.com/a%20path"
                hostname = "example.com."
                ipv4 = "192.0.2.1"
                ipv6 = "2001:db8::1"
                """));
        assertTrue(valid.isValid(), () -> valid.errors().toString());

        ValidationResult invalid = schema.validate(write("invalid.toml", """
                email = "two..dots@example.com"
                uuid = "not-a-uuid"
                uri = "../relative"
                hostname = "-example.com"
                ipv4 = "192.168.01.1"
                ipv6 = "2001:::1"
                """));
        assertEquals(6, invalid.errors().size(), () -> invalid.errors().toString());
        assertTrue(invalid.errors().stream().allMatch(error ->
                error.code().equals("format") && error.message().startsWith("does not match format ")));
    }

    @Test
    void rejectsUnknownAndInapplicableFormatsAtSchemaLoad() throws IOException {
        Path unknown = schemaWithDefinition("type = \"string\"\nformat = \"date\"");
        Path incompatible = schemaWithDefinition("type = \"integer\"\nformat = \"uuid\"");
        Path namedReference = write("named-format.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.text]
                type = "string"
                [elements.value]
                type = "types.text"
                format = "email"
                """);

        assertTrue(assertThrows(SchemaException.class, () -> TomlSchema.load(unknown))
                .getMessage().contains("Unsupported string format"));
        assertTrue(assertThrows(SchemaException.class, () -> TomlSchema.load(incompatible))
                .getMessage().contains("only define format when type is string"));
        assertThrows(SchemaException.class, () -> TomlSchema.load(namedReference));
    }

    @Test
    void formattedAllowedValuesAndDefaultsMustBeValid() throws IOException {
        Path allowed = schemaWithDefinition("""
                type = "string"
                format = "ipv4"
                allowedvalues = ["192.168.01.1"]
                """);
        Path defaulted = schemaWithDefinition("""
                type = "string"
                format = "email"
                default = "two..dots@example.com"
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(allowed));
        assertThrows(SchemaException.class, () -> TomlSchema.load(defaulted));
    }

    private Path schemaWithDefinition(String definition) throws IOException {
        return write("schema-" + Math.abs(definition.hashCode()) + ".tosd", """
                [toml-schema]
                version = "1.0.0"
                [elements.value]
                """ + definition);
    }

    private Path write(String name, String content) throws IOException {
        return Files.writeString(tempDir.resolve(name), content);
    }

    private static String longDomain(int length) {
        StringBuilder result = new StringBuilder();
        while (result.length() < length) {
            int remaining = length - result.length();
            int labelLength = Math.min(63, remaining);
            if (result.length() > 0) {
                result.append('.');
                remaining--;
                labelLength = Math.min(63, remaining);
            }
            result.append("a".repeat(labelLength));
        }
        return result.toString();
    }
}
