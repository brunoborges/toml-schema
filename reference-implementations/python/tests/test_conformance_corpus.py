"""Shared conformance corpus runner.

Executes every case in the repository-root ``conformance/`` corpus against the
Python reference implementation and asserts the manifest's expected outcome
*and* its expected diagnostics.

Outcomes (from ``conformance/manifest.toml``):

- ``schema-load-error``     loading the schema MUST fail before any document is
  examined.
- ``validation-failure``    the schema MUST load and validating the document
  MUST report at least one error.
- ``valid``                 the schema MUST load and the document MUST validate
  with no errors (warnings are permitted).
- ``document-parse-error``  the document under validation is not well-formed
  TOML; the parse failure MUST NOT be reported as a diagnostic
  (``DocumentParseError`` is raised and zero diagnostics are produced).

Diagnostics (from ``[[case.diagnostics]]``) are asserted **present**, never as
an exact set: SPEC.md permits fail-fast, so a conforming implementation may emit
fewer or more diagnostics. Comparison is on ``(phase, severity, code,
instance_path, schema_path)`` only -- message text is never compared. The six
universal checks from ``conformance/README.md`` are applied to every diagnostic
of every case.

Requirement: load failure and validation failure are never conflated. A
``validation-failure`` case fails the suite if the schema does not load, because
that means the implementation rejects a schema the specification considers legal.
"""

import pathlib
import re
import tomllib
import unittest

import helpers
from toml_schema import Diagnostic, DocumentParseError, Phase, SchemaError, Severity, load_schema
from toml_schema._codes import ALL_EMITTABLE_CODES


def _find_repo_root() -> pathlib.Path:
    """Walks up from this test file to the directory containing ``conformance/``."""
    for parent in pathlib.Path(__file__).resolve().parents:
        if (parent / "conformance" / "manifest.toml").is_file():
            return parent
    raise RuntimeError("could not locate conformance/ above the test file")


_REPO_ROOT = _find_repo_root()
_CONFORMANCE = _REPO_ROOT / "conformance"

_EXTENSION_CODE = re.compile(r"^x-[a-z][a-z0-9]*-[a-z0-9-]+$")
_VALID_PHASES = {"discovery", "schema-load", "validation"}
_WARNING_CODES = {"deprecated", "version-mismatch"}


def _load_manifest():
    with (_CONFORMANCE / "manifest.toml").open("rb") as handle:
        return tomllib.load(handle)["case"]


def _load_registry_codes():
    with (_CONFORMANCE / "codes.toml").open("rb") as handle:
        registry = tomllib.load(handle)
    return {entry["name"] for entry in registry["code"]}


_REGISTRY_CODES = _load_registry_codes()


def _scan_json_string(text: str, start: int):
    """Scans an RFC 8259 JSON string beginning at ``text[start] == '"'``.
    Returns the index just past the closing quote, or None if malformed."""
    i = start + 1
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\":
            if i + 1 >= n:
                return None
            esc = text[i + 1]
            if esc in '"\\/bfnrt':
                i += 2
            elif esc == "u":
                if i + 6 > n or not all(
                    c in "0123456789abcdefABCDEF" for c in text[i + 2 : i + 6]
                ):
                    return None
                i += 6
            else:
                return None
        elif ch == '"':
            return i + 1
        elif ord(ch) < 0x20:
            return None
        else:
            i += 1
    return None


def _parses_as_path(path: str) -> bool:
    """Returns True if ``path`` parses under the instance/schema path grammar:
    a leading ``$``, then a sequence of ``.``-prefixed key segments (bare
    ``[A-Za-z0-9_-]+`` or an RFC 8259 JSON string) and ``[index]`` array
    segments (no sign, no leading zeros)."""
    if not path or path[0] != "$":
        return False
    i = 1
    n = len(path)
    while i < n:
        ch = path[i]
        if ch == ".":
            i += 1
            if i >= n:
                return False
            if path[i] == '"':
                end = _scan_json_string(path, i)
                if end is None:
                    return False
                i = end
            else:
                start = i
                while i < n and path[i].isascii() and (path[i].isalnum() or path[i] in "_-"):
                    i += 1
                if i == start:
                    return False
        elif ch == "[":
            j = i + 1
            start = j
            while j < n and path[j].isdigit():
                j += 1
            digits = path[start:j]
            if not digits or (len(digits) > 1 and digits[0] == "0"):
                return False
            if j >= n or path[j] != "]":
                return False
            i = j + 1
        else:
            return False
    return True


def _diag_key(diag: Diagnostic):
    return (str(diag.phase), str(diag.severity), diag.code, diag.instance_path, diag.schema_path)


def _schema_error_diagnostic(exc: SchemaError) -> Diagnostic:
    """Adapts a raised SchemaError into a Diagnostic for the corpus comparison,
    mirroring how a schema-load failure surfaces to a caller."""
    return Diagnostic(
        severity=Severity.ERROR,
        code=exc.code,
        instance_path=None,
        message=str(exc),
        phase=Phase.SCHEMA_LOAD,
        schema_path=exc.schema_path,
    )


