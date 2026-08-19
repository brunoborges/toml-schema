"""Reference resolution, type-selector cardinality, named-type-name
vocabulary, and union structural validation tests. Ports representative
coverage from Go's schema_test.go."""

import tempfile
import unittest

import helpers
from toml_schema import SchemaError, load_schema


class BuiltInAndUnionReferenceTests(unittest.TestCase):
    def test_supports_built_in_type_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
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
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
name = "Alice"
flags = [ true, false ]
tuple = [ "port", 8080 ]
identity = 42
flex = "abc"
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(document_path)
            self.assertTrue(result.valid, msg=result.errors)

    def test_rejects_invalid_union_structure_and_child_placement(self):
        invalid_definitions = [
            "oneof = []",
            "anyof = []",
            'oneof = [ "string" ]\npattern = "x"',
            'oneof = [ "string" ]\ndependentrequired = { a = ["b"] }',
            'oneof = [ "string" ]\nmutuallyexclusive = [["a", "b"]]',
            'anyof = [ "string" ]\nexactlyone = [["a", "b"]]',
            'anyof = [ "array" ]\nuniqueitems = true',
            'oneof = [ "string" ]\n\n[elements.value.child]\ntype = "string"',
            'type = "string"\n\n[elements.value.child]\ntype = "string"',
            'type = "array"\n\n[elements.value.child]\ntype = "string"',
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for index, definition in enumerate(invalid_definitions):
                with self.subTest(index=index):
                    content = f"""
[toml-schema]
version = "1.0.0"

[elements.value]
{definition}
"""
                    path = helpers.write_file(tmp, f"invalid-structure-{index}.tosd", content)
                    with self.assertRaises(SchemaError):
                        load_schema(path)

    def test_validates_allowed_values_for_array_without_itemtype(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "array-allowedvalues.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.colors]
type = "array"
allowedvalues = [ "red", "blue" ]
""",
            )
            valid_path = helpers.write_file(
                tmp, "valid-array-allowedvalues.toml", 'colors = [ "red", "blue" ]\n'
            )
            invalid_path = helpers.write_file(
                tmp, "invalid-array-allowedvalues.toml", 'colors = [ "red", "green" ]\n'
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(valid_path)
            self.assertTrue(result.valid, msg=result.errors)

            result = schema.validate_file(invalid_path)
            self.assertFalse(result.valid)
            self.assertTrue(helpers.has_path(result, "$.colors[1]"))


class ReferenceGraphValidationTests(unittest.TestCase):
    def test_validates_reference_graph_at_schema_load_time(self):
        invalid_references = [
            'type = ""',
            'type = "types.missing"',
            'type = "array"\nitemtype = ""',
            'type = "array"\nitemtype = "types.missing"',
            'type = "array"\nitems = [ "" ]',
            'type = "array"\nitems = [ "types.missing" ]',
            'oneof = [ "" ]',
            'oneof = [ "types.missing" ]',
            'anyof = [ "" ]',
            'anyof = [ "types.missing" ]',
            'type = "table"\n\n[elements.value.child]\ntype = "types.missing"',
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for index, definition in enumerate(invalid_references):
                with self.subTest(index=index):
                    content = f"""
[toml-schema]
version = "1.0.0"

[elements.value]
{definition}
"""
                    path = helpers.write_file(tmp, f"dangling-reference-{index}.tosd", content)
                    with self.assertRaises(SchemaError):
                        load_schema(path)

            cycles = [
                '[types.first]\ntype = "types.second"\n\n[types.second]\ntype = "types.first"',
                (
                    '[types.first]\noneof = [ "types.second" ]\n\n'
                    '[types.second]\nanyof = [ "types.first" ]'
                ),
            ]
            for index, cycle in enumerate(cycles):
                with self.subTest(cycle=index):
                    content = f"""
[toml-schema]
version = "1.0.0"

{cycle}

[elements.value]
type = "string"
"""
                    path = helpers.write_file(tmp, f"selector-cycle-{index}.tosd", content)
                    with self.assertRaises(SchemaError):
                        load_schema(path)

            recursive = helpers.write_file(
                tmp,
                "recursive-structure.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.node]
type = "table"

    [types.node.children]
    type = "array"
    itemtype = "types.node"

[elements.root]
type = "types.node"
""",
            )
            load_schema(recursive)  # must not raise: structural recursion is allowed

    def test_rejects_unknown_property(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.write_file(
                tmp,
                "unknown-property.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.values]
type = "array"
unknownproperty = "string"
""",
            )
            with self.assertRaisesRegex(SchemaError, "unsupported property: unknownproperty"):
                load_schema(path)

    def test_rejects_removed_table_collection_alias_as_unknown_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.items]
type = "table-collection"
""",
            )
            with self.assertRaises(SchemaError):
                load_schema(path)


class NamedTypeNameVocabularyTests(unittest.TestCase):
    def test_rejects_types_named_after_built_ins(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.string]
type = "integer"

[elements.value]
type = "string"
""",
            )
            with self.assertRaises(SchemaError):
                load_schema(path)

    def test_rejects_types_named_with_reference_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[types."types.name"]
type = "string"

[elements.value]
type = "name"
""",
            )
            with self.assertRaises(SchemaError):
                load_schema(path)

    def test_resolves_quoted_dotted_type_names_in_both_reference_forms(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[types."network.endpoint"]
type = "string"

[elements.short]
type = "network.endpoint"

[elements.qualified]
type = "types.network.endpoint"
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
short = "one"
qualified = "two"
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(document_path)
            self.assertTrue(result.valid, msg=result.errors)


class NamedTypeReferenceSiblingTests(unittest.TestCase):
    def test_allows_optional_and_description_on_named_type_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "named-reference-metadata.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.nameType]
type = "string"
pattern = "^[a-z]+$"

[types.inheritedOptional]
type = "string"
optional = true

[elements.name]
type = "types.nameType"
description = "Optional display name."
optional = true

[elements.inherited]
type = "types.inheritedOptional"
optional = false
""",
            )
            document_path = helpers.write_file(
                tmp, "named-reference-metadata.toml", "# name is optional\n"
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(document_path)
            self.assertTrue(result.valid, msg=result.errors)

    def test_rejects_constraints_and_children_on_named_type_reference(self):
        invalid_siblings = [
            'itemtype = "string"',
            'items = [ "string" ]',
            'allowedvalues = [ "name" ]',
            'pattern = "^[a-z]+$"',
            'keypattern = "^[a-z]+$"',
            "min = 1",
            "max = 1",
            "minlength = 1",
            "maxlength = 1",
            'dependentrequired = { a = ["b"] }',
            'mutuallyexclusive = [["a", "b"]]',
            'exactlyone = [["a", "b"]]',
            "uniqueitems = true",
            '[elements.name.child]\ntype = "string"',
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for index, invalid_sibling in enumerate(invalid_siblings):
                with self.subTest(index=index):
                    content = f"""
[toml-schema]
version = "1.0.0"

[types.nameType]
type = "string"

[elements.name]
type = "types.nameType"
{invalid_sibling}
"""
                    path = helpers.write_file(
                        tmp, f"named-reference-constraint-{index}.tosd", content
                    )
                    with self.assertRaisesRegex(SchemaError, "named type reference"):
                        load_schema(path)

    def test_allows_itemtype_on_collection(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "collection-itemtype.tosd",
                """
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
""",
            )
            document_path = helpers.write_file(
                tmp,
                "collection-itemtype.toml",
                """
[items]
name = "example"
port = 8080
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(document_path)
            self.assertTrue(result.valid, msg=result.errors)


if __name__ == "__main__":
    unittest.main()
