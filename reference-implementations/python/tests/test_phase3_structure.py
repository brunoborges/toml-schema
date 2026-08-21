import tempfile
import unittest

import helpers
from toml_schema import SchemaError, load_schema


class Phase3StructureTests(unittest.TestCase):
    def test_loads_pure_allof_mixin(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
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
""",
            )
            document = helpers.write_file(
                tmp, "valid.toml", 'pkg = { name = "x", version = "1" }\ncount = 5\n'
            )
            self.assertTrue(schema.validate_file(document).valid)
            invalid = helpers.write_file(
                tmp, "invalid.toml", 'pkg = { name = "x", version = "1" }\ncount = 0\n'
            )
            self.assertFalse(schema.validate_file(invalid).valid)

    def test_rejects_mixed_kind_pure_allof(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
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
""",
            )
            with self.assertRaises(SchemaError):
                load_schema(path)

    def test_validates_inline_array_pattern(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[elements.tags]
type = "array"
itemtype = "string"
pattern = '^[a-z]+$'
""",
            )
            valid = helpers.write_file(tmp, "valid.toml", 'tags = ["alpha", "beta"]\n')
            invalid = helpers.write_file(tmp, "invalid.toml", 'tags = ["alpha", "Beta"]\n')
            self.assertTrue(schema.validate_file(valid).valid)
            self.assertTrue(helpers.has_path(schema.validate_file(invalid), "$.tags[1]"))

    def test_validates_inline_collection_member_constraints(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
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
""",
            )
            valid = helpers.write_file(
                tmp,
                "valid.toml",
                '[ports]\nhttp = 80\n[roles]\nowner = "admin"\n[tags]\nrelease = "stable@example.com"\n[emails]\nowner = "admin@example.com"\n',
            )
            invalid = helpers.write_file(
                tmp,
                "invalid.toml",
                '[ports]\nlow = 0\nhigh = 70000\n[roles]\nowner = "root"\n[tags]\nrelease = "Stable"\n[emails]\nowner = "not-an-email"\n',
            )
            self.assertTrue(schema.validate_file(valid).valid)
            result = schema.validate_file(invalid)
            for path in ("$.ports.low", "$.ports.high", "$.roles.owner",
                         "$.tags.release", "$.emails.owner"):
                self.assertTrue(helpers.has_path(result, path), path)

    def test_rejects_duplicate_inline_and_itemtype_constraint(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"
[types.item]
type = "integer"
min = 0
[elements.values]
type = "array"
itemtype = "types.item"
min = -10
""",
            )
            with self.assertRaises(SchemaError):
                load_schema(path)

    def test_rejects_per_member_allowed_values_on_containers(self):
        cases = [
            '[elements.value]\ntype = "array"\nitemtype = "integer"\nallowedvalues = [5, 50]\nmin = 10\n',
            '[elements.value]\ntype = "collection"\nitemtype = "integer"\nallowedvalues = [5, 50]\nmin = 10\n',
            '[elements.value]\ntype = "array"\nitemtype = "integer"\nallowedvalues = [2, 3]\nmax = 2\n',
            '[elements.value]\ntype = "array"\nitemtype = "string"\nallowedvalues = ["ok@example.com", "nope"]\nformat = "email"\n',
            '[elements.value]\ntype = "collection"\nitemtype = "string"\nallowedvalues = ["ok@example.com", "nope"]\nformat = "email"\n',
        ]
        for index, definition in enumerate(cases):
            with tempfile.TemporaryDirectory() as tmp:
                path = helpers.write_file(
                    tmp,
                    f"invalid-container-{index}.tosd",
                    '[toml-schema]\nversion = "1.0.0"\n' + definition,
                )
                with self.assertRaises(SchemaError):
                    load_schema(path)

        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
[elements.value]
type = "array"
itemtype = "string"
allowedvalues = ["aaaa", "bbbbb"]
maxlength = 2
""",
            )
            valid = helpers.write_file(tmp, "valid.toml", 'value = ["aaaa"]\n')
            self.assertTrue(schema.validate_file(valid).valid)

    def test_allows_inline_constraint_matching_itemtype_allof_constraint(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = helpers.load_semantics_schema(
                tmp,
                """
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
""",
            )
            valid = helpers.write_file(tmp, "valid.toml", 'values = ["b"]\n')
            inline_invalid = helpers.write_file(
                tmp, "inline-invalid.toml", 'values = ["a"]\n'
            )
            inherited_invalid = helpers.write_file(
                tmp, "inherited-invalid.toml", 'values = ["c"]\n'
            )
            self.assertTrue(schema.validate_file(valid).valid)
            self.assertFalse(schema.validate_file(inline_invalid).valid)
            self.assertFalse(schema.validate_file(inherited_invalid).valid)


if __name__ == "__main__":
    unittest.main()