class ConformanceCorpusTests(unittest.TestCase):
    def _check_universal(self, case_id, expect, diagnostics):
        """Applies the six universal checks (conformance/README.md) to every
        diagnostic of a case."""
        error_count = 0
        for diag in diagnostics:
            code = diag.code
            severity = str(diag.severity)
            phase = str(diag.phase)
            label = f"{case_id}: diagnostic {code!r}"

            # Check 1: unprefixed code in registry, or an extension code.
            if not _EXTENSION_CODE.match(code):
                self.assertIn(
                    code,
                    _REGISTRY_CODES,
                    msg=f"{label} is neither a registry code nor an extension code",
                )

            # Check 2: valid severity and phase.
            self.assertIn(severity, {"error", "warning"}, msg=f"{label} bad severity")
            self.assertIn(phase, _VALID_PHASES, msg=f"{label} bad phase {phase!r}")

            # Check 3: only deprecated / version-mismatch are warnings.
            if severity == "warning":
                self.assertIn(
                    code,
                    _WARNING_CODES,
                    msg=f"{label} is a warning but not a permitted warning code",
                )
            else:
                error_count += 1

            # Check 4: schema-load and discovery diagnostics carry no instance path.
            if phase in {"schema-load", "discovery"}:
                self.assertIsNone(
                    diag.instance_path,
                    msg=f"{label} is a {phase} diagnostic but carries an instance_path",
                )

            # Check 5: both paths parse under the grammar.
            if diag.instance_path is not None:
                self.assertTrue(
                    _parses_as_path(diag.instance_path),
                    msg=f"{label} instance_path does not parse: {diag.instance_path!r}",
                )
            if diag.schema_path is not None:
                self.assertTrue(
                    _parses_as_path(diag.schema_path),
                    msg=f"{label} schema_path does not parse: {diag.schema_path!r}",
                )

        # Check 6: valid => no error; validation-failure => at least one error.
        if expect == "valid":
            self.assertEqual(
                error_count, 0, msg=f"{case_id}: valid case produced error diagnostics"
            )
        elif expect == "validation-failure":
            self.assertGreater(
                error_count, 0, msg=f"{case_id}: validation-failure produced no error"
            )

    def _assert_expected_present(self, case_id, expectations, actual):
        """Asserts every expected diagnostic is present (subset semantics),
        comparing only the asserted fields. An omitted instance_path/schema_path
        means unasserted, not 'must be absent'."""
        actual_keys = [_diag_key(d) for d in actual]
        for exp in expectations:
            phase = exp["phase"]
            severity = exp["severity"]
            code = exp["code"]
            has_instance = "instance_path" in exp
            has_schema = "schema_path" in exp
            matched = False
            for phase_a, severity_a, code_a, instance_a, schema_a in actual_keys:
                if phase_a != phase or severity_a != severity or code_a != code:
                    continue
                if has_instance and instance_a != exp["instance_path"]:
                    continue
                if has_schema and schema_a != exp["schema_path"]:
                    continue
                matched = True
                break
            self.assertTrue(
                matched,
                msg=(
                    f"{case_id}: expected diagnostic not present: "
                    f"phase={phase} severity={severity} code={code} "
                    f"instance_path={exp.get('instance_path')!r} "
                    f"schema_path={exp.get('schema_path')!r}\n"
                    f"  actual: {actual_keys}"
                ),
            )

    def test_conformance_corpus(self):
        cases = _load_manifest()
        self.assertGreater(len(cases), 0, "manifest contained no cases")

        for case in cases:
            case_id = case["id"]
            expect = case["expect"]
            expectations = case.get("diagnostics", [])
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
                    diagnostics = [_schema_error_diagnostic(load_error)]
                    self._check_universal(case_id, expect, diagnostics)
                    self._assert_expected_present(case_id, expectations, diagnostics)
                    continue

                # For valid / validation-failure / document-parse-error the
                # schema MUST have loaded.
                self.assertIsNone(
                    load_error,
                    msg=(
                        f"{case_id}: expected {expect} but schema failed to load: "
                        f"{load_error!r}"
                    ),
                )

                document_path = str(case_dir / "document.toml")

                if expect == "document-parse-error":
                    # A document that is not well-formed TOML MUST NOT be reported
                    # as a diagnostic: validate_file raises DocumentParseError and
                    # produces zero diagnostics.
                    with self.assertRaises(DocumentParseError):
                        schema.validate_file(document_path)
                    self.assertEqual(
                        expectations,
                        [],
                        msg=f"{case_id}: document-parse-error cases must assert no diagnostics",
                    )
                    continue

                result = schema.validate_file(document_path)
                diagnostics = [*result.errors, *result.warnings]
                self._check_universal(case_id, expect, diagnostics)
                self._assert_expected_present(case_id, expectations, diagnostics)

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

    def test_every_emittable_code_is_registered(self):
        """Registry guard: every code the implementation can emit MUST appear in
        the SPEC.md-derived registry. Catches typos in code literals."""
        missing = sorted(ALL_EMITTABLE_CODES - _REGISTRY_CODES)
        self.assertEqual(
            missing,
            [],
            msg=f"implementation emits codes absent from conformance/codes.toml: {missing}",
        )


if __name__ == "__main__":
    unittest.main()
