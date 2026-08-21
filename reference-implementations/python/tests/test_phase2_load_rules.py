import tempfile
import unittest

import helpers
from toml_schema import SchemaError, load_schema


class Phase2SchemaLoadTests(unittest.TestCase):
    def _write_schema(self, directory: str, name: str, definition: str) -> str:
        return helpers.write_file(
            directory,
            name,
            f'[toml-schema]\nversion = "1.0.0"\n{definition}\n',
        )

    def test_normalizes_prefixed_builtins_before_selector_classification(self):
        with tempfile.TemporaryDirectory() as directory:
            valid = self._write_schema(
                directory,
                "valid.tosd",
                '[elements.port]\ntype = "types.integer"\nmin = 1\nmax = 65535',
            )
            load_schema(valid)

            invalid = self._write_schema(
                directory,
                "types-any.tosd",
                '[elements.value]\noneof = ["types.any"]',
            )
            with self.assertRaises(SchemaError):
                load_schema(invalid)

    def test_rejects_invalid_and_non_portable_patterns_at_schema_load(self):
        cases = (
            ("invalid", 'type = "string"\npattern = "["', "invalid-pattern"),
            ("shorthand", 'type = "string"\npattern = "\\\\d+"', "unsupported-pattern"),
            (
                "lookaround-key",
                'type = "collection"\nitemtype = "string"\nkeypattern = "(?=x)"',
                "unsupported-pattern",
            ),
        )
        with tempfile.TemporaryDirectory() as directory:
            for name, body, expected in cases:
                with self.subTest(name=name):
                    schema = self._write_schema(
                        directory, f"{name}.tosd", f"[elements.value]\n{body}"
                    )
                    with self.assertRaisesRegex(SchemaError, expected):
                        load_schema(schema)

    def test_loads_portable_character_escapes_and_escaped_metacharacters(self):
        with tempfile.TemporaryDirectory() as directory:
            schema = self._write_schema(
                directory,
                "portable-escapes.tosd",
                """
[elements.whitespace]
type = "string"
pattern = '[ \\t]'
[elements.controls]
type = "string"
pattern = '\\t\\n\\r\\f\\v\\a'
[elements.dot]
type = "string"
pattern = '\\.'
""",
            )
            load_schema(schema)

    def test_rejects_closed_conditional_branches_omitting_discriminator(self):
        with tempfile.TemporaryDirectory() as directory:
            for missing in ("then", "else"):
                with self.subTest(missing=missing):
                    then_child = "value" if missing == "then" else "engine"
                    else_child = "value" if missing == "else" else "engine"
                    schema = self._write_schema(
                        directory,
                        f"{missing}.tosd",
                        f"""
[types.selected]
type = "table"
[types.selected.{then_child}]
type = "string"
[types.fallback]
type = "table"
[types.fallback.{else_child}]
type = "string"
[elements.item]
if = {{ key = "engine", equals = "sqlite" }}
then = "types.selected"
else = "types.fallback"
""",
                    )
                    with self.assertRaises(SchemaError):
                        load_schema(schema)

    def test_rejects_non_table_conditional_default_at_schema_load(self):
        with tempfile.TemporaryDirectory() as directory:
            schema = self._write_schema(
                directory,
                "default.tosd",
                """
[types.selected]
type = "table"
[types.fallback]
type = "table"
[elements.item]
if = { key = "engine", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"
default = "sqlite"
""",
            )
            with self.assertRaises(SchemaError):
                load_schema(schema)


if __name__ == "__main__":
    unittest.main()
