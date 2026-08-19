"""Composition and annotation-resolution tests: allof/oneof/anyof closure
rules, effective annotation resolution across recursive/mutually-recursive
named types, and collection itemtype composition. Ports Go's
schema_review_test.go."""

import tempfile
import unittest

import helpers
from toml_schema import SchemaError, load_schema


class AnnotationResolutionTests(unittest.TestCase):
    def test_effective_annotations_terminate_on_recursive_named_types(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.node]
type = "table"
description = "A tree node."

[types.node.name]
type = "string"
default = "root"

[types.node.child]
type = "types.node"
optional = true

[elements.tree]
type = "types.node"
""",
            )
            element = schema.element("tree")
            self.assertIsNotNone(element)
            self.assertEqual(element.description, "A tree node.")

            named = schema.type("types.node")
            self.assertIsNotNone(named)
            self.assertEqual(named.description, "A tree node.")

            current = element
            for depth in range(3):
                name_child = current.child("name")
                self.assertIsNotNone(name_child, msg=depth)
                value, has_default = name_child.default()
                self.assertTrue(has_default, msg=depth)
                self.assertEqual(value, "root", msg=depth)
                child = current.child("child")
                self.assertIsNotNone(child, msg=depth)
                current = child

            document = {
                "tree": {
                    "name": "a",
                    "child": {"name": "b", "child": {"name": "c"}},
                }
            }
            result = schema.validate(document)
            self.assertTrue(result.valid, msg=result.errors)

    def test_effective_annotations_terminate_on_mutually_recursive_types(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.left]
type = "table"
description = "Left."

[types.left.right]
type = "types.right"
optional = true

[types.right]
type = "table"
description = "Right."

[types.right.left]
type = "types.left"
optional = true

[elements.root]
type = "types.left"
""",
            )
            root = schema.element("root")
            self.assertIsNotNone(root)
            right = root.child("right")
            self.assertIsNotNone(right)
            self.assertEqual(right.description, "Right.")
            self.assertIsNotNone(right.child("left"))


class AllOfUnionCompositionTests(unittest.TestCase):
    def test_allof_accepts_union_components_with_unambiguous_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
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
""",
            )
            valid = [
                {"id": 1, "name": "a"},
                {"id": 1, "label": "a"},
                {"id": 1, "name": "a", "enabled": True},
            ]
            for item in valid:
                result = schema.validate({"item": item})
                self.assertTrue(result.valid, msg=(item, result.errors))

            both = schema.validate({"item": {"id": 1, "name": "a", "label": "b"}})
            self.assertEqual(len(both.errors), 1)
            self.assertEqual(both.errors[0].path, "$.item")
            self.assertIn("but found 0", both.errors[0].message)

            none = schema.validate({"item": {"id": 1}})
            self.assertEqual(len(none.errors), 1)
            self.assertEqual(none.errors[0].path, "$.item")
            self.assertIn("but found 0", none.errors[0].message)

            unknown = schema.validate({"item": {"id": 1, "name": "a", "bogus": True}})
            self.assertFalse(unknown.valid)
            for diagnostic in unknown.errors:
                self.assertIn(diagnostic.path, ("$.item.bogus", "$.item"))
            self.assertTrue(
                helpers.contains_diagnostic(unknown.errors, "$.item.bogus", "unexpected key")
            )

            missing = schema.validate({"item": {"name": "a"}})
            self.assertEqual(len(missing.errors), 1)
            self.assertEqual(missing.errors[0].path, "$.item.id")

    def test_allof_union_closure_preserves_overlapping_structural_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
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
optional = true

[types.plain]
type = "table"
[types.plain.path]
type = "string"

[types.identity]
oneof = ["types.withName", "types.plain"]

[elements.item]
type = "table"
allof = ["types.base", "types.identity"]
""",
            )
            valid = schema.validate({"item": {"name": "a", "path": "p"}})
            self.assertTrue(valid.valid, msg=valid.errors)

            both = schema.validate(
                {"item": {"name": "a", "path": "p", "git": "https://example.invalid/repo"}}
            )
            self.assertFalse(both.valid)
            self.assertEqual(len(both.errors), 1)
            self.assertIn("but found 0", both.errors[0].message)

    def test_allof_closes_open_union_alternatives_when_composition_defines_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
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

