"""Shared test helpers for the toml_schema test suite.

Adds ``src/`` to ``sys.path`` so tests can ``import toml_schema`` without the
package being installed, and provides small utilities mirroring the Go test
suite's ``write``, ``fixture``, ``hasPath``, ``containsDiagnostic``, and
``diagnosticPaths`` helpers.
"""

from __future__ import annotations

import pathlib
import sys

_THIS_DIR = pathlib.Path(__file__).resolve().parent
_PYTHON_PACKAGE_ROOT = _THIS_DIR.parent
_SRC = _PYTHON_PACKAGE_ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

# reference-implementations/python/tests -> reference-implementations/python
# -> reference-implementations -> repo root
REPO_ROOT = _PYTHON_PACKAGE_ROOT.parent.parent


def repo_path(*parts: str) -> str:
    """Returns an absolute path to a repo-root-relative fixture file."""
    return str(REPO_ROOT.joinpath(*parts))


def write_file(directory, name: str, content: str) -> str:
    """Writes ``content`` to ``directory/name`` and returns the path as a str."""
    path = pathlib.Path(directory) / name
    path.write_text(content, encoding="utf-8")
    return str(path)


def load_semantics_schema(tmp_dir, definitions: str):
    """Loads a schema from ``[toml-schema]\\nversion = "1.0.0"\\n`` plus the
    given definitions body, mirroring Go's ``loadSemanticsSchema`` helper."""
    from toml_schema import load_schema

    content = '[toml-schema]\nversion = "1.0.0"\n' + definitions
    path = write_file(tmp_dir, "schema.tosd", content)
    return load_schema(path)


def has_path(result, path: str) -> bool:
    return any(error.path == path for error in result.errors)


def contains_diagnostic(diagnostics, path: str, message: str) -> bool:
    return any(d.path == path and d.message == message for d in diagnostics)


def diagnostic_paths(diagnostics):
    return sorted(d.path for d in diagnostics)
