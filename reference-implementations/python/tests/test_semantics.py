"""Sibling rule, allof/anyof/oneof composition, uniqueitems, and default
annotation tests. Ports Go's schema_semantics_test.go."""

import math
import tempfile
import unittest

import helpers
from toml_schema import SchemaError, load_schema


class SiblingPresenceRuleTests(unittest.TestCase):
    def test_sibling_presence_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.settings]
type = "table"
dependentrequired = { branch = ["git"], tag = ["git"], git = ["url"] }
mutuallyexclusive = [["git", "path"], ["branch", "tag"]]
exactlyone = [["file", "text"]]

[types.settings.git]
type = "string"
optional = true
[types.settings.url]
type = "string"
optional = true
[types.settings.path]
type = "string"
optional = true
[types.settings.branch]
type = "string"
optional = true
[types.settings.tag]
type = "string"
optional = true
[types.settings.file]
type = "string"
optional = true
[types.settings.text]
type = "string"
optional = true

[elements.settings]
type = "types.settings"
""",
            )
            valid = {
                "settings": {
                    "branch": "main",
                    "git": "repo",
                    "url": "origin",
                    "file": "README.md",
                }
            }
            result = schema.validate(valid)
            self.assertTrue(result.valid, msg=result.errors)

            cases = {
                "dependency": {"branch": "main", "file": "README.md"},
                "transitive": {"git": "repo", "file": "README.md"},
                "exclusive": {"git": "repo", "url": "origin", "path": ".", "file": "README.md"},
                "none": {},
                "two": {"file": "README.md", "text": "inline"},
            }
            for name, settings in cases.items():
                with self.subTest(name=name):
                    result = schema.validate({"settings": settings})
                    self.assertFalse(result.valid)

    def test_dependent_required_triggers_on_direct_presence_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.settings]
type = "table"
dependentrequired = { a = ["b"], b = ["c"] }

[types.settings.a]
type = "string"
optional = true
[types.settings.b]
type = "string"
optional = true
[types.settings.c]
type = "string"
optional = true

[elements.settings]
type = "types.settings"
""",
            )
            result = schema.validate({"settings": {"a": "x"}})
            self.assertEqual(len(result.errors), 1)
            diagnostic = result.errors[0]
            self.assertEqual(diagnostic.path, "$.settings.b")
            self.assertEqual(
                diagnostic.message, 'required by dependentrequired triggered by sibling "a"'
            )

            present = schema.validate({"settings": {"a": "x", "b": "y"}})
            self.assertEqual(len(present.errors), 1)
            self.assertEqual(present.errors[0].path, "$.settings.c")

            result = schema.validate({"settings": {"a": "x", "b": "y", "c": "z"}})
            self.assertTrue(result.valid, msg=result.errors)

            result = schema.validate({"settings": {"c": "z"}})
            self.assertTrue(result.valid, msg=result.errors)


class AllOfCompositionTests(unittest.TestCase):
    def test_allof_is_additive_and_computes_table_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.base]
type = "table"
[types.base.id]
type = "integer"
[types.base.score]
type = "integer"
min = 1

[types.extended]
type = "table"
allof = ["types.base"]
[types.extended.name]
type = "string"
[types.extended.score]
type = "integer"
max = 10

