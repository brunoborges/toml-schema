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

test("selective children escape and literal children child", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "toml-schema-children-"));
  const schemaPath = join(dir, "children-escape.tosd");
  const documentPath = join(dir, "children-escape.toml");
  await writeFile(
    schemaPath,
    `[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

[elements.plugin.children.type]
type = "string"

[elements.plugin.children.children]
type = "boolean"
`,
  );
  await writeFile(
    documentPath,
    `[plugin]
type = "npm"
children = true
`,
  );
  const schema = await loadSchema(schemaPath);
  const result = await schema.validateFile(documentPath);
  assert.equal(result.valid, true, JSON.stringify(result.errors));

  const literalSchemaPath = join(dir, "literal-children.tosd");
  const literalDocumentPath = join(dir, "literal-children.toml");
  await writeFile(
    literalSchemaPath,
    `[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

[elements.plugin.children]
type = "string"
`,
  );
  await writeFile(
    literalDocumentPath,
    `[plugin]
children = "ordinary child"
`,
  );
  const literalSchema = await loadSchema(literalSchemaPath);
  const literalResult = await literalSchema.validateFile(literalDocumentPath);
  assert.equal(literalResult.valid, true, JSON.stringify(literalResult.errors));
});

test("rejects invalid children escape namespaces", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "toml-schema-children-invalid-"));
  for (const [name, body] of [
    ["empty", "[elements.plugin.children]"],
    ["non-conflicting", "[elements.plugin.children.name]\ntype = \"string\""],
  ] as const) {
    const schemaPath = join(dir, `${name}.tosd`);
    await writeFile(
      schemaPath,
      `[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"

${body}
`,
    );
    await assert.rejects(() => loadSchema(schemaPath));
  }
});
