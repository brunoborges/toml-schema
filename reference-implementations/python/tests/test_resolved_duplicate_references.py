"""Resolved-identity duplicate checks for composition reference lists."""

import tempfile
import unittest

import helpers
from toml_schema import SchemaError, load_schema


class ResolvedDuplicateReferenceTests(unittest.TestCase):
    def test_rejects_duplicate_composition_references_by_resolved_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            for property_name in ("oneof", "anyof", "allof"):
                local_type = 'type = "string"\n' if property_name == "allof" else ""
                schema_path = helpers.write_file(
                    tmp,
                    f"{property_name}.tosd",
                    f"""
[toml-schema]
version = "1.0.0"

[types.foo]
type = "string"

[elements.value]
{local_type}{property_name} = ["types.foo", "foo"]
""",
                )
                with self.subTest(property=property_name):
                    with self.assertRaisesRegex(
                        SchemaError,
                        rf"^elements\.value {property_name} contains duplicate type references "
                        rf"'types\.foo' and 'foo'; both resolve to foo$",
                    ):
                        load_schema(schema_path)

    def test_allows_repeated_tuple_item_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "tuple.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[elements.point]
type = "array"
items = ["types.coordinate", "types.coordinate"]
""",
            )
            document_path = helpers.write_file(tmp, "tuple.toml", "point = [1.0, 2.0]\n")

            result = load_schema(schema_path).validate_file(document_path)
            self.assertTrue(result.valid, msg=result.errors)


if __name__ == "__main__":
    unittest.main()
