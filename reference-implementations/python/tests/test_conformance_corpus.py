"""Shared conformance corpus runner.

Executes every case in the repository-root ``conformance/`` corpus against the
Python reference implementation and asserts the manifest's expected outcome.

Outcomes (from ``conformance/manifest.toml``):

- ``schema-load-error``  loading the schema MUST fail before any document is
  examined.
- ``validation-failure`` the schema MUST load successfully and validating the
  document MUST report at least one error.
- ``valid``              the schema MUST load successfully and the document MUST
  validate with no errors (warnings are permitted).

Requirement: load failure and validation failure are never conflated. A
``validation-failure`` case fails the suite if the schema does not load, because
that means the implementation rejects a schema the specification considers legal.
"""

import pathlib
import tomllib
import unittest

import helpers
from toml_schema import SchemaError, load_schema


def _find_repo_root() -> pathlib.Path:
    """Walks up from this test file to the directory containing ``conformance/``."""
    for parent in pathlib.Path(__file__).resolve().parents:
        if (parent / "conformance" / "manifest.toml").is_file():
            return parent
    raise RuntimeError("could not locate conformance/ above the test file")


_REPO_ROOT = _find_repo_root()
_CONFORMANCE = _REPO_ROOT / "conformance"


def _load_manifest():
    with (_CONFORMANCE / "manifest.toml").open("rb") as handle:
        return tomllib.load(handle)["case"]


class ConformanceCorpusTests(unittest.TestCase):
    def test_conformance_corpus(self):
        cases = _load_manifest()
        self.assertGreater(len(cases), 0, "manifest contained no cases")

        for case in cases:
            case_id = case["id"]
            expect = case["expect"]
            with self.subTest(id=case_id, expect=expect):
                case_dir = _CONFORMANCE / "cases" / case_id
                schema_path = str(case_dir / "schema.tosd")

                # Step 1: load the schema. Only a SchemaError counts as a load
                # failure; anything else propagates as a genuine test error.
                try:
                    schema = load_schema(schema_path)
                except SchemaError as exc:
                    load_error = exc
                else:
                    load_error = None

                if expect == "schema-load-error":
                    self.assertIsNotNone(
                        load_error,
                        msg=f"{case_id}: expected schema-load-error but schema loaded successfully",
                    )
                    continue

                # For valid / validation-failure the schema MUST have loaded.
                self.assertIsNone(
                    load_error,
                    msg=(
                        f"{case_id}: expected {expect} but schema failed to load: "
                        f"{load_error!r}"
                    ),
                )

                document_path = str(case_dir / "document.toml")
                result = schema.validate_file(document_path)

                if expect == "validation-failure":
                    self.assertFalse(
                        result.valid,
                        msg=f"{case_id}: expected validation-failure but document validated with no errors",
                    )
                elif expect == "valid":
                    self.assertTrue(
                        result.valid,
                        msg=f"{case_id}: expected valid but document reported errors: {result.errors}",
                    )
                else:
                    self.fail(f"{case_id}: unknown expect value {expect!r}")


if __name__ == "__main__":
    unittest.main()