[elements.item]
type = "types.extended"
""",
            )
            result = schema.validate({"item": {"id": 1, "name": "ok", "score": 5}})
            self.assertTrue(result.valid, msg=result.errors)

            cases = {
                "base-required": {"name": "ok", "score": 5},
                "base-overlap": {"id": 1, "name": "ok", "score": 0},
                "local-overlap": {"id": 1, "name": "ok", "score": 11},
                "closed-union": {"id": 1, "name": "ok", "score": 5, "extra": True},
            }
            for name, item in cases.items():
                with self.subTest(name=name):
                    result = schema.validate({"item": item})
                    self.assertFalse(result.valid)

    def test_allof_collection_applies_every_dynamic_constraint(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.positive]
type = "integer"
min = 1

[types.small]
type = "integer"
max = 9

[types.base]
type = "collection"
itemtype = "types.positive"
keypattern = "^x"

[types.composed]
type = "collection"
itemtype = "types.small"
keypattern = "z$"
allof = ["types.base"]

[types.composed.fixed]
type = "string"

[elements.values]
type = "types.composed"
""",
            )
            result = schema.validate({"values": {"fixed": "special", "xyz": 5}})
            self.assertTrue(result.valid, msg=result.errors)

            cases = {
                "first-itemtype": {"xyz": 0},
                "second-itemtype": {"xyz": 10},
                "first-pattern": {"ayz": 5},
                "second-pattern": {"xy": 5},
            }
            for name, values in cases.items():
                with self.subTest(name=name):
                    result = schema.validate({"values": values})
                    self.assertFalse(result.valid)

    def test_composes_array_constraints_independently(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "array-allof.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.strings]
type = "array"
itemtype = "string"

[types.pair]
type = "array"
items = ["string", "string"]

[types.unique]
type = "array"
uniqueitems = true

[elements.value]
type = "array"
allof = ["types.strings", "types.pair", "types.unique"]
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate({"value": ["a", "b"]})
            self.assertTrue(result.valid, msg=result.errors)

            cases = {
                "kind": ["a", 1],
                "length": ["a"],
                "unique": ["a", "a"],
            }
            for name, value in cases.items():
                with self.subTest(name=name):
                    result = schema.validate({"value": value})
                    self.assertFalse(result.valid)


class UniqueItemsTests(unittest.TestCase):
    def test_unique_items_uses_recursive_toml_equality(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[elements.values]
type = "array"
itemtype = "any"
uniqueitems = true
""",
            )
            cases = {
                "numeric": [1, 1.0],
                "zero": [0.0, math.copysign(0.0, -1)],
                "nan": [math.nan, math.nan],
                "arrays": [[1, "x"], [1.0, "x"]],
                "tables": [{"a": 1, "b": True}, {"b": True, "a": 1.0}],
            }
            for name, values in cases.items():
                with self.subTest(name=name):
                    result = schema.validate({"values": values})
                    self.assertFalse(result.valid)
                    self.assertIn("duplicate item", result.errors[0].message)

            result = schema.validate(
                {
                    "values": [
                        {"id": 1, "value": "a"},
                        {"id": 1, "value": "b"},
                    ]
                }
            )
            self.assertTrue(result.valid, msg=result.errors)


class DefaultAnnotationTests(unittest.TestCase):
    def test_defaults_are_validated_inherited_and_non_mutating(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.base]
type = "integer"
min = 1
default = 2

[types.same]
type = "integer"
default = 2

[elements.inherited]
type = "types.base"
optional = true

[elements.local]
type = "types.base"
default = 3
optional = true

[elements.composed]
type = "integer"
allof = ["types.base", "types.same"]
optional = true
""",
            )
            inherited = schema.element("inherited")
            value, ok = inherited.default()
            self.assertTrue(ok)
            self.assertEqual(value, 2)

            local = schema.element("local")
            value, ok = local.default()
            self.assertTrue(ok)
            self.assertEqual(value, 3)

            document = {}
            result = schema.validate(document)
            self.assertTrue(result.valid, msg=result.errors)
            self.assertEqual(len(document), 0)

            invalid = helpers.write_file(
                tmp,
                "invalid-default.tosd",
                """
[toml-schema]
version = "1.0.0"
[elements.count]
type = "integer"
min = 2
default = 1
""",
            )
            with self.assertRaisesRegex(SchemaError, "default is invalid"):
                load_schema(invalid)

            conflict = helpers.write_file(
                tmp,
                "conflicting-default.tosd",
                """
[toml-schema]
version = "1.0.0"
[types.a]
type = "integer"
default = 1
[types.b]
type = "integer"
default = 2
[elements.value]
type = "integer"
allof = ["types.a", "types.b"]
""",
            )
            with self.assertRaisesRegex(SchemaError, "conflicting inherited defaults"):
                load_schema(conflict)

    def test_deprecated_produces_structured_branch_local_warnings(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.legacy]
type = "string"
pattern = "^old$"
deprecated = true

[types.current]
type = "integer"

[elements.value]
oneof = ["types.legacy", "types.current"]

[elements.optional]
type = "types.legacy"
optional = true
""",
            )
            result = schema.validate({"value": "old"})
            self.assertTrue(result.valid, msg=result.errors)
            self.assertEqual(len(result.warnings), 1)
            warning = result.warnings[0]
            self.assertEqual(warning.severity.value, "warning")
            self.assertEqual(warning.code, "deprecated")
            self.assertEqual(warning.path, "$.value")
            self.assertTrue(warning.message)
            self.assertEqual(len(result.diagnostics), 1)

            result = schema.validate({"value": 1})
            self.assertTrue(result.valid, msg=result.errors)
            self.assertEqual(len(result.warnings), 0)


class MalformedVocabularyTests(unittest.TestCase):
    def test_rejects_malformed_vocabulary(self):
        cases = {
            "dependent-empty": 'type = "table"\ndependentrequired = {}',
            "dependent-values": (
                'type = "table"\ndependentrequired = { a = [] }\n'
                '[elements.value.a]\ntype = "string"\noptional = true'
            ),
            "exclusive-small": (
                'type = "table"\nmutuallyexclusive = [["a"]]\n'
                '[elements.value.a]\ntype = "string"\noptional = true'
            ),
            "exact-duplicate": (
                'type = "table"\nexactlyone = [["a", "a"]]\n'
                '[elements.value.a]\ntype = "string"\noptional = true'
            ),
            "allof-empty": 'type = "string"\nallof = []',
            "items-empty": 'type = "array"\nitems = []',
            "allof-kind": 'type = "string"\nallof = ["integer"]',
            "unique-kind": 'type = "string"\nuniqueitems = true',
            "deprecated-type": 'type = "string"\ndeprecated = "yes"',
        }
        with tempfile.TemporaryDirectory() as tmp:
            for name, definition in cases.items():
                with self.subTest(name=name):
                    content = f"""
[toml-schema]
version = "1.0.0"
[elements.value]
{definition}
"""
                    path = helpers.write_file(tmp, f"invalid-{name}.tosd", content)
                    with self.assertRaises(SchemaError):
                        load_schema(path)


if __name__ == "__main__":
    unittest.main()
