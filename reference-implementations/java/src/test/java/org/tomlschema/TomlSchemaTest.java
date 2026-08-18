package org.tomlschema;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
    void loadsCheckedInExamples() {
        for (String schema : List.of(
                "examples/cargo.tosd",
                "examples/gitlab-runner.tosd",
                "examples/hugo.tosd",
                "examples/netlify.tosd",
                "examples/pyproject.tosd",
                "examples/wrangler.tosd")) {
            assertDoesNotThrow(() -> TomlSchema.load(fixture(schema)), schema);
        }
    }

    @Test
    void validatesCargoManifestExample() throws IOException {
        ValidationResult result = TomlSchema.load(fixture("examples/cargo.tosd"))
                .validate(fixture("reference-implementations/rust/Cargo.toml"));

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void acceptsStringDescriptionsAndRejectsOtherValues() throws IOException {
        Path describedSchema = write("described.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.game]
                type = "table"
                description = "A game object."

                    [types.game.id]
                    type = "string"
                    description = "Unique identifier for the game."

                [elements.game]
                type = "array"
                description = "A list of games."
                itemtype = "types.game"
                """);
        Path invalidSchema = write("invalid-description.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.game]
                type = "string"
                description = 42
                """);

        assertDoesNotThrow(() -> TomlSchema.load(describedSchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(invalidSchema));
    }

    @Test
    void selfSchemaValidatesSchemaDocuments() throws IOException {
        TomlSchema schemaSchema = TomlSchema.load(fixture("toml-schema.tosd"));
        Path emptyElementsSchema = write("empty-elements.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements]
                """);

        assertTrue(schemaSchema.validate(fixture("config.tosd")).isValid());
        assertTrue(schemaSchema.validate(fixture("toml-schema.tosd")).isValid());
        assertTrue(schemaSchema.validate(emptyElementsSchema).isValid());
        for (String schema : List.of(
                "examples/cargo.tosd",
                "examples/gitlab-runner.tosd",
                "examples/hugo.tosd",
                "examples/netlify.tosd",
                "examples/pyproject.tosd",
                "examples/wrangler.tosd")) {
            ValidationResult result = schemaSchema.validate(fixture(schema));
            assertTrue(result.isValid(), () -> schema + ": " + result.errors());
        }
    }

    @Test
    void enforcesClosedRootElementSemantics() throws IOException {
        Path schemaPath = write("closed-root.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types]

                [elements]
                """);
        Path emptyDocument = write("empty.toml", "");
        Path metadataOnlyDocument = write("metadata-only.toml", """
                [toml-schema]
                location = "closed-root.tosd"
                """);
        Path applicationDocument = write("application.toml", "extra = true");
        Path definedRootSchema = write("defined-root.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.allowed]
                type = "string"
                """);
        Path documentWithExtraKey = write("extra-key.toml", """
                allowed = "value"
                extra = true
                """);
        TomlSchema schema = TomlSchema.load(schemaPath);

        assertTrue(schema.validate(emptyDocument).isValid());
        assertTrue(schema.validate(metadataOnlyDocument).isValid());

        ValidationResult emptyRootResult = schema.validate(applicationDocument);
        assertFalse(emptyRootResult.isValid());
        assertTrue(emptyRootResult.errors().stream()
                .anyMatch(error -> error.path().equals("$.extra") && error.message().equals("unexpected key")));

        ValidationResult definedRootResult = TomlSchema.load(definedRootSchema).validate(documentWithExtraKey);
        assertFalse(definedRootResult.isValid());
        assertTrue(definedRootResult.errors().stream()
                .anyMatch(error -> error.path().equals("$.extra") && error.message().equals("unexpected key")));
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

        for (String version : List.of("1", "1.0", "01.0.0", "1.2.0", "2.0.0")) {
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
    void patternMatchesUnanchored() throws IOException {
        Path schema = write("pattern-unanchored.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.id]
                type = "string"
                pattern = "\\\\d+"
                """);
        // "abc123" contains digits, so unanchored pattern "\d+" should match
        Path matchingDocument = write("pattern-unanchored-matching.toml", """
                id = "abc123"
                """);
        // "abcdef" contains no digits, so pattern "\d+" should not match
        Path nonMatchingDocument = write("pattern-unanchored-nonmatching.toml", """
                id = "abcdef"
                """);

        TomlSchema tomlSchema = TomlSchema.load(schema);

        assertTrue(tomlSchema.validate(matchingDocument).isValid(),
                "expected unanchored pattern to accept a superstring");
        ValidationResult noMatch = tomlSchema.validate(nonMatchingDocument);
        assertFalse(noMatch.isValid());
        assertTrue(noMatch.errors().stream().anyMatch(error -> error.path().equals("$.id")));
    }

    @Test
    void patternUsesRe2EndAnchorSemantics() throws IOException {
        Path schema = write("pattern-end-anchor.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "string"
                pattern = "^foo$"
                """);
        Path document = write("pattern-end-anchor.toml", """
                value = "foo\\n"
                """);

        assertFalse(TomlSchema.load(schema).validate(document).isValid());
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
    void rejectsRemovedTableCollectionAliasAsUnknownReference() throws IOException {
        Path schema = write("table-collection-alias.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.items]
                type = "table-collection"
                """);
        assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
    }

    @Test
    void validatesCollectionKeysAgainstKeyPattern() throws IOException {
        Path schema = write("keypattern.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.serverType]
                type = "table"

                    [types.serverType.ip]
                    type = "string"

                [elements.servers]
                type = "collection"
                itemtype = "types.serverType"
                keypattern = "^server_[0-9]+$"
                """);
        Path validDocument = write("keypattern-valid.toml", """
                [servers.server_01]
                ip = "10.0.0.1"

                [servers.server_02]
                ip = "10.0.0.2"
                """);
        Path invalidDocument = write("keypattern-invalid.toml", """
                [servers.server_01]
                ip = "10.0.0.1"

                [servers.alpha]
                ip = "10.0.0.2"
                """);

        TomlSchema tomlSchema = TomlSchema.load(schema);

        assertTrue(tomlSchema.validate(validDocument).isValid());
        ValidationResult invalidResult = tomlSchema.validate(invalidDocument);
        assertFalse(invalidResult.isValid());
        assertTrue(invalidResult.errors().stream()
                .anyMatch(error -> error.path().equals("$.servers.alpha")
                        && error.message().contains("keypattern")));
        assertTrue(invalidResult.errors().stream()
                .noneMatch(error -> error.path().equals("$.servers.server_01")));
    }

    @Test
    void rejectsRetiredTypeofProperty() throws IOException {
        Path schema = write("typeof.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.nameType]
                type = "string"

                [elements.name]
                typeof = "types.nameType"
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
    }

    @Test
    void allowsOptionalAndDescriptionOnNamedTypeReference() throws IOException {
        Path schema = write("named-reference-metadata.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.nameType]
                type = "string"
                pattern = "^[a-z]+$"

                [elements.name]
                type = "types.nameType"
                description = "Optional display name."
                optional = true
                """);
        Path document = write("named-reference-metadata.toml", "# name is optional\n");

        assertTrue(TomlSchema.load(schema).validate(document).isValid());
    }

    @Test
    void rejectsConstraintsAndChildrenOnNamedTypeReference() throws IOException {
        List<String> invalidSiblings = List.of(
                "itemtype = \"string\"",
                "items = [ \"string\" ]",
                "allowedvalues = [ \"name\" ]",
                "pattern = \"^[a-z]+$\"",
                "keypattern = \"^[a-z]+$\"",
                "min = 1",
                "max = 1",
                "minlength = 1",
                "maxlength = 1",
                "[elements.name.child]\ntype = \"string\""
        );

        for (String invalidSibling : invalidSiblings) {
            Path schema = write("named-reference-constraint.tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [types.nameType]
                    type = "string"

                    [elements.name]
                    type = "types.nameType"
                    %s
                    """.formatted(invalidSibling));

            SchemaException error = assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
            assertTrue(error.getMessage().contains("named type reference"), error::getMessage);
        }
    }

    @Test
    void rejectsRemovedArraytypeAsUnsupported() throws IOException {
        Path schema = write("removed-arraytype.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.values]
                type = "array"
                arraytype = "string"
                """);

        SchemaException error = assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        assertTrue(error.getMessage().contains("unsupported property: arraytype"), error::getMessage);
    }

    @Test
    void allowsItemtypeOnCollection() throws IOException {
        Path schema = write("collection-itemtype.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.stringItem]
                type = "string"

                [types.integerItem]
                type = "integer"

                [types.itemType]
                oneof = [ "types.stringItem", "types.integerItem" ]

                [elements.items]
                type = "collection"
                itemtype = "types.itemType"
                """);
        Path document = write("collection-itemtype.toml", """
                [items]
                name = "example"
                port = 8080
                """);

        assertTrue(TomlSchema.load(schema).validate(document).isValid());
    }

    @Test
    void rejectsBareCollectionAndAnyAlternativeReferences() throws IOException {
        List<String> invalidDefinitions = List.of(
                """
                type = "collection"
                """,
                """
                type = "types.collection"
                """,
                """
                type = "array"
                itemtype = "collection"
                """,
                """
                type = "array"
                items = [ "collection" ]
                """,
                """
                oneof = [ "collection", "string" ]
                """,
                """
                anyof = [ "collection", "string" ]
                """,
                """
                oneof = [ "any", "string" ]
                """,
                """
                anyof = [ "any", "string" ]
                """
        );

        for (int index = 0; index < invalidDefinitions.size(); index++) {
            Path schema = write("invalid-bare-reference-" + index + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [elements.value]
                    %s
                    """.formatted(invalidDefinitions.get(index)));

            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }
    }

    @Test
    void allowsAnyOutsideAlternativesAndNamedCollections() throws IOException {
        Path schema = write("valid-special-references.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.stringMap]
                type = "collection"
                itemtype = "string"

                [elements.direct]
                type = "any"

                [elements.values]
                type = "array"
                itemtype = "any"

                [elements.tuple]
                type = "array"
                items = [ "any" ]

                [elements.maps]
                type = "array"
                itemtype = "types.stringMap"
                """);
        Path document = write("valid-special-references.toml", """
                direct = { key = 1 }
                values = [ 1, "two" ]
                tuple = [ true ]
                maps = [ { one = "1", two = "2" } ]
                """);

        assertTrue(TomlSchema.load(schema).validate(document).isValid());
    }

    @Test
    void rejectsInvalidTypeSelectorCardinality() throws IOException {
        List<String> invalidDefinitions = List.of(
                """
                type = "string"
                oneof = [ "string", "integer" ]
                """,
                """
                type = "string"
                anyof = [ "string", "integer" ]
                """,
                """
                oneof = [ "string", "integer" ]
                anyof = [ "string", "integer" ]
                """,
                """
                description = "selector-less leaf"
                """
        );

        for (int index = 0; index < invalidDefinitions.size(); index++) {
            Path schema = write("invalid-type-selector-" + index + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [elements.value]
                    %s
                    """.formatted(invalidDefinitions.get(index)));

            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }
    }

    @Test
    void rejectsInvalidUnionStructureAndChildPlacement() throws IOException {
        List<String> invalidDefinitions = List.of(
                "oneof = []",
                "anyof = []",
                """
                oneof = [ "string" ]
                pattern = "x"
                """,
                """
                oneof = [ "string" ]

                [elements.value.child]
                type = "string"
                """,
                """
                type = "string"

                [elements.value.child]
                type = "string"
                """,
                """
                type = "array"

                [elements.value.child]
                type = "string"
                """
        );

        for (int index = 0; index < invalidDefinitions.size(); index++) {
            Path schema = write("invalid-structure-" + index + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [elements.value]
                    %s
                    """.formatted(invalidDefinitions.get(index)));

            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }
    }

    @Test
    void validatesReferenceGraphAtSchemaLoadTime() throws IOException {
        List<String> invalidReferences = List.of(
                "type = \"\"",
                "type = \"types.missing\"",
                """
                type = "array"
                itemtype = ""
                """,
                """
                type = "array"
                itemtype = "types.missing"
                """,
                """
                type = "array"
                items = [ "" ]
                """,
                """
                type = "array"
                items = [ "types.missing" ]
                """,
                "oneof = [ \"\" ]",
                "oneof = [ \"types.missing\" ]",
                "anyof = [ \"\" ]",
                "anyof = [ \"types.missing\" ]",
                """
                type = "table"

                [elements.value.child]
                type = "types.missing"
                """
        );
        for (int index = 0; index < invalidReferences.size(); index++) {
            Path schema = write("dangling-reference-" + index + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [elements.value]
                    %s
                    """.formatted(invalidReferences.get(index)));

            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }

        for (String cycle : List.of(
                """
                [types.first]
                type = "types.second"

                [types.second]
                type = "types.first"
                """,
                """
                [types.first]
                oneof = [ "types.second" ]

                [types.second]
                anyof = [ "types.first" ]
                """
        )) {
            Path schema = write("selector-cycle-" + cycle.hashCode() + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"
                    %s

                    [elements.value]
                    type = "string"
                    """.formatted(cycle));
            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }

        Path recursive = write("recursive-structure.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.node]
                type = "table"

                    [types.node.children]
                    type = "array"
                    itemtype = "types.node"

                [elements.root]
                type = "types.node"
                """);
        assertDoesNotThrow(() -> TomlSchema.load(recursive));
    }

    @Test
    void infersTableForSelectorlessDefinitionWithChildren() throws IOException {
        Path schema = write("implicit-table.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.parent]

                    [elements.parent.child]
                    type = "string"
                """);

        assertDoesNotThrow(() -> TomlSchema.load(schema));
    }

    @Test
    void rejectsKeyPatternOnNonCollection() throws IOException {
        Path schema = write("keypattern-scalar.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.name]
                type = "string"
                keypattern = "^[a-z]+$"
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
    }

    @Test
    void rejectsPatternOnNonStringType() throws IOException {
        Path patternSchema = write("pattern-integer.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "integer"
                pattern = "^[0-9]+$"
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(patternSchema));
    }

    @Test
    void rejectsInvalidKeyPatternRegex() throws IOException {
        Path schema = write("keypattern-invalid-regex.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.itemType]
                type = "table"

                    [types.itemType.value]
                    type = "string"

                [elements.items]
                type = "collection"
                itemtype = "types.itemType"
                keypattern = "["
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
    }

    @Test
    void rejectsOccurrenceAliases() throws IOException {
        Path minOccurs = write("minoccurs-alias.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.values]
                type = "array"
                itemtype = "string"
                minoccurs = 1
                """);
        Path maxOccurs = write("maxoccurs-alias.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.values]
                type = "array"
                itemtype = "string"
                maxoccurs = 2
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(minOccurs));
        assertThrows(SchemaException.class, () -> TomlSchema.load(maxOccurs));
    }

    @Test
    void requiresArrayItemsWhenItemtypeIsArray() throws IOException {
        Path schema = write("nested-arrays.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.nested]
                type = "array"
                itemtype = "array"

                [elements.mixed]
                type = "array"
                """);
        Path valid = write("valid-nested-arrays.toml", """
                nested = [[1, "two"], [true, false]]
                mixed = [1, "two", [true]]
                """);
        Path invalid = write("invalid-nested-arrays.toml", """
                nested = [[1], "not-an-array"]
                mixed = [1, "two", [true]]
                """);

        TomlSchema loadedSchema = TomlSchema.load(schema);

        ValidationResult validResult = loadedSchema.validate(valid);
        assertTrue(validResult.isValid(), () -> validResult.errors().toString());

        ValidationResult invalidResult = loadedSchema.validate(invalid);
        assertFalse(invalidResult.isValid());
        assertTrue(invalidResult.errors().stream().anyMatch(error -> error.path().equals("$.nested[1]")));
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
        Path withItemtype = write("tuple-itemtype-conflict.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "array"
                items = [ "types.coordinate", "types.label" ]
                itemtype = "string"
                """);
        Path withLength = write("tuple-length-conflict.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "array"
                items = [ "types.coordinate", "types.label" ]
                minlength = 2
                """);
        Path withAllowedValues = write("tuple-allowedvalues-conflict.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "array"
                items = [ "string", "integer" ]
                allowedvalues = []
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(withItemtype));
        assertThrows(SchemaException.class, () -> TomlSchema.load(withLength));
        assertThrows(SchemaException.class, () -> TomlSchema.load(withAllowedValues));
    }

    @Test
    void rejectsAllowedValuesOnTableAndCollection() throws IOException {
        for (String definition : List.of(
                "type = \"table\"\nallowedvalues = []",
                "type = \"collection\"\nitemtype = \"string\"\nallowedvalues = []"
        )) {
            Path schema = write("container-allowedvalues.tosd", """
                   [toml-schema]
                   version = "1.0.0"

                   [elements.value]
                   %s
                   """.formatted(definition));

            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }
    }

    @Test
    void supportsQuotedDottedEmptyAndSchemaKeywordTomlKeys() throws IOException {
        Path schema = write("special-keys.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.""]
                type = "string"

                [elements.children]
                type = "string"

                [elements.site."google.com"]
                type = "boolean"

                [elements.plugin.type]
                type = "string"

                [elements.plugin.default]
                type = "boolean"
                """);
        Path document = write("special-keys.toml", """
                "" = "blank"
                children = "literal"

                [site]
                "google.com" = true

                [plugin]
                type = "npm"
                default = true
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void quotesSpecialKeysInValidationErrorPaths() throws IOException {
        Path schema = write("special-key-error.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.site."google.com"]
                type = "boolean"
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
    void supportsBuiltInTypeReferences() throws IOException {
        Path schema = write("built-in-references.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.name]
                type = "string"

                [elements.flags]
                type = "array"
                itemtype = "boolean"

                [elements.tuple]
                type = "array"
                items = [ "string", "integer" ]

                [elements.identity]
                oneof = [ "string", "integer" ]

                [elements.flex]
                anyof = [ "string", "integer" ]
                """);
        Path document = write("built-in-references.toml", """
                name = "Alice"
                flags = [ true, false ]
                tuple = [ "port", 8080 ]
                identity = 42
                flex = "abc"
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
    }

    @Test
    void rejectsTypesNamedAfterBuiltIns() throws IOException {
        Path schema = write("reserved-built-in.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.string]
                type = "integer"

                [elements.value]
                type = "string"
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
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
                itemtype = "float"
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
    void preservesNumericPrecisionAndDefinesTemporalOrdering() throws IOException {
        Path schema = write("value-semantics.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.precise]
                type = "integer"
                allowedvalues = [ 9007199254740992 ]

                [elements.mixed]
                type = "integer"
                max = 9007199254740992.0

                [elements.nanValue]
                type = "float"
                allowedvalues = [ nan ]

                [elements.nanRange]
                type = "float"
                min = 0.0

                [elements.zero]
                type = "float"
                allowedvalues = [ -0.0 ]

                [elements.instant]
                type = "offset-date-time"
                min = 2024-01-01T00:00:00Z
                max = 2024-01-01T00:00:00Z

                [elements.instantMember]
                type = "offset-date-time"
                allowedvalues = [ 2024-01-01T00:00:00Z ]

                [elements.localMember]
                type = "local-time"
                allowedvalues = [ 12:00:00.1 ]

                [elements.localDateTime]
                type = "local-date-time"
                max = 2024-01-01T00:00:00.100

                [elements.localDate]
                type = "local-date"
                max = 2024-01-01

                [elements.localTime]
                type = "local-time"
                max = 12:00:00.100
                """);
        Path validDocument = write("value-semantics-valid.toml", """
                precise = 9007199254740992
                mixed = 9007199254740992
                nanValue = nan
                nanRange = 0.0
                zero = 0.0
                instant = 2023-12-31T19:00:00-05:00
                instantMember = 2024-01-01T00:00:00+00:00
                localMember = 12:00:00.100
                localDateTime = 2024-01-01T00:00:00.100
                localDate = 2024-01-01
                localTime = 12:00:00.100
                """);
        Path invalidDocument = write("value-semantics-invalid.toml", """
                precise = 9007199254740993
                mixed = 9007199254740993
                nanValue = 0.0
                nanRange = nan
                zero = 1.0
                instant = 2024-01-01T00:00:00.001Z
                instantMember = 2023-12-31T19:00:00-05:00
                localMember = 12:00:00.101
                localDateTime = 2024-01-01T00:00:00.101
                localDate = 2024-01-02
                localTime = 12:00:00.101
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult valid = loaded.validate(validDocument);
        assertTrue(valid.isValid(), () -> valid.errors().toString());

        ValidationResult invalid = loaded.validate(invalidDocument);
        for (String path : List.of(
                "$.precise", "$.mixed", "$.nanValue", "$.nanRange", "$.zero",
                "$.instant", "$.instantMember", "$.localMember",
                "$.localDateTime", "$.localDate", "$.localTime"
        )) {
            assertTrue(invalid.errors().stream().anyMatch(error -> error.path().equals(path)),
                    () -> "Expected error at " + path + ": " + invalid.errors());
        }

        Path malformedSchema = write("value-semantics-malformed.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "integer"
                allowedvalues = [ 9007199254740993 ]
                max = 9007199254740992.0
                """);
        assertThrows(SchemaException.class, () -> TomlSchema.load(malformedSchema));
    }

    @Test
    void appliesArrayRangesAndNamedItemConstraints() throws IOException {
        Path schema = write("array-member-boundaries.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.constrainedInteger]
                type = "integer"
                min = 0
                max = 100

                [elements.values]
                type = "array"
                itemtype = "types.constrainedInteger"
                min = -10
                max = 10
                """);
        Path validDocument = write("array-member-boundaries-valid.toml", "values = [ 0, 10 ]");
        Path invalidDocument = write("array-member-boundaries-invalid.toml", "values = [ -1, 11 ]");
        TomlSchema loaded = TomlSchema.load(schema);

        assertTrue(loaded.validate(validDocument).isValid());
        ValidationResult invalid = loaded.validate(invalidDocument);
        assertTrue(invalid.errors().stream().anyMatch(error ->
                error.path().equals("$.values[0]") && error.message().equals("value is less than min")));
        assertTrue(invalid.errors().stream().anyMatch(error ->
                error.path().equals("$.values[1]") && error.message().equals("value is greater than max")));
    }

    @Test
    void appliesArrayAllowedValuesWithoutItemtype() throws IOException {
        Path schema = write("array-allowedvalues.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.values]
                type = "array"
                allowedvalues = [ "red", "green", "blue" ]
                """);
        Path validDocument = write("array-allowedvalues-valid.toml", """
                values = [ "red", "blue" ]
                """);
        Path invalidDocument = write("array-allowedvalues-invalid.toml", """
                values = [ "red", "yellow" ]
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        assertTrue(loaded.validate(validDocument).isValid());
        ValidationResult invalid = loaded.validate(invalidDocument);
        assertEquals(1, invalid.errors().size());
        assertEquals("$.values[1]", invalid.errors().getFirst().path());
        assertEquals("value is not in allowedvalues", invalid.errors().getFirst().message());
    }

    @Test
    void rejectsArrayRangesForMixedItemAlternatives() throws IOException {
        Path schema = write("mixed-array-member-boundaries.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.numeric]
                oneof = [ "integer", "float" ]

                [elements.values]
                type = "array"
                itemtype = "types.numeric"
                min = 0
                """);

        SchemaException error = assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        assertTrue(error.getMessage().contains("itemtype resolves to one comparable built-in type"),
                error::getMessage);
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
        Path stringBoundarySchema = write("string-min.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "integer"
                min = "1"
                """);
        Path mismatchedTemporalSchema = write("date-time-min.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "local-date"
                min = 2026-01-01T00:00:00Z
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(anySchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(nanSchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(stringBoundarySchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(mismatchedTemporalSchema));
    }

    @Test
    void rejectsMalformedLengthSchemas() throws IOException {
        Path negativeLengthSchema = write("negative-minlength.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "string"
                minlength = -1
                """);
        Path negativeMaxLengthSchema = write("negative-maxlength.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "string"
                maxlength = -1
                """);
        Path invertedLengthSchema = write("inverted-length.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "string"
                minlength = 5
                maxlength = 2
                """);
        Path incompatibleLengthSchema = write("boolean-length.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "boolean"
                minlength = 1
                """);

        assertThrows(SchemaException.class, () -> TomlSchema.load(negativeLengthSchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(negativeMaxLengthSchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(invertedLengthSchema));
        assertThrows(SchemaException.class, () -> TomlSchema.load(incompatibleLengthSchema));
    }

    @Test
    void enforcesConstraintsOnScalarAllowedValuesAtSchemaLoadTime() throws IOException {
        List<String> malformedDefinitions = List.of(
                """
                type = "string"
                allowedvalues = [ "valid", "INVALID" ]
                pattern = "^[a-z]+$"
                """,
                """
                type = "integer"
                allowedvalues = [ 1, 2 ]
                min = 2
                """,
                """
                type = "integer"
                allowedvalues = [ 2, 3 ]
                max = 2
                """,
                """
                type = "string"
                allowedvalues = [ "a", "ok" ]
                minlength = 2
                """,
                """
                type = "string"
                allowedvalues = [ "ok", "long" ]
                maxlength = 2
                """
        );

        for (int i = 0; i < malformedDefinitions.size(); i++) {
            Path schema = write("invalid-allowedvalues-" + i + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [elements.value]
                    """ + malformedDefinitions.get(i));
            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }

        Path schema = write("valid-allowedvalues.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.value]
                type = "string"
                allowedvalues = [ "ab", "cd" ]
                pattern = "^[a-z]+$"
                minlength = 2
                maxlength = 2
                """);
        Path validDocument = write("valid-allowedvalues.toml", "value = \"ab\"");
        Path invalidDocument = write("invalid-allowedvalues.toml", "value = \"ef\"");
        TomlSchema loaded = assertDoesNotThrow(() -> TomlSchema.load(schema));

        assertTrue(loaded.validate(validDocument).isValid());
        ValidationResult invalid = loaded.validate(invalidDocument);
        assertEquals(1, invalid.errors().size());
        assertEquals("value is not in allowedvalues", invalid.errors().getFirst().message());
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
    void cliResolvesRelativeSchemaLocationFromDocumentDirectory() throws IOException {
        Path schemaDirectory = Files.createDirectories(tempDir.resolve("schemas"));
        Files.writeString(schemaDirectory.resolve("schema.tosd"), """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """, StandardCharsets.UTF_8);
        Path documentDirectory = Files.createDirectories(tempDir.resolve("documents"));
        Path document = documentDirectory.resolve("document.toml");
        Files.writeString(document, """
                title = "Example"

                [toml-schema]
                version = "1.0.0"
                location = "../schemas/schema.tosd"
                """, StandardCharsets.UTF_8);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"validate", document.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(0, exitCode, err::toString);
        assertTrue(out.toString(StandardCharsets.UTF_8).contains("is valid"));
        assertEquals("", err.toString(StandardCharsets.UTF_8));
    }

    @Test
    void cliAllowsDocumentSchemaVersionToBeOmitted() throws IOException {
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
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"validate", document.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(0, exitCode, err::toString);
        assertEquals("", err.toString(StandardCharsets.UTF_8));
    }

    @Test
    void cliRejectsNonScalarSchemaReferenceMetadata() throws IOException {
        Path document = write("document.toml", """
                [toml-schema]
                location = ["schema.tosd"]
                """);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"validate", document.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(2, exitCode);
        assertTrue(err.toString(StandardCharsets.UTF_8).contains("must be a scalar value"));
    }

    @Test
    void cliWarnsOnNonMajorDocumentSchemaVersionMismatch() throws IOException {
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
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"validate", document.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(0, exitCode, err::toString);
        assertTrue(err.toString(StandardCharsets.UTF_8).contains(
                "Warning: document expects TOML Schema version 1.0.0, but resolved schema uses 1.0.1"));
    }

    @Test
    void cliRejectsMajorDocumentSchemaVersionMismatch() throws IOException {
        write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                version = "2.0.0"
                location = "schema.tosd"
                """);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"validate", document.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(2, exitCode);
        assertTrue(err.toString(StandardCharsets.UTF_8).contains(
                "Document expects TOML Schema major version 2.0.0, but resolved schema uses 1.0.0"));
    }

    @Test
    void cliRejectsMalformedDocumentSchemaVersions() throws IOException {
        write("schema.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.title]
                type = "string"
                """);
        Path shorthandDocument = write("shorthand.toml", """
                title = "Example"

                [toml-schema]
                version = "1.0"
                location = "schema.tosd"
                """);
        Path nonStringDocument = write("non-string.toml", """
                title = "Example"

                [toml-schema]
                version = 1
                location = "schema.tosd"
                """);

        for (Path document : List.of(shorthandDocument, nonStringDocument)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ByteArrayOutputStream err = new ByteArrayOutputStream();

            int exitCode = TomlSchemaCli.run(
                    new String[]{"validate", document.toString()},
                    new PrintStream(out, true, StandardCharsets.UTF_8),
                    new PrintStream(err, true, StandardCharsets.UTF_8));

            assertEquals(2, exitCode);
            assertTrue(err.toString(StandardCharsets.UTF_8).contains("Document [toml-schema].version must"));
        }
    }

    @Test
    void cliRejectsMalformedSchemaReferenceMetadata() throws IOException {
        Path nonTableMetadata = write("non-table-metadata.toml", """
                title = "Example"
                toml-schema = "schema.tosd"
                """);
        Path nonStringLocation = write("non-string-location.toml", """
                title = "Example"

                [toml-schema]
                location = 1
                """);

        for (Path document : List.of(nonTableMetadata, nonStringLocation)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ByteArrayOutputStream err = new ByteArrayOutputStream();

            int exitCode = TomlSchemaCli.run(
                    new String[]{"validate", document.toString()},
                    new PrintStream(out, true, StandardCharsets.UTF_8),
                    new PrintStream(err, true, StandardCharsets.UTF_8));

            assertEquals(2, exitCode);
            assertTrue(err.toString(StandardCharsets.UTF_8).contains("Document"));
        }
    }

    @Test
    void cliRejectsUnsupportedSchemaLocationUriScheme() throws IOException {
        Path document = write("document.toml", """
                title = "Example"

                [toml-schema]
                location = "https://example.com/schema.tosd"
                """);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"validate", document.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(2, exitCode);
        assertTrue(err.toString(StandardCharsets.UTF_8).contains(
                "Unsupported schema location URI scheme: https"));
    }

    @Test
    void cliRejectsOpaqueFileSchemaLocationUri() throws IOException {
        for (String location : List.of(
                "file:schema.tosd",
                tempDir.resolve("schema.tosd").toUri() + "?version=1")) {
            Path document = write("invalid-file-uri.toml", """
                    title = "Example"

                    [toml-schema]
                    location = "%s"
                    """.formatted(location));
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ByteArrayOutputStream err = new ByteArrayOutputStream();

            int exitCode = TomlSchemaCli.run(
                    new String[]{"validate", document.toString()},
                    new PrintStream(out, true, StandardCharsets.UTF_8),
                    new PrintStream(err, true, StandardCharsets.UTF_8));

            assertEquals(2, exitCode);
            assertTrue(err.toString(StandardCharsets.UTF_8).contains("Invalid file schema location"));
        }
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
        assertTrue(schemaText.contains("itemtype = \"integer\""));
        assertFalse(schemaText.contains("arraytype"));
        assertTrue(schemaText.contains("[elements.owner]"));
        assertTrue(schemaText.contains("[elements.owner.name]"));
        assertFalse(schemaText.contains("[elements.toml-schema]"));

        ValidationResult validationResult = TomlSchema.load(extractedSchema).validate(document);
        assertTrue(validationResult.isValid(), () -> validationResult.errors().toString());
    }

    @Test
    void validatesWebsiteExamples() throws IOException {
        String page = Files.readString(fixture("docs/index.html"), StandardCharsets.UTF_8);
        Pattern codeBlock = Pattern.compile("<pre><code>(.*?)</code></pre>", Pattern.DOTALL);

        Matcher hero = Pattern.compile("<aside class=\"panel\".*?</aside>", Pattern.DOTALL).matcher(page);
        assertTrue(hero.find(), "Website hero example is missing");
        Matcher heroCode = codeBlock.matcher(hero.group());
        assertTrue(heroCode.find(), "Website hero schema is missing");

        Path heroSchema = write("website-hero.tosd", heroCode.group(1));
        Path heroDocument = write("website-hero.toml", """
                title = "Example"

                [database]
                enabled = true
                ports = [8000, 8001]
                """);
        ValidationResult heroResult = TomlSchema.load(heroSchema).validate(heroDocument);
        assertTrue(heroResult.isValid(), () -> heroResult.errors().toString());

        Matcher tour = Pattern.compile(
                "<section class=\"section\" id=\"tour\">(.*?)</section>",
                Pattern.DOTALL
        ).matcher(page);
        assertTrue(tour.find(), "Website tour is missing");

        Matcher tourCode = codeBlock.matcher(tour.group(1));
        StringBuilder assembledSchema = new StringBuilder();
        while (tourCode.find()) {
            assembledSchema.append(tourCode.group(1)).append(System.lineSeparator()).append(System.lineSeparator());
        }

        Path tourSchema = write("website-tour.tosd", assembledSchema.toString());
        Path tourDocument = write("website-tour.toml", """
                title = "Example"
                environment = "prod"
                retries = 3

                [database]
                enabled = true
                ports = [8000, 8001]

                [servers.primary]
                ip = "10.0.0.1"
                role = "frontend"
                """);
        ValidationResult tourResult = TomlSchema.load(tourSchema).validate(tourDocument);
        assertTrue(tourResult.isValid(), () -> tourResult.errors().toString());
    }

    @Test
    void validatesDirectSiblingPresenceRules() throws IOException {
        Path schema = write("presence-rules.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.source]
                type = "table"
                dependentrequired = { branch = ["git"], tag = ["git"] }
                mutuallyexclusive = [["git", "path"], ["branch", "tag"]]
                exactlyone = [["git", "path"]]

                [elements.source.git]
                type = "string"
                optional = true
                [elements.source.path]
                type = "string"
                optional = true
                [elements.source.branch]
                type = "string"
                optional = true
                [elements.source.tag]
                type = "string"
                optional = true
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        assertTrue(loaded.validate(write("presence-valid.toml", """
                [source]
                git = "url"
                branch = "main"
                """)).isValid());
        ValidationResult missingDependency = loaded.validate(write("presence-missing.toml", """
                [source]
                branch = "main"
                """));
        assertTrue(missingDependency.errors().stream()
                .anyMatch(error -> error.code().equals("dependentrequired")));
        ValidationResult exclusive = loaded.validate(write("presence-exclusive.toml", """
                [source]
                git = "url"
                path = "."
                """));
        assertTrue(exclusive.errors().stream()
                .anyMatch(error -> error.code().equals("mutuallyexclusive")));
    }

    @Test
    void composesDefinitionsConjunctivelyWithUnionClosure() throws IOException {
        Path schema = write("allof.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.base]
                type = "table"
                [types.base.name]
                type = "string"
                minlength = 2

                [types.extension]
                type = "table"
                [types.extension.name]
                type = "string"
                maxlength = 4
                [types.extension.enabled]
                type = "boolean"

                [elements.value]
                type = "table"
                allof = ["types.base", "types.extension"]
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        assertTrue(loaded.validate(write("allof-valid.toml", """
                [value]
                name = "abc"
                enabled = true
                """)).isValid());
        ValidationResult invalid = loaded.validate(write("allof-invalid.toml", """
                [value]
                name = "toolong"
                enabled = true
                """));
        assertTrue(invalid.errors().stream()
                .anyMatch(error -> error.code().equals("maxlength")));
    }

    @Test
    void keepsStructuralKeysInEveryUnionBranchClosure() throws IOException {
        Path schema = write("composed-union-closure.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.base]
                type = "table"
                [types.base.name]
                type = "string"

                [types.withName]
                type = "table"
                [types.withName.name]
                type = "string"
                [types.withName.git]
                type = "string"

                [types.plain]
                type = "table"
                [types.plain.path]
                type = "string"

                [types.identity]
                oneof = ["types.withName", "types.plain"]

                [elements.element]
                type = "table"
                allof = ["types.base", "types.identity"]
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult shared = loaded.validate(write("composed-union-shared.toml", """
                [element]
                name = "alpha"
                path = "./src"
                """));
        assertTrue(shared.isValid(), () -> shared.errors().toString());

        ValidationResult owned = loaded.validate(write("composed-union-owned.toml", """
                [element]
                name = "alpha"
                git = "https://example.invalid/repo.git"
                """));
        assertTrue(owned.isValid(), () -> owned.errors().toString());

        ValidationResult mixed = loaded.validate(write("composed-union-mixed.toml", """
                [element]
                name = "alpha"
                git = "https://example.invalid/repo.git"
                path = "./src"
                """));
        assertFalse(mixed.isValid());
        assertTrue(mixed.errors().stream().anyMatch(error -> error.code().equals("oneof")));

        ValidationResult missing = loaded.validate(write("composed-union-missing.toml", """
                [element]
                path = "./src"
                """));
        assertFalse(missing.isValid());
        assertTrue(missing.errors().stream().anyMatch(error ->
                error.code().equals("required") && error.path().equals("$.element.name")));
    }

    @Test
    void keepsSiblingAlternativesExclusiveInAnyofClosure() throws IOException {
        Path schema = write("composed-anyof-closure.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.base]
                type = "table"
                [types.base.name]
                type = "string"

                [types.withName]
                type = "table"
                [types.withName.name]
                type = "string"
                [types.withName.git]
                type = "string"

                [types.plain]
                type = "table"
                [types.plain.path]
                type = "string"

                [types.identity]
                anyof = ["types.withName", "types.plain"]

                [elements.element]
                type = "table"
                allof = ["types.base", "types.identity"]
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult shared = loaded.validate(write("composed-anyof-shared.toml", """
                [element]
                name = "alpha"
                path = "./src"
                """));
        assertTrue(shared.isValid(), () -> shared.errors().toString());

        ValidationResult mixed = loaded.validate(write("composed-anyof-mixed.toml", """
                [element]
                name = "alpha"
                git = "https://example.invalid/repo.git"
                path = "./src"
                """));
        assertFalse(mixed.isValid());
        assertTrue(mixed.errors().stream().anyMatch(error -> error.code().equals("anyof")));
    }

    @Test
    void resolvesClosureProvenanceThroughNestedComposition() throws IOException {
        Path schema = write("nested-union-closure.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.base]
                type = "table"
                [types.base.name]
                type = "string"

                [types.core]
                type = "table"
                [types.core.id]
                type = "string"

                [types.remote]
                type = "table"
                [types.remote.url]
                type = "string"
                [types.remote.name]
                type = "string"

                [types.local]
                type = "table"
                [types.local.dir]
                type = "string"
                [types.local.id]
                type = "string"

                [types.locationChoice]
                oneof = ["types.remote", "types.local"]

                [types.detailed]
                type = "table"
                allof = ["types.core", "types.locationChoice"]

                [types.simple]
                type = "table"
                [types.simple.alias]
                type = "string"

                [types.sourceChoice]
                oneof = ["types.detailed", "types.simple"]

                [types.composedSource]
                type = "table"
                allof = ["types.base", "types.sourceChoice"]

                [elements.source]
                type = "types.composedSource"
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult nested = loaded.validate(write("nested-union-valid.toml", """
                [source]
                name = "alpha"
                id = "core-1"
                url = "https://example.invalid/repo.git"
                """));
        assertTrue(nested.isValid(), () -> nested.errors().toString());

        ValidationResult simple = loaded.validate(write("nested-union-simple.toml", """
                [source]
                name = "alpha"
                alias = "a"
                """));
        assertTrue(simple.isValid(), () -> simple.errors().toString());

        ValidationResult mixed = loaded.validate(write("nested-union-mixed.toml", """
                [source]
                name = "alpha"
                id = "core-1"
                url = "https://example.invalid/repo.git"
                dir = "./src"
                """));
        assertFalse(mixed.isValid());
        assertTrue(mixed.errors().stream().anyMatch(error -> error.code().equals("oneof")));
    }

    @Test
    void closesOpenTableAlternativesWhenCompositionDefinesChildren() throws IOException {
        Path schema = write("composed-open-union.tosd", """
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

                [types.choice]
                anyof = ["types.open", "types.closed"]
                allof = ["types.base"]

                [elements.element]
                type = "types.choice"
                """);

        TomlSchema loaded = TomlSchema.load(schema);
        ValidationResult valid = loaded.validate(write("composed-open-union-valid.toml", """
                [element]
                name = "alpha"
                """));
        assertTrue(valid.isValid(), () -> valid.errors().toString());

        ValidationResult result = loaded.validate(write("composed-open-union.toml", """
                [element]
                name = "alpha"
                arbitrary = true
                """));

        assertFalse(result.isValid());
        assertTrue(result.errors().stream().anyMatch(error -> error.code().equals("anyof")));
    }

    @Test
    void enforcesRecursiveUniqueItemsEquality() throws IOException {
        Path schema = write("unique.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.values]
                type = "array"
                itemtype = "any"
                uniqueitems = true
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult numeric = loaded.validate(write(
                "unique-numeric.toml", "values = [1, 1.0]\n"));
        assertTrue(numeric.errors().stream()
                .anyMatch(error -> error.code().equals("uniqueitems")));
        ValidationResult tables = loaded.validate(write("unique-tables.toml", """
                values = [{ a = 1, b = [2] }, { b = [2.0], a = 1.0 }]
                """));
        assertTrue(tables.errors().stream()
                .anyMatch(error -> error.code().equals("uniqueitems")));
    }

    @Test
    void validatesAndExposesEffectiveDefaultsWithoutApplyingThem() throws IOException {
        Path schema = write("defaults.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.name]
                type = "string"
                default = "inherited"

                [types.settings]
                type = "table"
                default = { enabled = true }
                [types.settings.enabled]
                type = "boolean"

                [elements.inherited]
                type = "types.name"
                optional = true

                [elements.local]
                type = "types.name"
                optional = true
                default = "local"

                [elements.settings]
                type = "types.settings"
                optional = true

                [elements.required]
                type = "string"
                default = "not inserted"
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        assertEquals("inherited", loaded.defaultValue("inherited").orElseThrow());
        assertEquals("local", loaded.defaultValue("local").orElseThrow());
        assertTrue(loaded.defaultValue("settings").orElseThrow() instanceof org.tomlj.TomlTable);
        ValidationResult result = loaded.validate(write("defaults.toml", ""));
        assertFalse(result.isValid());
        assertTrue(result.errors().stream()
                .anyMatch(error -> error.path().equals("$.required")));
    }

    @Test
    void reportsDeduplicatedWarningsOnlyFromSuccessfulAlternatives() throws IOException {
        Path schema = write("deprecated.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.oldString]
                type = "string"
                deprecated = true

                [types.oldInteger]
                type = "integer"
                deprecated = true

                [elements.value]
                anyof = ["types.oldString", "string", "types.oldInteger"]
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult result = loaded.validate(write("deprecated.toml", "value = \"old\"\n"));
        assertTrue(result.isValid());
        assertEquals(1, result.warnings().size());
        assertEquals(DiagnosticSeverity.WARNING, result.warnings().getFirst().severity());
        assertEquals("deprecated", result.warnings().getFirst().code());
        assertEquals("$.value", result.warnings().getFirst().path());
    }

    @Test
    void dropsBranchWarningsWhenALaterAllofComponentFails() throws IOException {
        Path schema = write("union-allof-deprecated.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.legacyName]
                type = "string"
                pattern = "^old-"
                deprecated = true

                [types.modernName]
                type = "string"
                pattern = "^new-"

                [types.shortName]
                type = "string"
                maxlength = 8

                [elements.name]
                oneof = ["types.legacyName", "types.modernName"]
                allof = ["types.shortName"]
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult result = loaded.validate(
                write("union-allof-deprecated.toml", "name = \"old-name-is-too-long\"\n"));

        assertFalse(result.isValid());
        assertEquals(1, result.errors().size());
        assertEquals("maxlength", result.errors().getFirst().code());
        assertEquals("$.name", result.errors().getFirst().path());
        assertTrue(result.warnings().isEmpty());

        ValidationResult accepted = loaded.validate(
                write("union-allof-deprecated-valid.toml", "name = \"old-tag\"\n"));

        assertTrue(accepted.isValid());
        assertEquals(1, accepted.warnings().size());
        assertEquals("deprecated", accepted.warnings().getFirst().code());
        assertEquals("$.name", accepted.warnings().getFirst().path());
    }

    @Test
    void keepsDescendantBranchWarningsWhenALaterAllofComponentFails() throws IOException {
        Path schema = write("union-descendant-warning.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.legacySection]
                type = "table"
                deprecated = true

                [types.legacySection.name]
                type = "string"
                deprecated = true

                [types.modernSection]
                type = "table"

                [types.modernSection.title]
                type = "string"

                [types.counted]
                type = "table"

                [types.counted.count]
                type = "integer"

                [elements.section]
                oneof = ["types.legacySection", "types.modernSection"]
                allof = ["types.counted"]
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult result = loaded.validate(write("union-descendant-warning.toml", """
                [section]
                name = "old"
                """));

        assertFalse(result.isValid());
        assertEquals(1, result.errors().size());
        assertEquals("required", result.errors().getFirst().code());
        assertEquals("$.section.count", result.errors().getFirst().path());
        assertEquals(List.of("$.section.name"),
                result.warnings().stream().map(ValidationWarning::path).toList());

        ValidationResult accepted = loaded.validate(write("union-descendant-warning-valid.toml", """
                [section]
                name = "old"
                count = 1
                """));

        assertTrue(accepted.isValid());
        assertEquals(List.of("$.section.name", "$.section"),
                accepted.warnings().stream().map(ValidationWarning::path).toList());
    }

    @Test
    void keepsBranchWarningsOfValidNodesWhenSiblingNodesFail() throws IOException {        Path schema = write("union-sibling-warning.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.legacyName]
                type = "string"
                pattern = "^old-"
                deprecated = true

                [types.modernName]
                type = "string"
                pattern = "^new-"

                [elements.section]
                type = "table"

                [elements.section.name]
                oneof = ["types.legacyName", "types.modernName"]

                [elements.section.count]
                type = "integer"
                """);
        TomlSchema loaded = TomlSchema.load(schema);

        ValidationResult result = loaded.validate(write("union-sibling-warning.toml", """
                [section]
                name = "old-tag"
                count = "not an integer"
                """));

        assertFalse(result.isValid());
        assertEquals(1, result.errors().size());
        assertEquals("$.section.count", result.errors().getFirst().path());
        assertEquals(1, result.warnings().size());
        assertEquals("deprecated", result.warnings().getFirst().code());
        assertEquals("$.section.name", result.warnings().getFirst().path());
    }

    @Test
    void rejectsMalformedFeatureSchemas() throws IOException {
        List<String> definitions = List.of(
                "type = \"table\"\ndependentrequired = {}",
                "type = \"table\"\nmutuallyexclusive = []",
                "type = \"table\"\nexactlyone = [[\"a\", \"a\"]]",
                "type = \"array\"\nuniqueitems = \"yes\"",
                "type = \"string\"\nallof = [\"integer\"]",
                "type = \"string\"\ndefault = 1");
        for (int i = 0; i < definitions.size(); i++) {
            Path schema = write("malformed-1-0-" + i + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [elements.value]
                    %s
                    """.formatted(definitions.get(i)));
            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }
    }

    @Test
    void rejectsInvalidCompositionRulesAndDefaultConflicts() throws IOException {
        List<String> schemas = List.of(
                """
                [types.base]
                type = "table"
                [elements.value]
                type = "table"
                allof = ["types.missing"]
                """,
                """
                [types.a]
                type = "table"
                allof = ["types.b"]
                [types.b]
                type = "table"
                allof = ["types.a"]
                [elements.value]
                type = "types.a"
                """,
                """
                [elements.value]
                type = "table"
                dependentrequired = { a = ["missing"] }
                [elements.value.a]
                type = "string"
                optional = true
                """,
                """
                [types.a]
                type = "string"
                default = "a"
                [types.b]
                type = "string"
                default = "b"
                [elements.value]
                type = "string"
                allof = ["types.a", "types.b"]
                """);
        for (int i = 0; i < schemas.size(); i++) {
            Path schema = write("invalid-composition-" + i + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    %s
                    """.formatted(schemas.get(i)));
            assertThrows(SchemaException.class, () -> TomlSchema.load(schema));
        }
    }

    @Test
    void cliKeepsWarningOnlyValidationSuccessful() throws IOException {
        Path schema = write("cli-warning.tosd", """
                [toml-schema]
                version = "1.0.0"

                [elements.old]
                type = "string"
                deprecated = true
                """);
        Path document = write("cli-warning.toml", "old = \"value\"\n");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int exitCode = TomlSchemaCli.run(
                new String[]{"validate", schema.toString(), document.toString()},
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));

        assertEquals(0, exitCode);
        assertTrue(out.toString(StandardCharsets.UTF_8).contains("is valid"));
        assertTrue(err.toString(StandardCharsets.UTF_8).contains("Warning:"));
    }

    @Test
    void rejectsAssertionKeywordsBesideNamedReferencesAndUnionSelectors() throws IOException {
        List<String> assertions = List.of(
                "dependentrequired = { a = [\"b\"] }",
                "mutuallyexclusive = [[\"a\", \"b\"]]",
                "exactlyone = [[\"a\", \"b\"]]",
                "uniqueitems = true");
        for (int i = 0; i < assertions.size(); i++) {
            Path namedReferenceSchema = write("named-reference-assertion-" + i + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [types.base]
                    type = "string"

                    [elements.value]
                    type = "types.base"
                    %s
                    """.formatted(assertions.get(i)));
            SchemaException namedReferenceError =
                    assertThrows(SchemaException.class, () -> TomlSchema.load(namedReferenceSchema));
            assertTrue(namedReferenceError.getMessage().contains("named type reference"));

            Path unionSchema = write("union-assertion-" + i + ".tosd", """
                    [toml-schema]
                    version = "1.0.0"

                    [elements.value]
                    oneof = ["string", "integer"]
                    %s
                    """.formatted(assertions.get(i)));
            SchemaException unionError =
                    assertThrows(SchemaException.class, () -> TomlSchema.load(unionSchema));
            assertTrue(unionError.getMessage().contains("union cannot define"));
        }
    }

    @Test
    void allowsSchemaKeywordNamesInCustomMetadata() throws IOException {
        Path schema = write("one-zero-keyword-metadata.tosd", """
                [toml-schema]
                version = "1.0.0"

                [toml-schema.meta]
                dependentrequired = "metadata"
                mutuallyexclusive = "metadata"
                exactlyone = "metadata"
                allof = "metadata"
                uniqueitems = "metadata"
                default = "metadata"
                deprecated = "metadata"

                [elements.value]
                type = "string"
                """);

        assertDoesNotThrow(() -> TomlSchema.load(schema));
    }

    @Test
    void unionSelectorsPreserveOpenTableBranches() throws IOException {
        Path schema = write("open-table-unions.tosd", """
                [toml-schema]
                version = "1.0.0"

                [types.open]
                type = "table"

                [types.closed]
                type = "table"
                [types.closed.known]
                type = "string"

                [types.oneChoice]
                oneof = ["types.open", "types.closed"]

                [elements.one]
                type = "types.oneChoice"

                [elements.any]
                anyof = ["types.open", "types.closed"]
                """);
        Path document = write("open-table-unions.toml", """
                [one]
                arbitrary = true

                [any]
                another = 42
                """);

        ValidationResult result = TomlSchema.load(schema).validate(document);

        assertTrue(result.isValid(), () -> result.errors().toString());
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