[elements.element]
type = "table"
allof = ["types.base", "types.identity"]
""",
            )
            valid = schema.validate({"element": {"name": "alpha", "known": "value"}})
            self.assertTrue(valid.valid, msg=valid.errors)

            invalid = schema.validate({"element": {"name": "alpha", "arbitrary": True}})
            self.assertFalse(invalid.valid)
            has_union_failure = any(
                d.path == "$.element" and "found 0" in d.message for d in invalid.errors
            )
            self.assertTrue(has_union_failure, msg=invalid.errors)

    def test_allof_accepts_anyof_components_for_scalars_and_collections(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.low]
type = "integer"
max = 10

[types.high]
type = "integer"
min = 100

[types.bounded]
anyof = ["types.low", "types.high"]

[elements.count]
type = "integer"
min = 0
allof = ["types.bounded"]

[types.shortEntry]
type = "string"
maxlength = 4

[types.longEntry]
type = "string"
minlength = 8

[types.shortCollection]
type = "collection"
itemtype = "types.shortEntry"

[types.longCollection]
type = "collection"
itemtype = "types.longEntry"

[types.entries]
anyof = ["types.shortCollection", "types.longCollection"]

[elements.registry]
type = "collection"
itemtype = "string"
allof = ["types.entries"]
""",
            )
            result = schema.validate({"count": 5, "registry": {"a": "abcd"}})
            self.assertTrue(result.valid, msg=result.errors)

            result = schema.validate({"count": 500, "registry": {"a": "abcdefgh"}})
            self.assertTrue(result.valid, msg=result.errors)

            result = schema.validate({"count": 50, "registry": {"a": "abcdef"}})
            paths = helpers.diagnostic_paths(result.errors)
            self.assertEqual(paths, ["$.count", "$.registry"])
            for diagnostic in result.errors:
                self.assertIn("at least one matching type from anyof", diagnostic.message)

    def test_collection_itemtype_may_come_from_allof_component(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[types.entry]
type = "string"
minlength = 2

[types.baseRegistry]
type = "collection"
itemtype = "types.entry"

[elements.registry]
type = "collection"
keypattern = "^[a-z]+$"
allof = ["types.baseRegistry"]

[elements.registry.fixed]
type = "boolean"
optional = true
""",
            )
            result = schema.validate({"registry": {"alpha": "ok", "fixed": True}})
            self.assertTrue(result.valid, msg=result.errors)

            short = schema.validate({"registry": {"alpha": "x"}})
            self.assertEqual(len(short.errors), 1)
            self.assertEqual(short.errors[0].path, "$.registry.alpha")

            bad_key = schema.validate({"registry": {"ALPHA": "ok"}})
            self.assertEqual(len(bad_key.errors), 1)
            self.assertIn("keypattern", bad_key.errors[0].message)

    def test_rejects_collection_without_any_item_constraint(self):
        cases = {
            "no-itemtype": (
                """
[elements.registry]
type = "collection"
""",
                "must define itemtype when type is collection",
            ),
            "incompatible-component": (
                """
[types.plain]
type = "table"

[types.plain.name]
type = "string"

[elements.registry]
type = "collection"
allof = ["types.plain"]
""",
                "incompatible effective kind",
            ),
        }
        with tempfile.TemporaryDirectory() as tmp:
            for name, (definitions, message) in cases.items():
                with self.subTest(name=name):
                    path = helpers.write_file(
                        tmp,
                        f"collection-{name}.tosd",
                        '[toml-schema]\nversion = "1.0.0"\n' + definitions,
                    )
                    with self.assertRaisesRegex(SchemaError, message):
                        load_schema(path)


class DefaultDisambiguationTests(unittest.TestCase):
    def test_default_disambiguation_follows_toml_syntax(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[elements]
inline = { type = "table", optional = true, default = { keep = true } }

[elements.range]
type = "table"
optional = true
default = { min = 1, max = 10 }

[elements.range.min]
type = "integer"
[elements.range.max]
type = "integer"

[elements.plugin]
type = "table"
optional = true
default = { type = "linter", oneof = "unused", anyof = "unused" }

[elements.options]
type = "table"

[elements.options.default]

[elements.options.default.min]
type = "integer"

[elements.entry]
type = "table"

[elements.entry.dependentrequired]
type = "string"
optional = true
""",
            )
            inline = schema.element("inline")
            self.assertIsNotNone(inline)
            value, ok = inline.default()
            self.assertTrue(ok)
            self.assertEqual(value, {"keep": True})
            self.assertIsNone(inline.child("default"))

            range_element = schema.element("range")
            value, ok = range_element.default()
            self.assertTrue(ok)
            self.assertEqual(value, {"min": 1, "max": 10})
            self.assertIsNone(range_element.child("default"))
            self.assertIsNotNone(range_element.child("min"))

            plugin = schema.element("plugin")
            value, ok = plugin.default()
            self.assertTrue(ok)
            self.assertEqual(value, {"type": "linter", "oneof": "unused", "anyof": "unused"})

            options = schema.element("options")
            _, ok = options.default()
            self.assertFalse(ok)
            child = options.child("default")
            self.assertIsNotNone(child)
            self.assertIsNotNone(child.child("min"))

            entry = schema.element("entry")
            self.assertIsNotNone(entry.child("dependentrequired"))

            result = schema.validate(
                {
                    "options": {"default": {"min": 1}},
                    "entry": {"dependentrequired": "x"},
                }
            )
            self.assertTrue(result.valid, msg=result.errors)

            missing = schema.validate({"options": {}, "entry": {}})
            self.assertEqual(len(missing.errors), 1)
            self.assertEqual(missing.errors[0].path, "$.options.default")


if __name__ == "__main__":
    unittest.main()
