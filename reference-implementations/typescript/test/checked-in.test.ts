import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDocument, loadSchema } from "../src/index.js";
import { examplePath, repoPath } from "./helpers.js";

test("config.toml validates against config.tosd (checked-in example)", async () => {
  const schema = await loadSchema(repoPath("config.tosd"));
  const result = await schema.validateFile(repoPath("config.toml"));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.isValid(), true);
});

test("config.tosd validates against the toml-schema.tosd self-schema", async () => {
  const selfSchema = await loadSchema(repoPath("toml-schema.tosd"));
  const result = await selfSchema.validateFile(repoPath("config.tosd"));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("toml-schema.tosd validates against itself", async () => {
  const selfSchema = await loadSchema(repoPath("toml-schema.tosd"));
  const result = await selfSchema.validateFile(repoPath("toml-schema.tosd"));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("all checked-in example schemas load without error", async () => {
  const names = [
    "cargo.tosd",
    "database-conditional.tosd",
    "gitlab-runner.tosd",
    "hugo.tosd",
    "netlify.tosd",
    "pyproject.tosd",
    "wrangler.tosd",
  ];
  for (const name of names) {
    await assert.doesNotReject(
      async () => loadSchema(examplePath(name)),
      `expected ${name} to load without error`,
    );
  }
});

test("validates the Rust reference implementation's own Cargo.toml against cargo.tosd", async () => {
  const schema = await loadSchema(examplePath("cargo.tosd"));
  const result = await schema.validateFile(repoPath("reference-implementations", "rust", "Cargo.toml"));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("validates the two database-conditional.tosd sample documents via discovery", async () => {
  const { schemaFromDocument } = await import("../src/index.js");
  for (const name of ["database-postgresql.toml", "database-sqlite.toml"]) {
    const { schema, document } = await schemaFromDocument(examplePath(name));
    const result = schema.validate(document);
    assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
  }
});

test("loadDocument returns a plain parsed table usable with Schema.validate", async () => {
  const schema = await loadSchema(repoPath("config.tosd"));
  const document = await loadDocument(repoPath("config.toml"));
  const result = schema.validate(document);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
