import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadSchema, parseToml, SchemaError } from "../src/index.js";

/**
 * Shared conformance corpus runner.
 *
 * Executes every case in the repository-root `conformance/` corpus against the
 * TypeScript reference implementation and asserts the manifest's expected
 * outcome. Outcomes (from `conformance/manifest.toml`):
 *
 * - `schema-load-error`  loading the schema MUST fail before any document is
 *   examined.
 * - `validation-failure` the schema MUST load and validating the document MUST
 *   report at least one error.
 * - `valid`              the schema MUST load and the document MUST validate
 *   with no errors (warnings are permitted).
 *
 * A load failure and a validation failure are never conflated: a
 * `validation-failure` case fails if the schema does not load, because that
 * means the implementation rejects a schema the specification considers legal.
 */

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

interface Case {
  id: string;
  expect: string;
}

const manifestSource = await readFile(path.join(CONFORMANCE, "manifest.toml"), "utf-8");
const cases = (parseToml(manifestSource).case as unknown as Case[]) ?? [];

test("conformance corpus", async (t) => {
  assert.ok(cases.length > 0, "manifest contained no cases");

  for (const testCase of cases) {
    const { id, expect } = testCase;
    await t.test(`${id} (${expect})`, async () => {
      const caseDir = path.join(CONFORMANCE, "cases", id);
      const schemaPath = path.join(caseDir, "schema.tosd");

      // Step 1: load the schema. Only a SchemaError counts as a load failure;
      // any other exception propagates and surfaces as a genuine test error.
      let schema: Awaited<ReturnType<typeof loadSchema>> | undefined;
      let loadError: SchemaError | undefined;
      try {
        schema = await loadSchema(schemaPath);
      } catch (err) {
        if (err instanceof SchemaError) {
          loadError = err;
        } else {
          throw err;
        }
      }

      if (expect === "schema-load-error") {
        assert.ok(
          loadError !== undefined,
          `${id}: expected schema-load-error but schema loaded successfully`,
        );
        return;
      }

      // For valid / validation-failure the schema MUST have loaded.
      assert.ok(
        loadError === undefined,
        `${id}: expected ${expect} but schema failed to load: ${loadError?.message}`,
      );

      const documentPath = path.join(caseDir, "document.toml");
      const result = await schema!.validateFile(documentPath);

      if (expect === "validation-failure") {
        assert.equal(
          result.valid,
          false,
          `${id}: expected validation-failure but document validated with no errors`,
        );
      } else if (expect === "valid") {
        assert.equal(
          result.valid,
          true,
          `${id}: expected valid but document reported errors: ${JSON.stringify(result.errors)}`,
        );
      } else {
        assert.fail(`${id}: unknown expect value ${expect}`);
      }
    });
  }
});
