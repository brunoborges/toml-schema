"""Conditional (``if``/``then``/``else``) selector tests.

Ports Go's schema_conditional_test.go.
"""

import tempfile
import unittest

import helpers
from toml_schema import SchemaError, load_schema


class ConditionalSelectorTests(unittest.TestCase):
    def test_conditional_selectors_choose_and_validate_branch(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.sqlite]
type = "table"
[types.sqlite.engine]
type = "string"
allowedvalues = ["sqlite"]
optional = true
[types.sqlite.file]
type = "string"

[types.server]
type = "table"
[types.server.engine]
type = "string"
allowedvalues = ["postgresql", "mysql"]
optional = true
[types.server.host]
type = "string"

[elements.byEquals]
if = { key = "engine", equals = "sqlite" }
then = "types.sqlite"
else = "types.server"

[elements.byIn]
if = { key = "engine", in = ["postgresql", "mysql"] }
then = "types.server"
else = "types.sqlite"
""",
            )

            cases = {
                "equals": {
                    "byEquals": {"engine": "sqlite", "file": "db.sqlite"},
                    "byIn": {"engine": "sqlite", "file": "db.sqlite"},
                },
                "in": {
                    "byEquals": {"engine": "mysql", "host": "db.internal"},
                    "byIn": {"engine": "postgresql", "host": "db.internal"},
                },
                "missing-chooses-else": {
                    "byEquals": {"host": "db.internal"},
                    "byIn": {"file": "db.sqlite"},
                },
            }
            for name, document in cases.items():
                with self.subTest(name=name):
                    result = schema.validate(document)
                    self.assertTrue(result.valid, msg=result.errors)

            required = schema.validate(
                {"byEquals": {"engine": "sqlite"}, "byIn": {"engine": "mysql"}}
            )
            self.assertFalse(required.valid)
            self.assertTrue(helpers.has_path(required, "$.byEquals.file"))
            self.assertTrue(helpers.has_path(required, "$.byIn.host"))

            unknown = schema.validate(
                {
                    "byEquals": {"engine": "sqlite", "file": "db.sqlite", "host": "wrong-branch"},
                    "byIn": {"engine": "sqlite", "file": "db.sqlite", "host": "wrong-branch"},
                }
            )
            self.assertFalse(unknown.valid)
            self.assertTrue(helpers.has_path(unknown, "$.byEquals.host"))
            self.assertTrue(helpers.has_path(unknown, "$.byIn.host"))

    def test_conditional_selector_uses_toml_equality(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.one]
type = "table"
[types.one.mode]
type = "float"
[types.one.selected]
type = "boolean"

[types.other]
type = "table"
[types.other.mode]
type = "integer"
[types.other.fallback]
type = "boolean"

[elements.value]
if = { key = "mode", equals = 1 }
then = "types.one"
else = "types.other"
""",
            )
            result = schema.validate({"value": {"mode": 1.0, "selected": True}})
            self.assertTrue(result.valid, msg=result.errors)

    def test_conditional_key_is_one_literal_direct_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.selected]
type = "table"
deprecated = true

[types.fallback]
type = "table"

[elements.value]
if = { key = "engine.kind", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"
""",
            )
            nested_only = schema.validate({"value": {"engine": {"kind": "sqlite"}}})
            self.assertTrue(nested_only.valid, msg=nested_only.errors)
            self.assertEqual(len(nested_only.warnings), 0)

            literal = schema.validate({"value": {"engine.kind": "sqlite"}})
            self.assertTrue(literal.valid, msg=literal.errors)
            self.assertEqual(len(literal.warnings), 1)

    def test_schema_property_names_remain_legal_implicit_table_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[elements.value.if]
type = "string"

[elements.value.then]
type = "integer"

[elements.value.else]
type = "boolean"
""",
            )
            result = schema.validate({"value": {"if": "condition", "then": 1, "else": True}})
            self.assertTrue(result.valid, msg=result.errors)

    def test_conditional_discriminator_does_not_become_known_branch_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.selected]
type = "table"
[types.selected.value]
type = "string"

[types.fallback]
type = "table"
[types.fallback.other]
type = "string"

