from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from helpers import write_file
from toml_schema import extract_schema_file, generate_schema, load_document, load_schema


class SchemaExtractionTests(unittest.TestCase):
    def test_generates_deterministic_schema_for_parsed_values(self) -> None:
        document = {
            "zebra": "last",
            "alpha": 1,
            "ratio": 1.5,
            "flag": True,
            "numbers": [1, 2],
            "mixed": [1, "two"],
            "nested": {"google.com": "value"},
            "toml-schema": {"location": "ignored.tosd"},
        }

        schema = generate_schema(document)

        self.assertIn('[elements.alpha]\ntype = "integer"', schema)
        self.assertIn('[elements.flag]\ntype = "boolean"', schema)
        self.assertIn('[elements.ratio]\ntype = "float"', schema)
        self.assertIn('[elements.numbers]\ntype = "array"\nitemtype = "integer"', schema)
        self.assertIn('[elements.mixed]\ntype = "array"\nitemtype = "any"', schema)
        self.assertIn('[elements.nested."google.com"]\ntype = "string"', schema)
        self.assertNotIn("[elements.toml-schema]", schema)
        self.assertNotIn("default =", schema)
        self.assertLess(schema.index("[elements.alpha]"), schema.index("[elements.zebra]"))

    def test_extracts_reloadable_schema_with_all_temporal_types(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            document_path = write_file(
                directory,
                "source.toml",
                """
title = "Example"
offset = 1979-05-27T07:32:00-08:00
local_datetime = 1979-05-27T07:32:00
local_date = 1979-05-27
local_time = 07:32:00
ports = [8080, 8081]

[owner]
name = "Ada"

[toml-schema]
location = "ignored.tosd"
""",
            )
            schema_path = f"{directory}/generated.tosd"

            extract_schema_file(document_path, schema_path)

            schema_text = Path(schema_path).read_text(encoding="utf-8")
            self.assertIn('type = "offset-date-time"', schema_text)
            self.assertIn('type = "local-date-time"', schema_text)
            self.assertIn('type = "local-date"', schema_text)
            self.assertIn('type = "local-time"', schema_text)
            result = load_schema(schema_path).validate(load_document(document_path))
            self.assertTrue(result.valid, result.errors)


if __name__ == "__main__":
    unittest.main()
