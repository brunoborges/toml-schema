"""ABNF vocabulary-alignment conformance test.

Ports Go's abnf_conformance_test.go: the Python schema loader's definition-key
vocabulary must exactly match the ABNF ``schema-key`` production, and the
implementation's built-in ``SchemaType`` values must exactly match the
built-in-type name tokens documented in ``toml-schema.abnf`` (excluding
schema-key tokens themselves).
"""

import re
import unittest

import helpers
from toml_schema import SchemaType
from toml_schema._schema import DEFINITION_KEYS

_TOKEN_COMMENT_PATTERN = re.compile(r';\s*"([^"]+)"')


def _read_abnf() -> str:
    with open(helpers.repo_path("toml-schema.abnf"), encoding="utf-8") as handle:
        return handle.read()


def _rule_expression(rule_name: str, abnf: str) -> str:
    lines = abnf.split("\n")
    expression_parts = []
    in_rule = False
    for line in lines:
        if line.startswith(rule_name + " ="):
            _, _, value = line.partition("=")
            expression_parts.append(value.strip())
            in_rule = True
            continue
        if in_rule:
            if line.startswith(" ") or line.startswith("\t"):
                expression_parts.append(line.strip())
                continue
            break
    return " ".join(expression_parts)


def _alternatives_for(rule_name: str, abnf: str):
    expression = _rule_expression(rule_name, abnf)
    tokens = []
    for token in expression.split("/"):
        token = token.strip()
        if not token or token == "version":
            continue
        tokens.append(token)
    return tokens


def _built_in_type_tokens(abnf: str):
    tokens = []
    for line in abnf.split("\n"):
        match = _TOKEN_COMMENT_PATTERN.search(line)
        if not match:
            continue
        token = match.group(1)
        if token in DEFINITION_KEYS:
            continue
        tokens.append(token)
    return tokens


class AbnfConformanceTests(unittest.TestCase):
    def test_schema_loader_definition_keys_match_abnf_schema_keys(self):
        abnf = _read_abnf()
        expected = _alternatives_for("schema-key", abnf)
        self.assertEqual(sorted(DEFINITION_KEYS), sorted(expected))

    def test_schema_types_match_abnf_built_in_types(self):
        abnf = _read_abnf()
        implementation_types = [member.value for member in SchemaType]
        self.assertEqual(sorted(implementation_types), sorted(_built_in_type_tokens(abnf)))


if __name__ == "__main__":
    unittest.main()
