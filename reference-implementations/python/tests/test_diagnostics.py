"""Diagnostics, range/length/pattern/tuple/collection validation, numeric and
temporal precision, and value-container tests. Ports representative coverage
from Go's schema_test.go."""

import tempfile
import unittest

import helpers
from toml_schema import SchemaError, load_schema


class ValidationErrorReportingTests(unittest.TestCase):
    def test_reports_validation_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
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
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
name = "A"
port = 70000
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(document_path)
            self.assertFalse(result.valid)
            self.assertEqual(len(result.errors), 3)
            self.assertTrue(helpers.has_path(result, "$.name"))
            self.assertTrue(helpers.has_path(result, "$.port"))

    def test_rejects_malformed_boundary_schemas(self):
        cases = {
            "any-min": """
[toml-schema]
version = "1.0.0"

[elements.payload]
type = "any"
min = 1
""",
            "nan-min": """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "float"
min = nan
""",
            "string-min": """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
min = "1"
""",
            "date-time-min": """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "local-date"
min = 2026-01-01T00:00:00Z
""",
        }
        with tempfile.TemporaryDirectory() as tmp:
            for name, content in cases.items():
                with self.subTest(name=name):
                    path = helpers.write_file(tmp, f"{name}.tosd", content)
                    with self.assertRaises(SchemaError):
                        load_schema(path)

    def test_rejects_malformed_length_schemas(self):
        cases = {
            "negative-minlength": """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
minlength = -1
""",
            "negative-maxlength": """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
maxlength = -1
""",
            "inverted-length": """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
minlength = 5
maxlength = 2
""",
            "incompatible-length": """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "boolean"
minlength = 1
""",
        }
        with tempfile.TemporaryDirectory() as tmp:
            for name, content in cases.items():
                with self.subTest(name=name):
                    path = helpers.write_file(tmp, f"{name}.tosd", content)
                    with self.assertRaises(SchemaError):
                        load_schema(path)


