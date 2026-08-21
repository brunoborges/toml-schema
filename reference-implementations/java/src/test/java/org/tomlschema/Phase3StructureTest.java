package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Phase3StructureTest {
    @TempDir
    Path tempDir;

    @Test
    void loadsPureAllofMixin() throws IOException {
        TomlSchema schema = TomlSchema.load(write("pure-allof.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.named]
                type = "table"
                [types.named.name]
                type = "string"
                [types.packageBase]
                type = "table"
                [types.packageBase.version]
                type = "string"
                [types.package]
                allof = ["types.packageBase", "types.named"]
                dependentrequired = { name = ["version"] }
                [types.positive]
                type = "integer"
                min = 1
                [types.small]
                type = "integer"
                max = 10
                [types.count]
                allof = ["types.positive", "types.small"]
                [elements.pkg]
                type = "types.package"
                [elements.count]
                type = "types.count"
                """));
        assertTrue(schema.validate(write("valid.toml",
                "pkg = { name = \"x\", version = \"1\" }\ncount = 5\n")).isValid());
        assertFalse(schema.validate(write("invalid.toml",
                "pkg = { name = \"x\", version = \"1\" }\ncount = 0\n")).isValid());
    }

    @Test
    void rejectsMixedKindPureAllofAtLoad() throws IOException {
        Path schema = write("mixed-allof.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.aTable]
                type = "table"
                [types.aTable.x]
                type = "string"
                [types.anArray]
                type = "array"
                itemtype = "string"
                [types.bad]
                allof = ["types.aTable", "types.anArray"]
                [elements.value]
                type = "types.bad"
                """);
        assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
    }

    @Test
    void validatesInlineArrayPattern() throws IOException {
        TomlSchema schema = TomlSchema.load(write("array-pattern.tosd", """
                [toml-schema]
                version = "1.0.0"
                [elements.tags]
                type = "array"
                itemtype = "string"
                pattern = '^[a-z]+$'
                """));
        assertTrue(schema.validate(write("valid.toml", "tags = [\"alpha\", \"beta\"]\n")).isValid());
        assertFalse(schema.validate(write("invalid.toml", "tags = [\"alpha\", \"Beta\"]\n")).isValid());
    }

    @Test
    void validatesInlineCollectionMemberConstraints() throws IOException {
        TomlSchema schema = TomlSchema.load(write("collection-constraints.tosd", """
                [toml-schema]
                version = "1.0.0"
                [elements.ports]
                type = "collection"
                itemtype = "integer"
                min = 1
                max = 65535
                [elements.roles]
                type = "collection"
                itemtype = "string"
                allowedvalues = ["admin", "reader"]
                [elements.tags]
                type = "collection"
                itemtype = "string"
                pattern = '^[a-z]+@example\\.com$'
                [elements.emails]
                type = "collection"
                itemtype = "string"
                format = "email"
                """));
        assertTrue(schema.validate(write("valid.toml",
                "[ports]\nhttp = 80\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")).isValid());
        assertFalse(schema.validate(write("min-invalid.toml", "[ports]\nhttp = 0\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")).isValid());
        assertFalse(schema.validate(write("max-invalid.toml", "[ports]\nhttp = 70000\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")).isValid());
        assertFalse(schema.validate(write("allowed-invalid.toml", "[ports]\nhttp = 80\n[roles]\nowner = \"root\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"admin@example.com\"\n")).isValid());
        assertFalse(schema.validate(write("pattern-invalid.toml", "[ports]\nhttp = 80\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"Stable\"\n[emails]\nowner = \"admin@example.com\"\n")).isValid());
        assertFalse(schema.validate(write("format-invalid.toml", "[ports]\nhttp = 80\n[roles]\nowner = \"admin\"\n[tags]\nrelease = \"stable@example.com\"\n[emails]\nowner = \"not-an-email\"\n")).isValid());
    }

    @Test
    void rejectsDuplicateInlineAndItemtypeConstraintAtLoad() throws IOException {
        Path schema = write("duplicate-constraint.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.item]
                type = "integer"
                min = 0
                [elements.values]
                type = "array"
                itemtype = "types.item"
                min = -10
                """);
        assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
    }

    @Test
    void allowsInlineConstraintMatchingItemtypeAllofConstraint() throws IOException {
        TomlSchema schema = TomlSchema.load(write("inherited-constraint.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.mixin]
                type = "string"
                allowedvalues = ["a", "b"]
                [types.item]
                type = "string"
                allof = ["types.mixin"]
                [elements.values]
                type = "array"
                itemtype = "types.item"
                allowedvalues = ["b", "c"]
                """));
        assertTrue(schema.validate(write("intersection-valid.toml", "values = [\"b\"]\n")).isValid());
        assertFalse(schema.validate(write("inline-invalid.toml", "values = [\"a\"]\n")).isValid());
        assertFalse(schema.validate(write("inherited-invalid.toml", "values = [\"c\"]\n")).isValid());
    }

    private Path write(String name, String content) throws IOException {
        return Files.writeString(tempDir.resolve(name), content);
    }
}
