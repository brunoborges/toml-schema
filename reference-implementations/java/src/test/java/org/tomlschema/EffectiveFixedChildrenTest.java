package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EffectiveFixedChildrenTest {
    @TempDir
    Path tempDir;

    @Test
    void siblingRulesUseOnlyDeterminateEffectiveFixedChildren() throws IOException {
        Path rejected = write("union-operands.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.left]
                type = "table"
                [types.left.first]
                type = "string"
                optional = true
                [types.right]
                type = "table"
                [types.right.second]
                type = "string"
                optional = true
                [types.choice]
                oneof = ["types.left", "types.right"]
                [elements.value]
                type = "table"
                allof = ["types.choice"]
                exactlyone = [["first", "second"]]
                """);
        SchemaException error = assertThrows(SchemaException.class, () -> TomlSchema.load(rejected));
        assertTrue(error.getMessage().contains("not an effective fixed child"), error::getMessage);

        Path accepted = write("type-selected-operands.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.base]
                type = "table"
                [types.base.first]
                type = "string"
                optional = true
                [types.base.second]
                type = "string"
                optional = true
                [types.indirect]
                type = "types.base"
                [elements.value]
                type = "table"
                allof = ["types.indirect"]
                exactlyone = [["first", "second"]]
                """);
        assertDoesNotThrow(() -> TomlSchema.load(accepted));
    }

    @Test
    void validationUsesSelectedUnionAndConditionalClosure() throws IOException {
        TomlSchema union = TomlSchema.load(write("union-closure.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.base]
                type = "table"
                [types.base.id]
                type = "integer"
                [types.named]
                type = "table"
                [types.named.name]
                type = "string"
                [types.labelled]
                type = "table"
                [types.labelled.label]
                type = "string"
                [types.identity]
                oneof = ["types.named", "types.labelled"]
                [elements.item]
                type = "table"
                allof = ["types.base", "types.identity"]
                [elements.item.enabled]
                type = "boolean"
                optional = true
                """));
        for (String document : new String[]{
                "[item]\nid = 1\nname = \"a\"\n",
                "[item]\nid = 1\nlabel = \"a\"\n",
                "[item]\nid = 1\nname = \"a\"\nenabled = true\n"}) {
            ValidationResult result = union.validate(write("valid-" + document.hashCode() + ".toml", document));
            assertTrue(result.isValid(), () -> result.errors().toString());
        }
        for (String document : new String[]{
                "[item]\nid = 1\nname = \"a\"\nlabel = \"a\"\n",
                "[item]\nid = 1\n"}) {
            ValidationResult result = union.validate(write("invalid-" + document.hashCode() + ".toml", document));
            assertFalse(result.isValid());
            assertTrue(result.errors().stream().anyMatch(error ->
                    error.path().equals("$.item") && error.message().contains("found 0")), result.errors().toString());
        }
        ValidationResult unexpected = union.validate(write(
                "bogus.toml", "[item]\nid = 1\nname = \"a\"\nbogus = true\n"));
        assertTrue(unexpected.errors().stream().anyMatch(error -> error.path().equals("$.item.bogus")));
        ValidationResult missing = union.validate(write("missing.toml", "[item]\nname = \"a\"\n"));
        assertTrue(missing.errors().stream().anyMatch(error -> error.path().equals("$.item.id")));

        TomlSchema conditional = TomlSchema.load(write("conditional-closure.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.common]
                type = "table"
                [types.common.id]
                type = "integer"
                [types.sqlite]
                type = "table"
                [types.sqlite.engine]
                type = "string"
                [types.sqlite.file]
                type = "string"
                [types.server]
                type = "table"
                [types.server.engine]
                type = "string"
                [types.server.host]
                type = "string"
                [types.database]
                if = { key = "engine", equals = "sqlite" }
                then = "types.sqlite"
                else = "types.server"
                allof = ["types.common"]
                [elements.composed]
                type = "table"
                allof = ["types.database"]
                """));
        ValidationResult composed = conditional.validate(write(
                "conditional.toml",
                "[composed]\nid = 2\nengine = \"postgresql\"\nhost = \"db.internal\"\n"));
        assertTrue(composed.isValid(), () -> composed.errors().toString());
    }

    @Test
    void openAlternativeDoesNotReopenComposedTable() throws IOException {
        TomlSchema schema = TomlSchema.load(write("open-union.tosd", """
                [toml-schema]
                version = "1.0.0"
                [types.base]
                type = "table"
                [types.base.name]
                type = "string"
                [types.open]
                type = "table"
                [types.closed]
                type = "table"
                [types.closed.known]
                type = "string"
                [types.identity]
                oneof = ["types.open", "types.closed"]
                [elements.item]
                type = "table"
                allof = ["types.base", "types.identity"]
                """));
        ValidationResult valid = schema.validate(write(
                "known.toml", "[item]\nname = \"a\"\nknown = \"x\"\n"));
        assertTrue(valid.isValid(), () -> valid.errors().toString());
        ValidationResult invalid = schema.validate(write(
                "arbitrary.toml", "[item]\nname = \"a\"\narbitrary = true\n"));
        assertTrue(invalid.errors().stream().anyMatch(error ->
                error.path().equals("$.item") && error.message().contains("found 0")));
    }

    private Path write(String name, String content) throws IOException {
        return Files.writeString(tempDir.resolve(name), content);
    }
}