class ArrayRangeTests(unittest.TestCase):
    def test_validates_array_ranges_through_itemtype(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "array-ranges.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.boundedInteger]
type = "integer"

[types.smallInteger]
type = "integer"
allowedvalues = [1, 2, 3, 4, 5]

[types.largeInteger]
type = "integer"
allowedvalues = [6, 7, 8, 9, 10]

[types.integerAlternative]
oneof = [ "types.smallInteger", "types.largeInteger" ]

[elements.direct]
type = "array"
itemtype = "integer"
min = 2
max = 4

[elements.named]
type = "array"
itemtype = "types.boundedInteger"
min = 10
max = 20

[elements.alternatives]
type = "array"
itemtype = "types.integerAlternative"
min = 1
max = 10
""",
            )
            valid_path = helpers.write_file(
                tmp,
                "valid-array-ranges.toml",
                """
direct = [2, 3, 4]
named = [10, 20]
alternatives = [2, 8]
""",
            )
            invalid_path = helpers.write_file(
                tmp,
                "invalid-array-ranges.toml",
                """
direct = [1, 5]
named = [7, 21]
alternatives = [0, 11]
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(valid_path)
            self.assertTrue(result.valid, msg=result.errors)

            result = schema.validate_file(invalid_path)
            for path in [
                "$.direct[0]", "$.direct[1]",
                "$.named[0]", "$.named[1]",
                "$.alternatives[0]", "$.alternatives[1]",
            ]:
                with self.subTest(path=path):
                    self.assertTrue(helpers.has_path(result, path))

    def test_rejects_array_ranges_for_mixed_itemtype_alternatives(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "mixed-array-range.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.mixed]
oneof = [ "integer", "string" ]

[elements.values]
type = "array"
itemtype = "types.mixed"
min = 1
""",
            )
            with self.assertRaisesRegex(SchemaError, "one comparable built-in type"):
                load_schema(schema_path)


class TupleArrayTests(unittest.TestCase):
    def test_validates_tuple_arrays_by_position(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[types.label]
type = "string"

[types.coordinateLabel]
type = "array"
items = [ "types.coordinate", "types.label" ]

[elements.value]
type = "array"
items = [ "types.coordinateLabel", "types.coordinate" ]
""",
            )
            document_path = helpers.write_file(
                tmp, "document.toml", "value = [ [ 1.5, \"Hello\" ], 2.0 ]\n"
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(document_path)
            self.assertTrue(result.valid, msg=result.errors)

    def test_rejects_invalid_tuple_arrays(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[types.coordinate]
type = "float"

[types.label]
type = "string"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
""",
            )
            wrong_order_path = helpers.write_file(
                tmp, "wrong-order.toml", 'value = [ "Hello", 1.5 ]\n'
            )
            too_short_path = helpers.write_file(tmp, "too-short.toml", "value = [ 1.5 ]\n")
            too_long_path = helpers.write_file(
                tmp, "too-long.toml", 'value = [ 1.5, "Hello", true ]\n'
            )
            schema = load_schema(schema_path)

            wrong_order = schema.validate_file(wrong_order_path)
            self.assertFalse(wrong_order.valid)
            self.assertTrue(helpers.has_path(wrong_order, "$.value[0]"))
            self.assertTrue(helpers.has_path(wrong_order, "$.value[1]"))

            too_short = schema.validate_file(too_short_path)
            self.assertFalse(too_short.valid)
            self.assertTrue(helpers.has_path(too_short, "$.value"))

            too_long = schema.validate_file(too_long_path)
            self.assertFalse(too_long.valid)
            self.assertTrue(helpers.has_path(too_long, "$.value"))

    def test_rejects_tuple_schema_with_conflicting_properties(self):
        conflicts = [
            """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
itemtype = "string"
""",
            """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "types.coordinate", "types.label" ]
minlength = 2
""",
            """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "string", "integer" ]
allowedvalues = [ 1 ]
""",
            """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "array"
items = [ "string", "integer" ]
min = 1
""",
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for index, content in enumerate(conflicts):
                with self.subTest(index=index):
                    path = helpers.write_file(tmp, f"schema-{index}.tosd", content)
                    with self.assertRaises(SchemaError):
                        load_schema(path)


class CollectionKeyPatternTests(unittest.TestCase):
    def test_validates_collection_keys_against_keypattern(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "keypattern.tosd",
                """
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
""",
            )
            valid_document = helpers.write_file(
                tmp,
                "valid.toml",
                """
[servers.server_01]
ip = "10.0.0.1"

[servers.server_02]
ip = "10.0.0.2"
""",
            )
            invalid_document = helpers.write_file(
                tmp,
                "invalid.toml",
                """
[servers.server_01]
ip = "10.0.0.1"

[servers.alpha]
ip = "10.0.0.2"
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(valid_document)
            self.assertTrue(result.valid, msg=result.errors)

            result = schema.validate_file(invalid_document)
            self.assertFalse(result.valid)
            self.assertTrue(helpers.has_path(result, "$.servers.alpha"))
            self.assertFalse(helpers.has_path(result, "$.servers.server_01"))

    def test_allows_itemtype_on_collection_with_union(self):
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


class QuotedAndKeywordKeyTests(unittest.TestCase):
    def test_supports_quoted_dotted_empty_and_schema_keyword_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
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
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
"" = "blank"
children = "literal"

[site]
"google.com" = true

[plugin]
type = "npm"
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(document_path)
            self.assertTrue(result.valid, msg=result.errors)


class PrecisionAndOrderingTests(unittest.TestCase):
    def test_preserves_numeric_precision_and_defines_temporal_ordering(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "value-semantics.tosd",
                """
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
""",
            )
            valid_path = helpers.write_file(
                tmp,
                "value-semantics-valid.toml",
                """
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
""",
            )
            invalid_path = helpers.write_file(
                tmp,
                "value-semantics-invalid.toml",
                """
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
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(valid_path)
            self.assertTrue(result.valid, msg=result.errors)

            invalid = schema.validate_file(invalid_path)
            for path in [
                "$.precise", "$.mixed", "$.nanValue", "$.nanRange", "$.zero",
                "$.instant", "$.instantMember", "$.localMember",
                "$.localDateTime", "$.localDate", "$.localTime",
            ]:
                with self.subTest(path=path):
                    self.assertTrue(helpers.has_path(invalid, path))

    def test_rejects_imprecise_allowed_value_comparison_at_load_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = helpers.write_file(
                tmp,
                "malformed.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
allowedvalues = [ 9007199254740993 ]
max = 9007199254740992.0
""",
            )
            with self.assertRaises(SchemaError):
                load_schema(path)


if __name__ == "__main__":
    unittest.main()
