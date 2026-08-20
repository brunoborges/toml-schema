package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ResolvedDuplicateReferencesTest {
    @TempDir
    Path tempDir;

    @Test
    void rejectsDuplicateCompositionReferencesByResolvedIdentity() throws IOException {
        for (String property : new String[]{"oneof", "anyof", "allof"}) {
            String localType = property.equals("allof") ? "type = \"string\"\n" : "";
            Path schemaPath = write(property + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [types.foo]
                    type = "string"

                    [elements.value]
                    %s%s = ["types.foo", "foo"]
                    """.formatted(localType, property));

            SchemaException error = assertThrows(SchemaException.class, () -> TomlSchema.load(schemaPath));
            assertEquals(
                    "elements.value " + property
                            + " contains duplicate type references \"types.foo\" and \"foo\"; both resolve to foo",
                    error.getMessage());
        }
    }

    @Test
    void allowsRepeatedTupleItemReferences() throws IOException {
        Path schemaPath = write("tuple.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.coordinate]
                type = "float"

                [elements.point]
                type = "array"
                items = ["types.coordinate", "types.coordinate"]
                """);
        Path documentPath = write("tuple.toml", "point = [1.0, 2.0]\n");

        ValidationResult result = TomlSchema.load(schemaPath).validate(documentPath);
        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    private Path write(String name, String content) throws IOException {
        return Files.writeString(tempDir.resolve(name), content);
    }
}
