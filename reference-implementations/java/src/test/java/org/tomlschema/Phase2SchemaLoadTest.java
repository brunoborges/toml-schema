package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Phase2SchemaLoadTest {
    @TempDir
    Path tempDir;

    @Test
    void normalizesPrefixedBuiltinsBeforeSelectorClassification() throws IOException {
        Path valid = write("valid.tosd", """
                [toml-schema]
                version = "1.0.0"
                [elements.port]
                type = "types.integer"
                min = 1
                max = 65535
                """);
        assertDoesNotThrow(() -> TomlSchema.load(valid));

        Path invalid = write("types-any.tosd", """
                [toml-schema]
                version = "1.0.0"
                [elements.value]
                oneof = ["types.any"]
                """);
        assertThrows(SchemaException.class, () -> TomlSchema.load(invalid));
    }

    @Test
    void rejectsInvalidAndNonPortablePatternsAtSchemaLoad() throws IOException {
        String[][] cases = {
                {"invalid", "type = \"string\"\npattern = \"[\"", "invalid-pattern"},
                {"shorthand", "type = \"string\"\npattern = \"\\\\d+\"", "unsupported-pattern"},
                {"lookaround-key",
                        "type = \"collection\"\nitemtype = \"string\"\nkeypattern = \"(?=x)\"",
                        "unsupported-pattern"}
        };
        for (String[] test : cases) {
            Path schema = write(test[0] + ".tosd",
                    "[toml-schema]\nversion = \"1.0.0\"\n[elements.value]\n" + test[1] + "\n");
            SchemaException error =
                    assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
            assertTrue(error.getMessage().contains(test[2]), error.getMessage());
        }
    }

    @Test
    void loadsPortableCharacterEscapesAndEscapedMetacharacters() throws IOException {
        Path schema = write("portable-escapes.tosd", """
                [toml-schema]
                version = "1.0.0"
                [elements.whitespace]
                type = "string"
                pattern = '[ \\t]'
                [elements.controls]
                type = "string"
                pattern = '\\t\\n\\r\\f\\v\\a'
                [elements.dot]
                type = "string"
                pattern = '\\.'
                """);
        assertDoesNotThrow(() -> TomlSchema.load(schema));
    }

    @Test
    void rejectsClosedConditionalBranchesOmittingDiscriminator() throws IOException {
        for (String missing : new String[]{"then", "else"}) {
            String thenChild = missing.equals("then") ? "value" : "engine";
            String elseChild = missing.equals("else") ? "value" : "engine";
            Path schema = write(missing + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"
                    [types.selected]
                    type = "table"
                    [types.selected.%s]
                    type = "string"
                    [types.fallback]
                    type = "table"
                    [types.fallback.%s]
                    type = "string"
                    [elements.item]
                    if = { key = "engine", equals = "sqlite" }
                    then = "types.selected"
                    else = "types.fallback"
                    """.formatted(thenChild, elseChild));
            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }
    }

    @Test
    void rejectsNonTableConditionalDefaultAtSchemaLoad() throws IOException {
        Path schema = write("default.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.selected]
                type = "table"
                [types.fallback]
                type = "table"
                [elements.item]
                if = { key = "engine", equals = "sqlite" }
                then = "types.selected"
                else = "types.fallback"
                default = "sqlite"
                """);
        assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
    }

    private Path write(String name, String content) throws IOException {
        Path path = tempDir.resolve(name);
        Files.writeString(path, content);
        return path;
    }
}
