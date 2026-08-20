"""Focused tests for the Python implementation's string formats."""

import tempfile
import unittest

import helpers
from toml_schema import SchemaError


class StringFormatTests(unittest.TestCase):
    def _schema(self, directory, format_name):
        return helpers.load_semantics_schema(
            directory,
            f"""
[elements.value]
type = "string"
format = "{format_name}"
""",
        )

    def test_email_format(self):
        valid = [
            "simple@example.com",
            "first.last+tag@example-domain.com",
            "\"quoted local\"@example.com",
            "\"escaped\\\"quote\"@example.com",
            "\"a@b\"@example.com",
            "postmaster@[192.0.2.1]",
            "postmaster@[IPv6:2001:db8::1]",
            "postmaster@[X-example:some-value]",
            f"{'a' * 64}@example.com",
            f"{'a' * 64}@{'b' * 63}.{'c' * 63}.{'d' * 59}",
            f"{'a' * 64}@{'b' * 63}.{'c' * 63}.{'d' * 61}",
        ]
        invalid = [
            "",
            "missing-at.example.com",
            "@example.com",
            ".leading@example.com",
            "trailing.@example.com",
            "two..dots@example.com",
            "white space@example.com",
            "user@example.com.",
            "user@-example.com",
            "user@example..com",
            "user@éxample.com",
            "é@example.com",
            "\"unterminated@example.com",
            "\"bad\nnewline\"@example.com",
            "\"bad\\\nescape\"@example.com",
            "postmaster@[192.168.001.1]",
            "postmaster@[IPv6:2001:::1]",
            "postmaster@[bad literal]",
            f"{'a' * 65}@example.com",
            f"{'a' * 64}@{'b' * 63}.{'c' * 63}.{'d' * 62}",
        ]
        with tempfile.TemporaryDirectory() as tmp:
            schema = self._schema(tmp, "email")
            for value in valid:
                with self.subTest(valid=value):
                    self.assertTrue(schema.validate({"value": value}).valid)
            for value in invalid:
                with self.subTest(invalid=value):
                    result = schema.validate({"value": value})
                    self.assertFalse(result.valid)
                    self.assertEqual(result.errors[0].message, "does not match format email")

    def test_uuid_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = self._schema(tmp, "uuid")
            for value in [
                "550e8400-e29b-41d4-a716-446655440000",
                "00000000-0000-0000-0000-000000000000",
                "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
            ]:
                with self.subTest(valid=value):
                    self.assertTrue(schema.validate({"value": value}).valid)
            for value in [
                "{550e8400-e29b-41d4-a716-446655440000}",
                "550e8400e29b41d4a716446655440000",
                "550e8400-e29b-41d4-a716-44665544000g",
            ]:
                with self.subTest(invalid=value):
                    self.assertFalse(schema.validate({"value": value}).valid)

    def test_uri_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = self._schema(tmp, "uri")
            for value in [
                "https://example.com/a%20path?q=x#fragment",
                "mailto:user@example.com",
                "urn:isbn:9780141036144",
                "file:///etc/hosts",
                "http://[v1.fe]/",
                "scheme:",
            ]:
                with self.subTest(valid=value):
                    self.assertTrue(schema.validate({"value": value}).valid)
            for value in [
                "example.com/path",
                "1http://example.com",
                "https://example.com/%",
                "https://example.com/%GG",
                "https://example.com/a path",
                "https://example.com/a#first#second",
                "https://éxample.com",
                "https://[not-ipv6]/",
                "https://example.com:bad/",
                "https://user@@example.com/",
            ]:
                with self.subTest(invalid=value):
                    self.assertFalse(schema.validate({"value": value}).valid)

    def test_hostname_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema = self._schema(tmp, "hostname")
            for value in ["example.com", "EXAMPLE", "a-b.example.", "a" * 63]:
                with self.subTest(valid=value):
                    self.assertTrue(schema.validate({"value": value}).valid)
            for value in [
                "",
                "-example.com",
                "example-.com",
                "example..com",
                "under_score.example",
                "éxample.com",
                "a" * 64,
                ".".join(["a" * 63] * 4),
            ]:
                with self.subTest(invalid=value):
                    self.assertFalse(schema.validate({"value": value}).valid)

    def test_ip_formats(self):
        cases = {
            "ipv4": (
                ["0.0.0.0", "192.0.2.1", "255.255.255.255"],
                ["192.168.001.1", "256.1.1.1", "1.2.3", "1.2.3.4.5", "1.2.3.-1"],
            ),
            "ipv6": (
                ["::", "::1", "2001:db8::1", "::ffff:192.0.2.128"],
                ["2001:::1", "1.2.3.4", "fe80::1%eth0", "12345::1"],
            ),
        }
        with tempfile.TemporaryDirectory() as tmp:
            for format_name, (valid, invalid) in cases.items():
                schema = self._schema(tmp, format_name)
                for value in valid:
                    with self.subTest(format=format_name, valid=value):
                        self.assertTrue(schema.validate({"value": value}).valid)
                for value in invalid:
                    with self.subTest(format=format_name, invalid=value):
                        self.assertFalse(schema.validate({"value": value}).valid)

    def test_format_schema_errors(self):
        cases = {
            "unknown": """
[elements.value]
type = "string"
format = "date"
""",
            "wrong-value-type": """
[elements.value]
type = "string"
format = 1
""",
            "incompatible": """
[elements.value]
type = "integer"
format = "email"
""",
            "named-reference": """
[types.email]
type = "string"
[elements.value]
type = "types.email"
format = "email"
""",
        }
        with tempfile.TemporaryDirectory() as tmp:
            for name, definitions in cases.items():
                with self.subTest(name=name), self.assertRaises(SchemaError):
                    helpers.load_semantics_schema(tmp, definitions)

    def test_allowed_value_must_match_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(SchemaError, "does not satisfy format email"):
                helpers.load_semantics_schema(
                    tmp,
                    """
[elements.value]
type = "string"
format = "email"
allowedvalues = ["not an email"]
""",
                )


if __name__ == "__main__":
    unittest.main()
