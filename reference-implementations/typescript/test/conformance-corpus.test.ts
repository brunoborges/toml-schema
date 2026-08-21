import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  loadSchema,
  parseToml,
  SchemaError,
  DocumentParseError,
  DiagnosticCodes,
  type Diagnostic,
} from "../src/index.js";

/**
 * Shared conformance corpus runner.
 *
 * Executes every case in the repository-root `conformance/` corpus against the
 * TypeScript reference implementation. Besides reproducing each case's coarse
 * `expect` outcome (from `conformance/manifest.toml`), it asserts the normative
 * diagnostic model: every `[[case.diagnostics]]` expectation must be present
 * (REQUIRED-PRESENT, not an exact set), and the six universal checks from
 * `conformance/README.md` are applied to every diagnostic the implementation
 * emits.
 *
 * Outcomes:
 * - `schema-load-error`     loading the schema MUST fail before any document is
 *   examined.
 * - `validation-failure`    the schema MUST load and validating the document
 *   MUST report at least one error.
 * - `valid`                 the schema MUST load and the document MUST validate
 *   with no errors (warnings are permitted).
 * - `document-parse-error`  the document is not well-formed TOML: it never
 *   reaches the validator and MUST yield no diagnostics at all.
 */

const EXTENSION_CODE = /^x-[a-z][a-z0-9]*-[a-z0-9-]+$/;
const BARE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walks up from this test file to the directory containing `conformance/`. */
function findRepoRoot(): string {
  let dir = here;
  while (true) {
    if (existsSync(path.join(dir, "conformance", "manifest.toml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("could not locate conformance/ above the test file");
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot();
const CONFORMANCE = path.join(REPO_ROOT, "conformance");

interface ExpectedDiagnostic {
  phase: string;
  severity: string;
  code: string;
  instance_path?: string;
  schema_path?: string;
}

interface Case {
  id: string;
  expect: string;
  diagnostics?: ExpectedDiagnostic[];
}

interface RegistryEntry {
  severity: string;
  phases: string[];
}

const manifestSource = await readFile(path.join(CONFORMANCE, "manifest.toml"), "utf-8");
const cases = (parseToml(manifestSource).case as unknown as Case[]) ?? [];

const codesSource = await readFile(path.join(CONFORMANCE, "codes.toml"), "utf-8");
const registry = new Map<string, RegistryEntry>();
for (const entry of (parseToml(codesSource).code as unknown as {
  name: string;
  severity: string;
  phases?: string[];
}[]) ?? []) {
  registry.set(entry.name, { severity: entry.severity, phases: entry.phases ?? [] });
}

/** Synthesizes a diagnostic record from a thrown {@link SchemaError}. */
function diagnosticFromSchemaError(error: SchemaError): Diagnostic {
  return {
    phase: error.phase,
    severity: "error",
    code: error.code,
    // Schema-load/discovery errors never carry an instance path; `path` here is a
    // sentinel that the universal checks below treat as absent for those phases.
    path: "$",
    schemaPath: error.schemaPath,
    message: error.message,
  };
}

/**
 * REQUIRED-PRESENT match on `(phase, severity, code, instance_path, schema_path)`.
 * An omitted path in the expectation is unasserted; message is never compared.
 */
function matches(expected: ExpectedDiagnostic, actual: Diagnostic, actualInstancePath: string | undefined): boolean {
  if (expected.phase !== actual.phase) return false;
  if (expected.severity !== actual.severity) return false;
  if (expected.code !== actual.code) return false;
  if (expected.instance_path !== undefined && expected.instance_path !== actualInstancePath) {
    return false;
  }
  return expected.schema_path === undefined || expected.schema_path === actual.schemaPath;
}

/** Validates an instance or schema path against the SPEC.md path grammar. */
function pathIsValid(p: string | undefined): boolean {
  if (p === undefined) return true;
  if (!p.startsWith("$")) return false;
  let i = 1;
  const n = p.length;
  while (i < n) {
    const c = p[i];
    if (c === ".") {
      i++;
      if (i >= n) return false;
      if (p[i] === '"') {
        const end = scanJsonString(p, i);
        if (end < 0) return false;
        i = end;
      } else {
        const start = i;
        while (i < n && p[i] !== "." && p[i] !== "[") i++;
        if (!BARE_SEGMENT.test(p.slice(start, i))) return false;
      }
    } else if (c === "[") {
      const close = p.indexOf("]", i);
      if (close < 0) return false;
      if (!ARRAY_INDEX.test(p.slice(i + 1, close))) return false;
      i = close + 1;
    } else {
      return false;
    }
  }
  return true;
}

function scanJsonString(p: string, start: number): number {
  let i = start + 1;
  const n = p.length;
  while (i < n) {
    const c = p[i];
    if (c === "\\") {
      if (i + 1 >= n) return -1;
      const next = p.charAt(i + 1);
      if ('"\\/bfnrt'.includes(next)) {
        i += 2;
      } else if (next === "u" && i + 5 < n) {
        i += 6;
      } else {
        return -1;
      }
    } else if (c === '"') {
      return i + 1;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Applies the six universal checks from `conformance/README.md` to every
 * diagnostic the implementation emitted for a case. `schemaLoadPhase` flags the
 * synthetic schema-load diagnostic whose sentinel `path` must be treated as an
 * absent instance path.
 */
function checkUniversal(testCase: Case, actual: Diagnostic[], instancePaths: (string | undefined)[]): void {
  let sawError = false;
  actual.forEach((diagnostic, idx) => {
    const code = diagnostic.code;
    const where = `case ${testCase.id} diagnostic ${JSON.stringify(diagnostic)}`;

    // 1. Code is registered or a namespaced extension code.
    const entry = registry.get(code);
    if (entry === undefined) {
      assert.ok(EXTENSION_CODE.test(code), `${where}: code '${code}' is neither registered nor a valid extension code`);
    }

    // 2. Severity and phase are well-formed.
    assert.ok(
      diagnostic.severity === "error" || diagnostic.severity === "warning",
      `${where}: invalid severity ${diagnostic.severity}`,
    );
    assert.ok(
      diagnostic.phase === "discovery" || diagnostic.phase === "schema-load" || diagnostic.phase === "validation",
      `${where}: invalid phase ${diagnostic.phase}`,
    );

    // 3. Only deprecated and version-mismatch are warnings.
    if (diagnostic.severity === "warning") {
      assert.ok(
        code === "deprecated" || code === "version-mismatch",
        `${where}: only deprecated/version-mismatch may be warnings`,
      );
    } else if (entry !== undefined) {
      assert.equal(entry.severity, "error", `${where}: registry marks '${code}' as ${entry.severity}`);
    }

    // 4. Schema-load and discovery diagnostics carry no instance path.
    if (diagnostic.phase === "schema-load" || diagnostic.phase === "discovery") {
      assert.equal(
        instancePaths[idx],
        undefined,
        `${where}: ${diagnostic.phase} diagnostic must not carry an instance_path`,
      );
    }

    // 5. Any instance/schema path parses under the path grammar.
    assert.ok(pathIsValid(instancePaths[idx]), `${where}: instance_path does not parse: ${instancePaths[idx]}`);
    assert.ok(pathIsValid(diagnostic.schemaPath), `${where}: schema_path does not parse: ${diagnostic.schemaPath}`);

    if (diagnostic.severity === "error") sawError = true;
  });

  // 6. valid => no error; validation-failure => at least one error.
  if (testCase.expect === "valid") {
    assert.ok(!sawError, `case ${testCase.id}: valid case must not produce an error diagnostic`);
  } else if (testCase.expect === "validation-failure") {
    assert.ok(sawError, `case ${testCase.id}: validation-failure must produce at least one error`);
  }
}

function assertExpectedPresent(testCase: Case, actual: Diagnostic[], instancePaths: (string | undefined)[]): void {
  for (const expected of testCase.diagnostics ?? []) {
    const present = actual.some((d, idx) => matches(expected, d, instancePaths[idx]));
    assert.ok(
      present,
      `case ${testCase.id}: expected diagnostic ${JSON.stringify(expected)} not present in actual diagnostics ${JSON.stringify(actual)}`,
    );
  }
}

test("conformance corpus", async (t) => {
  assert.ok(cases.length > 0, "manifest contained no cases");

  for (const testCase of cases) {
    const { id, expect } = testCase;
    await t.test(`${id} (${expect})`, async () => {
      const caseDir = path.join(CONFORMANCE, "cases", id);
      const schemaPath = path.join(caseDir, "schema.tosd");

      // Collected diagnostics, alongside a parallel array of the instance path each
      // one carries (undefined for schema-load/discovery diagnostics, whose synthetic
      // record uses a sentinel `path`).
      const actual: Diagnostic[] = [];
      const instancePaths: (string | undefined)[] = [];

      let schema: Awaited<ReturnType<typeof loadSchema>> | undefined;
      let loadError: SchemaError | undefined;
      try {
        schema = await loadSchema(schemaPath);
      } catch (err) {
        if (err instanceof SchemaError) {
          loadError = err;
          actual.push(diagnosticFromSchemaError(err));
          instancePaths.push(undefined);
        } else {
          throw err;
        }
      }

      if (loadError !== undefined) {
        assert.equal(
          expect,
          "schema-load-error",
          `${id}: expected ${expect} but the schema failed to load: ${loadError.message}`,
        );
        checkUniversal(testCase, actual, instancePaths);
        assertExpectedPresent(testCase, actual, instancePaths);
        return;
      }

      assert.notEqual(expect, "schema-load-error", `${id}: expected schema-load-error but the schema loaded successfully`);

      const documentPath = path.join(caseDir, "document.toml");
      let result: Awaited<ReturnType<NonNullable<typeof schema>["validateFile"]>>;
      try {
        result = await schema!.validateFile(documentPath);
      } catch (err) {
        if (err instanceof DocumentParseError) {
          // A document that is not well-formed TOML never reaches the validator, so it
          // yields no diagnostics at all.
          assert.equal(
            expect,
            "document-parse-error",
            `${id}: expected ${expect} but the document failed to parse as TOML: ${err.message}`,
          );
          assert.equal(actual.length, 0, `${id}: a document-parse-error must produce no diagnostics`);
          return;
        }
        throw err;
      }

      assert.notEqual(
        expect,
        "document-parse-error",
        `${id}: expected document-parse-error but the document parsed successfully`,
      );

      for (const diagnostic of result.diagnostics) {
        actual.push(diagnostic);
        instancePaths.push(diagnostic.path);
      }

      if (expect === "validation-failure") {
        assert.equal(result.valid, false, `${id}: expected validation-failure but document validated with no errors`);
      } else if (expect === "valid") {
        assert.equal(result.valid, true, `${id}: expected valid but document reported errors: ${JSON.stringify(result.errors)}`);
      } else {
        assert.fail(`${id}: unknown expect value ${expect}`);
      }

      checkUniversal(testCase, actual, instancePaths);
      assertExpectedPresent(testCase, actual, instancePaths);
    });
  }
});

test("every emittable diagnostic code is registered", () => {
  for (const [name, code] of Object.entries(DiagnosticCodes)) {
    assert.ok(
      registry.has(code),
      `DiagnosticCodes.${name} = '${code}' is not present in conformance/codes.toml`,
    );
  }
});
