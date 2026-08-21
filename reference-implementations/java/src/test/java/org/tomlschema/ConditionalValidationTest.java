package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConditionalValidationTest {
    @TempDir
    Path tempDir;

    @Test
    void selectsEqualsBranchAndComposesWithAllOf() throws IOException {
        TomlSchema schema = load("""
                [types.base]
                type = "table"
                [types.base.engine]
                type = "string"

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

                [elements.database]
                if = { key = "engine", equals = "sqlite" }
                then = "types.sqlite"
                else = "types.server"
                allof = ["types.base"]
                """);

        assertTrue(schema.validate(write("sqlite.toml", """
                [database]
                engine = "sqlite"
                file = "data.db"
                """)).isValid());
        assertTrue(schema.validate(write("server.toml", """
                [database]
                engine = "postgresql"
                host = "db.example"
                """)).isValid());

        ValidationResult missingRequired = schema.validate(write("missing-file.toml", """
                [database]
                engine = "sqlite"
                """));
        assertFalse(missingRequired.isValid());
        assertTrue(missingRequired.errors().stream().anyMatch(error ->
                error.code().equals("missing-required") && error.path().equals("$.database.file")));

        ValidationResult branchUnknown = schema.validate(write("wrong-branch-key.toml", """
                [database]
                engine = "sqlite"
                host = "db.example"
                file = "data.db"
                """));
        assertFalse(branchUnknown.isValid());
        assertTrue(branchUnknown.errors().stream().anyMatch(error ->
                error.code().equals("unknown-key") && error.path().equals("$.database.host")));
    }

    @Test
    void selectsInBranchAndUsesElseWhenDiscriminatorIsMissing() throws IOException {
        TomlSchema schema = load("""
                [types.server]
                type = "table"
                [types.server.engine]
                type = "string"
                optional = true
                [types.server.host]
                type = "string"

                [types.embedded]
                type = "table"
                [types.embedded.engine]
                type = "string"
                optional = true
                [types.embedded.file]
                type = "string"

                [elements.database]
                if = { key = "engine", in = ["postgresql", "mysql"] }
                then = "types.server"
                else = "types.embedded"
                """);

        assertTrue(schema.validate(write("in.toml", """
                [database]
                engine = "mysql"
                host = "db.example"
                """)).isValid());
        assertTrue(schema.validate(write("missing-discriminator.toml", """
                [database]
                file = "local.db"
                """)).isValid());

        ValidationResult missingElseField = schema.validate(
                write("missing-else-field.toml", "[database]\n"));
        assertFalse(missingElseField.isValid());
        assertTrue(missingElseField.errors().stream().anyMatch(error ->
                error.code().equals("missing-required") && error.path().equals("$.database.file")));
    }

    @Test
    void declaredDiscriminatorDoesNotOpenSelectedClosedBranch() throws IOException {
        TomlSchema schema = load("""
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
                optional = true
                [types.server.host]
                type = "string"

                [elements.database]
                if = { key = "engine", equals = "sqlite" }
                then = "types.sqlite"
                else = "types.server"
                """);

        ValidationResult result = schema.validate(write("unknown-branch-key.toml", """
                [database]
                engine = "sqlite"
                file = "data.db"
                unexpected = true
                """));

        assertFalse(result.isValid());
        assertTrue(result.errors().stream().anyMatch(error ->
                error.code().equals("unknown-key") && error.path().equals("$.database.unexpected")));
    }

    @Test
    void conditionUsesTomlValueEqualityAndDoesNotTraverseKeyPaths() throws IOException {
        TomlSchema schema = load("""
                [types.match]
                type = "table"
                [types.match.mode]
                type = "integer"
                [types.match.selected]
                type = "boolean"
                [types.match."settings.mode"]
                type = "string"
                optional = true

                [types.other]
                type = "table"
                [types.other.mode]
                type = "integer"
                optional = true
                [types.other.fallback]
                type = "boolean"
                [types.other.settings]
                type = "table"
                optional = true
                [types.other.settings.mode]
                type = "string"
                [types.other."settings.mode"]
                type = "string"
                optional = true

                [elements.numeric]
                if = { key = "mode", equals = 1.0 }
                then = "types.match"
                else = "types.other"

                [elements.direct]
                if = { key = "settings.mode", equals = "on" }
                then = "types.match"
                else = "types.other"
                """);

        assertTrue(schema.validate(write("numeric-equality.toml", """
                [numeric]
                mode = 1
                selected = true

                [direct]
                fallback = true
                [direct.settings]
                mode = "on"
                """)).isValid());
    }

    @Test
    void selectsUsingAnEmptyDecodedKey() throws IOException {
        TomlSchema schema = load("""
                [types.emptyKey]
                type = "table"
                [types.emptyKey.""]
                type = "string"

                [types.other]
                type = "table"
                [types.other.""]
                type = "string"
                optional = true
                [types.other.fallback]
                type = "boolean"

                [elements.database]
                if = { key = "", equals = "sqlite" }
                then = "types.emptyKey"
                else = "types.other"
                """);

        assertTrue(schema.validate(write("empty-key.toml", """
                [database]
                "" = "sqlite"
                """)).isValid());
    }

    @Test
    void allowsConditionalKeywordNamesAsChildDefinitions() throws IOException {
        TomlSchema schema = load("""
                [elements.value.if]
                type = "string"
                [elements.value.then]
                type = "string"
                [elements.value.else]
                type = "string"
                """);

        assertTrue(schema.validate(write("keyword-children.toml", """
                [value]
                if = "condition"
                then = "first"
                else = "second"
                """)).isValid());
    }

    @Test
    void validatesConditionalCollectionBranches() throws IOException {
        TomlSchema schema = load("""
                [types.text]
                type = "string"

                [types.primary]
                type = "collection"
                itemtype = "types.text"
                [types.primary.kind]
                type = "string"

                [types.secondary]
                type = "collection"
                itemtype = "types.text"
                [types.secondary.kind]
                type = "string"
                optional = true

                [elements.labels]
                if = { key = "kind", equals = "primary" }
                then = "types.primary"
                else = "types.secondary"
                """);

        assertTrue(schema.validate(write("collection.toml", """
                [labels]
                kind = "primary"
                region = "west"
                """)).isValid());
    }

    @Test
    void selectsConditionalBranchesThatUseUnions() throws IOException {
        TomlSchema schema = load("""
                [types.file]
                type = "table"
                [types.file.scope]
                type = "string"
                [types.file.kind]
                type = "string"
                [types.file.path]
                type = "string"

                [types.memory]
                type = "table"
                [types.memory.scope]
                type = "string"
                [types.memory.kind]
                type = "string"
                [types.memory.capacity]
                type = "integer"

                [types.storage]
                anyof = ["types.file", "types.memory"]

                [types.remote]
                type = "table"
                [types.remote.scope]
                type = "string"
                [types.remote.kind]
                type = "string"
                [types.remote.host]
                type = "string"

                [elements.target]
                if = { key = "scope", equals = "local" }
                then = "types.storage"
                else = "types.remote"
                """);

        assertTrue(schema.validate(write("local-file.toml", """
                [target]
                scope = "local"
                kind = "file"
                path = "/data"
                """)).isValid());
        assertTrue(schema.validate(write("remote.toml", """
                [target]
                scope = "remote"
                kind = "remote"
                host = "example.test"
                """)).isValid());

        ValidationResult invalid = schema.validate(write("local-remote.toml", """
                [target]
                scope = "local"
                kind = "remote"
                host = "example.test"
                """));
        assertFalse(invalid.isValid());
        assertTrue(invalid.errors().stream().anyMatch(error ->
                error.code().equals("anyof") && error.path().equals("$.target")));
    }

    @Test
    void rejectsMalformedConditionalSchemas() {
        List<String> definitions = new ArrayList<>(List.of(
                "if = { key = \"engine\", equals = \"sqlite\" }\nthen = \"types.a\"",
                "if = { key = \"engine\", equals = \"sqlite\", in = [\"sqlite\"] }\n"
                        + "then = \"types.a\"\nelse = \"types.b\"",
                "if = { key = \"engine\" }\nthen = \"types.a\"\nelse = \"types.b\"",
                "if = { key = 42, equals = \"sqlite\" }\nthen = \"types.a\"\nelse = \"types.b\"",
                "if = { key = \"engine\", in = [] }\nthen = \"types.a\"\nelse = \"types.b\"",
                "if = { key = \"engine\", equals = \"sqlite\", extra = true }\n"
                        + "then = \"types.a\"\nelse = \"types.b\"",
                "if = { key = \"engine\", equals = \"sqlite\" }\nthen = \"table\"\nelse = \"types.b\"",
                "if = { key = \"engine\", equals = \"sqlite\" }\n"
                        + "then = \"types.missing\"\nelse = \"types.b\"",
                "type = \"table\"\nif = { key = \"engine\", equals = \"sqlite\" }\n"
                        + "then = \"types.a\"\nelse = \"types.b\"",
                "if = { key = \"engine\", equals = \"sqlite\" }\n"
                        + "then = \"types.a\"\nelse = \"types.b\"\nminlength = 1"));
        definitions.add("if = { key = \"engine\", equals = \"sqlite\" }\n"
                + "then = \"types.a\"\nelse = \"types.b\"\n"
                + "[elements.value.child]\ntype = \"string\"");

        for (int index = 0; index < definitions.size(); index++) {
            Path schema = writeUnchecked("malformed-" + index + ".tosd", schemaText("""
                    [types.a]
                    type = "table"
                    [types.b]
                    type = "table"
                    [elements.value]
                    %s
                    """.formatted(definitions.get(index))));
            assertThrows(SchemaException.class, () -> TomlSchema.load(schema), definitions.get(index));
        }
    }

    @Test
    void rejectsConditionalCyclesAndIncompatibleBranches() {
        List<String> schemas = List.of(
                """
                [types.a]
                if = { key = "kind", equals = "a" }
                then = "types.b"
                else = "types.c"
                [types.b]
                type = "types.a"
                [types.c]
                type = "table"
                [elements.value]
                type = "types.a"
                """,
                """
                [types.a]
                type = "table"
                [types.b]
                type = "string"
                [elements.value]
                if = { key = "kind", equals = "a" }
                then = "types.a"
                else = "types.b"
                """,
                """
                [types.item]
                type = "string"
                [types.a]
                type = "table"
                [types.b]
                type = "collection"
                itemtype = "types.item"
                [elements.value]
                if = { key = "kind", equals = "a" }
                then = "types.a"
                else = "types.b"
                """);

        for (int index = 0; index < schemas.size(); index++) {
            Path schema = writeUnchecked(
                    "invalid-semantics-" + index + ".tosd", schemaText(schemas.get(index)));
            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }
    }

    private TomlSchema load(String definitions) throws IOException {
        return TomlSchema.load(write("schema.tosd", schemaText(definitions)));
    }

    private String schemaText(String definitions) {
        return """
                [toml-schema]
                version = "1.0.0"

                %s
                """.formatted(definitions);
    }

    private Path write(String name, String content) throws IOException {
        Path path = tempDir.resolve(name);
        Files.writeString(path, content, StandardCharsets.UTF_8);
        return path;
    }

    private Path writeUnchecked(String name, String content) {
        try {
            return write(name, content);
        } catch (IOException error) {
            throw new AssertionError(error);
        }
    }
}