[elements.item]
if = { key = "engine", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"
""",
            )
            result = schema.validate({"item": {"engine": "sqlite", "value": "ok"}})
            self.assertFalse(result.valid)
            self.assertTrue(helpers.has_path(result, "$.item.engine"))

    def test_conditional_selector_composes_with_allof(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
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

[elements.database]
type = "types.database"

[elements.composed]
type = "table"
allof = ["types.database"]
""",
            )
            valid = {
                "database": {"id": 1, "engine": "sqlite", "file": "db.sqlite"},
                "composed": {"id": 2, "engine": "postgresql", "host": "db.internal"},
            }
            result = schema.validate(valid)
            self.assertTrue(result.valid, msg=result.errors)

            invalid = schema.validate(
                {
                    "database": {"engine": "sqlite", "file": "db.sqlite"},
                    "composed": {"id": 2, "engine": "sqlite", "host": "wrong-branch"},
                }
            )
            self.assertFalse(invalid.valid)
            self.assertTrue(helpers.has_path(invalid, "$.database.id"))
            self.assertTrue(helpers.has_path(invalid, "$.composed.file"))
            self.assertTrue(helpers.has_path(invalid, "$.composed.host"))

    def test_rejects_malformed_conditional_selectors(self):
        table_branch = """
[types.left]
type = "table"
[types.left.engine]
type = "string"
[types.right]
type = "table"
[types.right.engine]
type = "string"
"""
        cases = {
            "missing-else": 'if = { key = "engine", equals = "x" }\nthen = "types.left"',
            "neither-predicate": 'if = { key = "engine" }\nthen = "types.left"\nelse = "types.right"',
            "both-predicates": (
                'if = { key = "engine", equals = "x", in = ["x"] }\n'
                'then = "types.left"\nelse = "types.right"'
            ),
            "empty-in": 'if = { key = "engine", in = [] }\nthen = "types.left"\nelse = "types.right"',
            "non-string-key": 'if = { key = 1, equals = "x" }\nthen = "types.left"\nelse = "types.right"',
            "unknown-if-property": (
                'if = { key = "engine", equals = "x", other = true }\n'
                'then = "types.left"\nelse = "types.right"'
            ),
            "builtin-branch": 'if = { key = "engine", equals = "x" }\nthen = "table"\nelse = "types.right"',
            "unknown-branch": (
                'if = { key = "engine", equals = "x" }\nthen = "types.missing"\nelse = "types.right"'
            ),
            "other-selector": (
                'type = "table"\nif = { key = "engine", equals = "x" }\n'
                'then = "types.left"\nelse = "types.right"'
            ),
            "ordinary-constraint": (
                'if = { key = "engine", equals = "x" }\nthen = "types.left"\n'
                'else = "types.right"\nminlength = 1'
            ),
            "nested-child": (
                'if = { key = "engine", equals = "x" }\nthen = "types.left"\n'
                'else = "types.right"\n[elements.value.child]\ntype = "string"'
            ),
        }
        with tempfile.TemporaryDirectory() as tmp:
            for name, definition in cases.items():
                with self.subTest(name=name):
                    content = f"""
[toml-schema]
version = "1.0.0"
{table_branch}
[elements.value]
{definition}
"""
                    path = helpers.write_file(tmp, f"invalid-{name}.tosd", content)
                    with self.assertRaises(SchemaError):
                        load_schema(path)

    def test_rejects_conditional_kind_and_reference_cycles(self):
        with tempfile.TemporaryDirectory() as tmp:
            incompatible = helpers.write_file(
                tmp,
                "incompatible.tosd",
                """
[toml-schema]
version = "1.0.0"
[types.tableBranch]
type = "table"
[types.tableBranch.engine]
type = "string"
[types.collectionBranch]
type = "collection"
itemtype = "string"
[types.collectionBranch.engine]
type = "string"
[elements.value]
if = { key = "engine", equals = "x" }
then = "types.tableBranch"
else = "types.collectionBranch"
""",
            )
            with self.assertRaisesRegex(SchemaError, "incompatible"):
                load_schema(incompatible)

            cycle = helpers.write_file(
                tmp,
                "cycle.tosd",
                """
[toml-schema]
version = "1.0.0"
[types.fallback]
type = "table"
[types.fallback.engine]
type = "string"
[types.first]
if = { key = "engine", equals = "x" }
then = "types.second"
else = "types.fallback"
[types.second]
type = "types.first"
[elements.value]
type = "types.fallback"
""",
            )
            with self.assertRaisesRegex(SchemaError, "cyclic"):
                load_schema(cycle)


if __name__ == "__main__":
    unittest.main()
