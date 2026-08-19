import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSchemaFromSource } from "../src/index.js";

test("ValidationResult exposes structured errors, warnings, diagnostics, and a valid getter/method", () => {
  const schema = loadSchemaFromSource(
    "diagnostics.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"

[elements.age]
type = "integer"
min = 0
`,
  );

  const result = schema.validate({ name: 42n, age: -1n } as never);
  assert.equal(result.valid, false);
  assert.equal(result.isValid(), false);
  assert.ok(result.errors.length >= 2);
  for (const error of result.errors) {
    assert.equal(error.severity, "error");
    assert.equal(typeof error.path, "string");
    assert.equal(typeof error.message, "string");
    assert.equal(typeof error.code, "string");
  }
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), result.errors);
  assert.deepEqual(
    result.diagnostics.filter((d) => d.severity === "warning"),
    result.warnings,
  );
});

test("valid documents report an empty errors/warnings/diagnostics set", () => {
  const schema = loadSchemaFromSource(
    "diagnostics-valid.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
`,
  );
  const result = schema.validate({ name: "ok" });
  assert.equal(result.valid, true);
  assert.equal(result.isValid(), true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.diagnostics, []);
});

test("unexpected top-level keys are reported against the closed root", () => {
  const schema = loadSchemaFromSource(
    "closed-root.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
`,
  );
  const result = schema.validate({ name: "ok", extra: "nope" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "$.extra"));
});
