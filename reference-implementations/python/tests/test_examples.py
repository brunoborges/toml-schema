"""Checked-in example and self-schema conformance tests.

Ports the core coverage of Go's ``TestValidatesCheckedInExample``,
``TestLoadsCheckedInExamples``, ``TestValidatesCargoManifestExample``, and
``TestEnforcesClosedRootElementSemantics`` (schema_test.go).
"""

import unittest

import helpers
from toml_schema import SchemaError, load_schema


class CheckedInExampleTests(unittest.TestCase):
    def test_validates_checked_in_config_example(self):
        schema = load_schema(helpers.repo_path("config.tosd"))
        result = schema.validate_file(helpers.repo_path("config.toml"))
        self.assertTrue(result.valid, msg=result.errors)

    def test_loads_all_checked_in_example_schemas(self):
        for name in [
            "cargo.tosd",
            "database-conditional.tosd",
            "gitlab-runner.tosd",
            "hugo.tosd",
            "netlify.tosd",
            "pyproject.tosd",
            "wrangler.tosd",
        ]:
            with self.subTest(name=name):
                load_schema(helpers.repo_path("examples", name))

    def test_validates_cargo_manifest_example(self):
        schema = load_schema(helpers.repo_path("examples", "cargo.tosd"))
        result = schema.validate_file(
            helpers.repo_path("reference-implementations", "rust", "Cargo.toml")
        )
        self.assertTrue(result.valid, msg=result.errors)

    def test_validates_database_conditional_examples(self):
        schema = load_schema(helpers.repo_path("examples", "database-conditional.tosd"))
        for name in ["database-postgresql.toml", "database-sqlite.toml"]:
            with self.subTest(name=name):
                result = schema.validate_file(helpers.repo_path("examples", name))
                self.assertTrue(result.valid, msg=result.errors)


class SelfSchemaTests(unittest.TestCase):
    """The TOML Schema self-schema (toml-schema.tosd) must load and must
    validate both itself and the checked-in config.tosd example."""

    def test_self_schema_loads(self):
        load_schema(helpers.repo_path("toml-schema.tosd"))

    def test_self_schema_validates_itself(self):
        schema = load_schema(helpers.repo_path("toml-schema.tosd"))
        result = schema.validate_file(helpers.repo_path("toml-schema.tosd"))
        self.assertTrue(result.valid, msg=result.errors)

    def test_self_schema_validates_config_tosd(self):
        schema = load_schema(helpers.repo_path("toml-schema.tosd"))
        result = schema.validate_file(helpers.repo_path("config.tosd"))
        self.assertTrue(result.valid, msg=result.errors)


class ClosedRootElementTests(unittest.TestCase):
    def test_closed_root_element_semantics(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "closed-root.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements]
""",
            )
            empty_document = helpers.write_file(tmp, "empty.toml", "")
            metadata_only_document = helpers.write_file(
                tmp,
                "metadata-only.toml",
                """
[toml-schema]
location = "closed-root.tosd"
""",
            )
            application_document = helpers.write_file(tmp, "application.toml", "extra = true")
            defined_root_schema = helpers.write_file(
                tmp,
                "defined-root.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.allowed]
type = "string"
""",
            )
            document_with_extra_key = helpers.write_file(
                tmp,
                "extra-key.toml",
                """
allowed = "value"
extra = true
""",
            )

            schema = load_schema(schema_path)
            for document in [empty_document, metadata_only_document]:
                result = schema.validate_file(document)
                self.assertTrue(result.valid, msg=(document, result.errors))

            result = schema.validate_file(application_document)
            self.assertFalse(result.valid)
            self.assertTrue(helpers.has_path(result, "$.extra"))

            defined_schema = load_schema(defined_root_schema)
            result = defined_schema.validate_file(document_with_extra_key)
            self.assertFalse(result.valid)
            self.assertTrue(helpers.has_path(result, "$.extra"))

            schema_schema = load_schema(helpers.repo_path("toml-schema.tosd"))
            result = schema_schema.validate_file(schema_path)
            self.assertTrue(result.valid, msg=result.errors)


class DescriptionTests(unittest.TestCase):
    def test_accepts_string_descriptions_and_rejects_other_values(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            described_schema = helpers.write_file(
                tmp,
                "described.tosd",
                """
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
""",
            )
            load_schema(described_schema)  # must not raise

            invalid_schema = helpers.write_file(
                tmp,
                "invalid-description.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.game]
type = "string"
description = 42
""",
            )
            with self.assertRaises(SchemaError):
                load_schema(invalid_schema)


class ChildrenEscapeTests(unittest.TestCase):
    def test_selective_children_escape_and_literal_children(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            schema_path = helpers.write_file(
                tmp,
                "children-escape.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

[elements.plugin.children.type]
type = "string"

[elements.plugin.children.children]
type = "boolean"
""",
            )
            document_path = helpers.write_file(
                tmp,
                "children-escape.toml",
                """
[plugin]
type = "npm"
children = true
""",
            )
            schema = load_schema(schema_path)
            result = schema.validate_file(document_path)
            self.assertTrue(result.valid, msg=result.errors)

            literal_schema_path = helpers.write_file(
                tmp,
                "literal-children.tosd",
                """
[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

[elements.plugin.children]
type = "string"
""",
            )
            literal_document_path = helpers.write_file(
                tmp,
                "literal-children.toml",
                """
[plugin]
children = "ordinary child"
""",
            )
            literal_schema = load_schema(literal_schema_path)
            literal_result = literal_schema.validate_file(literal_document_path)
            self.assertTrue(literal_result.valid, msg=literal_result.errors)

    def test_rejects_invalid_children_escape_namespaces(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            for name, body in (
                ("empty", "[elements.plugin.children]"),
                (
                    "non-conflicting",
                    """
[elements.plugin.children.name]
type = "string"
""",
                ),
            ):
                with self.subTest(name=name):
                    schema_path = helpers.write_file(
                        tmp,
                        f"{name}.tosd",
                        f"""
[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

{body}
""",
                    )
                    with self.assertRaises(SchemaError):
                        load_schema(schema_path)


if __name__ == "__main__":
    unittest.main()
