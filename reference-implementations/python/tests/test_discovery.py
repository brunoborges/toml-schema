"""Schema discovery tests: locating a schema via a document's
``[toml-schema].location`` metadata, version-compatibility warnings, and
error handling for malformed metadata. Ports Go's
``TestLocatesSchemaFromDocumentMetadata`` and
``TestRejectsNonScalarSchemaReferenceMetadata`` (schema_test.go), plus
additional coverage for absolute paths and version mismatches."""

import os
import tempfile
import unittest

import helpers
from toml_schema import DiscoveryError, schema_from_document, validate_document


class SchemaFromDocumentTests(unittest.TestCase):
    def test_locates_schema_from_document_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
title = "Example"

[toml-schema]
version = "1.0.0"
location = "schema.tosd"
""",
            )
            schema, document = schema_from_document(document_path)
            result = schema.validate(document)
            self.assertTrue(result.valid, msg=result.errors)
            self.assertEqual(schema.warnings, [])

    def test_rejects_non_scalar_schema_reference_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
[toml-schema]
location = ["schema.tosd"]
""",
            )
            with self.assertRaisesRegex(DiscoveryError, "must be a scalar value"):
                schema_from_document(document_path)

    def test_locates_schema_using_absolute_path_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                f"""
title = "Example"

[toml-schema]
version = "1.0.0"
location = "{os.path.abspath(schema_path)}"
""",
            )
            schema, document = schema_from_document(document_path)
            result = schema.validate(document)
            self.assertTrue(result.valid, msg=result.errors)

    def test_locates_schema_using_file_uri_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            helpers.write_file(
                tmp,
                "nested",
                "",
            )
            os.makedirs(os.path.join(tmp, "sub"), exist_ok=True)
            helpers.write_file(
                os.path.join(tmp, "sub"),
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
title = "Example"

[toml-schema]
version = "1.0.0"
location = "sub/schema.tosd"
""",
            )
            schema, document = schema_from_document(document_path)
            result = schema.validate(document)
            self.assertTrue(result.valid, msg=result.errors)

    def test_warns_on_compatible_but_differing_document_schema_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
title = "Example"

[toml-schema]
version = "1.0.1"
location = "schema.tosd"
""",
            )
            schema, document = schema_from_document(document_path)
            self.assertEqual(len(schema.warnings), 1)
            self.assertIn("1.0.1", schema.warnings[0])
            self.assertIn("1.0.0", schema.warnings[0])

    def test_rejects_incompatible_major_document_schema_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
title = "Example"

[toml-schema]
version = "2.0.0"
location = "schema.tosd"
""",
            )
            with self.assertRaises(DiscoveryError):
                schema_from_document(document_path)

    def test_rejects_opaque_file_uri_location(self):
        from toml_schema import resolve_schema_location

        with tempfile.TemporaryDirectory() as tmp:
            document_path = helpers.write_file(tmp, "document.toml", "")
            with self.assertRaises(DiscoveryError):
                resolve_schema_location(document_path, "file:something")

    def test_rejects_non_local_host_file_uri_location(self):
        from toml_schema import resolve_schema_location

        with tempfile.TemporaryDirectory() as tmp:
            document_path = helpers.write_file(tmp, "document.toml", "")
            with self.assertRaisesRegex(DiscoveryError, "non-local host"):
                resolve_schema_location(document_path, "file://evil.example/etc/passwd")

    def test_rejects_query_and_fragment_file_uri_location(self):
        from toml_schema import resolve_schema_location

        with tempfile.TemporaryDirectory() as tmp:
            document_path = helpers.write_file(tmp, "document.toml", "")
            for location in ["file:///a/b?x=1", "file:///a/b#frag"]:
                with self.subTest(location=location):
                    with self.assertRaises(DiscoveryError):
                        resolve_schema_location(document_path, location)

    def test_rejects_unsupported_scheme_location(self):
        from toml_schema import resolve_schema_location

        with tempfile.TemporaryDirectory() as tmp:
            document_path = helpers.write_file(tmp, "document.toml", "")
            with self.assertRaisesRegex(DiscoveryError, "unsupported schema location URI scheme"):
                resolve_schema_location(document_path, "http://example.com/schema.tosd")

    def test_resolves_absolute_hierarchical_file_uri_location(self):
        from toml_schema import resolve_schema_location

        with tempfile.TemporaryDirectory() as tmp:
            document_path = helpers.write_file(tmp, "document.toml", "")
            schema_path = helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
""",
            )
            import urllib.parse

            uri = "file://" + urllib.parse.quote(schema_path)
            resolved = resolve_schema_location(document_path, uri)
            self.assertEqual(os.path.normpath(resolved), os.path.normpath(schema_path))

    def test_rejects_document_missing_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
title = "Example"
""",
            )
            with self.assertRaises(DiscoveryError):
                schema_from_document(document_path)


class ValidateDocumentConvenienceTests(unittest.TestCase):
    def test_validate_document_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            helpers.write_file(
                tmp,
                "schema.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.title]
type = "string"
""",
            )
            document_path = helpers.write_file(
                tmp,
                "document.toml",
                """
title = "Example"

[toml-schema]
version = "1.0.0"
location = "schema.tosd"
""",
            )
            result = validate_document(document_path)
            self.assertTrue(result.valid, msg=result.errors)

    def test_validate_document_reports_discovery_failure_as_diagnostic(self):
        with tempfile.TemporaryDirectory() as tmp:
            document_path = helpers.write_file(tmp, "document.toml", 'title = "Example"\n')
            result = validate_document(document_path)
            self.assertFalse(result.valid)
            self.assertEqual(len(result.errors), 1)
            self.assertEqual(result.errors[0].path, "$")

    def test_validate_document_using_checked_in_config_example(self):
        result = validate_document(helpers.repo_path("config.toml"))
        self.assertTrue(result.valid, msg=result.errors)


if __name__ == "__main__":
    unittest.main()
