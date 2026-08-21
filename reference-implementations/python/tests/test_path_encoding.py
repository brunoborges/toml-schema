"""Path-segment encoding pins (SPEC.md ``### Instance Path`` / ``### Schema Path``).

The conformance corpus does NOT exercise control characters, so this entire
class of encoding bug is corpus-invisible. These tests pin the segment encoder
directly, in particular the normative requirement that ``\\u00XX`` escapes use
**lowercase** hexadecimal digits (``\\u001f``, never ``\\u001F``) -- paths are
compared as strings, so the digit case matters for cross-implementation
agreement.

Both encoders are covered: ``_encode_segment`` (schema paths) and
``_encode_path_key`` (instance paths) must agree character-for-character.
"""

import unittest

import helpers  # noqa: F401 -- adds src/ to sys.path
from toml_schema._schema import _encode_segment
from toml_schema._validator import _encode_path_key


_CASES = [
    # (input key, expected encoded segment)
    ("port", "port"),
    ("kebab-case_key9", "kebab-case_key9"),
    ("", '""'),
    ("google.com", '"google.com"'),
    ("has space", '"has space"'),
    ('quote"inside', '"quote\\"inside"'),
    ("back\\slash", '"back\\\\slash"'),
    ("\b", '"\\b"'),
    ("\t", '"\\t"'),
    ("\n", '"\\n"'),
    ("\f", '"\\f"'),
    ("\r", '"\\r"'),
    ("\u0001", '"\\u0001"'),
    ("\u001f", '"\\u001f"'),
    # Non-ASCII is not an ASCII letter, so the segment is a JSON string, but the
    # scalar itself passes through unescaped (never \u00e9).
    ("café", '"café"'),
    ("naïve.key", '"naïve.key"'),
]


class PathEncodingTests(unittest.TestCase):
    def test_encode_segment_pins(self):
        for key, expected in _CASES:
            with self.subTest(key=key):
                self.assertEqual(_encode_segment(key), expected)

    def test_encode_path_key_matches_encode_segment(self):
        for key, expected in _CASES:
            with self.subTest(key=key):
                self.assertEqual(_encode_path_key(key), expected)

    def test_control_escape_hex_is_lowercase(self):
        # SPEC.md ### Instance Path: "the digit case is normative:
        # `\u001f`, never `\u001F`."
        self.assertEqual(_encode_segment("\u001f"), '"\\u001f"')
        self.assertEqual(_encode_path_key("\u001f"), '"\\u001f"')
        # Every other C0 control below the named escapes uses \u00xx lowercase.
        self.assertEqual(_encode_segment("\u0000"), '"\\u0000"')
        self.assertEqual(_encode_segment("\u000b"), '"\\u000b"')  # vertical tab
        self.assertEqual(_encode_segment("\u001a"), '"\\u001a"')

    def test_non_ascii_passes_through_unescaped(self):
        # The scalar is emitted literally inside the JSON string, never \u-escaped.
        self.assertEqual(_encode_segment("café"), '"café"')
        self.assertEqual(_encode_path_key("Ω"), '"Ω"')


if __name__ == "__main__":
    unittest.main()
