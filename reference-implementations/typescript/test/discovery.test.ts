import assert from "node:assert/strict";
import { test } from "node:test";
import { SchemaError, schemaFromDocument, validateDocument } from "../src/index.js";
import { tempDir, writeFixture } from "./helpers.js";

test("schemaFromDocument discovers a schema via a relative [toml-schema].location", async () => {
  const dir = await tempDir();
  await writeFixture(
    dir,
    "schema.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
`,
  );
  const documentPath = await writeFixture(
    dir,
    "document.toml",
    `
name = "hello"

[toml-schema]
location = "schema.tosd"
version = "1.0.0"
`,
  );

  const { schema, document } = await schemaFromDocument(documentPath);
  assert.equal(schema.version, "1.0.0");
  assert.deepEqual(schema.warnings, []);
  const result = schema.validate(document);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("schemaFromDocument resolves a file: URI location", async () => {
  const dir = await tempDir();
  const schemaPath = await writeFixture(
    dir,
    "schema.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
`,
  );
  const documentPath = await writeFixture(
    dir,
    "document.toml",
    `
name = "hello"

[toml-schema]
location = "${new URL(`file://${schemaPath}`).href}"
version = "1.0.0"
`,
  );

  const { schema } = await schemaFromDocument(documentPath);
  assert.equal(schema.version, "1.0.0");
});

test("schemaFromDocument warns (but does not fail) on a minor-version mismatch sharing the major version", async () => {
  const dir = await tempDir();
  await writeFixture(
    dir,
    "schema.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
`,
  );
  const documentPath = await writeFixture(
    dir,
    "document.toml",
    `
name = "hello"

[toml-schema]
location = "schema.tosd"
version = "1.0.5"
`,
  );

  const { schema } = await schemaFromDocument(documentPath);
  assert.equal(schema.warnings.length, 1);
  assert.equal(schema.warnings[0]?.code, "version-mismatch");
  assert.equal(schema.warnings[0]?.schemaPath, "$.toml-schema.version");
});

test("schemaFromDocument rejects a major-version mismatch", async () => {
  const dir = await tempDir();
  await writeFixture(
    dir,
    "schema.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
`,
  );
  const documentPath = await writeFixture(
    dir,
    "document.toml",
    `
name = "hello"

[toml-schema]
location = "schema.tosd"
version = "2.0.0"
`,
  );

  await assert.rejects(() => schemaFromDocument(documentPath), /major version/);
});

test("schemaFromDocument rejects a document without [toml-schema].location", async () => {
  const dir = await tempDir();
  const documentPath = await writeFixture(dir, "document.toml", `name = "hello"\n`);
  await assert.rejects(() => schemaFromDocument(documentPath), /location/);
});

test("schemaFromDocument rejects non-scalar [toml-schema] metadata values", async () => {
  const dir = await tempDir();
  const documentPath = await writeFixture(
    dir,
    "document.toml",
    `
[toml-schema]
location = "schema.tosd"
extra = { nested = true }
`,
  );
  await assert.rejects(() => schemaFromDocument(documentPath), /scalar value/);

  const scalarLocationPath = await writeFixture(
    dir,
    "scalar-location.toml",
    `[toml-schema]\nlocation = 42\n`,
  );
  await assert.rejects(
    () => schemaFromDocument(scalarLocationPath),
    (error: unknown) =>
      error instanceof SchemaError &&
      error.code === "discovery-invalid-metadata" &&
      error.schemaPath === "$.toml-schema.location",
  );
});

test("validateDocument is a one-shot discover + validate convenience helper", async () => {
  const dir = await tempDir();
  await writeFixture(
    dir,
    "schema.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"
`,
  );
  const documentPath = await writeFixture(
    dir,
    "document.toml",
    `
name = "hello"

[toml-schema]
location = "schema.tosd"
version = "1.0.0"
`,
  );

  const result = await validateDocument(documentPath);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("validateDocument returns discovery warnings in its final result", async () => {
  const dir = await tempDir();
  await writeFixture(dir, "schema.tosd", `[toml-schema]\nversion = "1.0.0"\n\n[elements]\n`);
  const documentPath = await writeFixture(
    dir,
    "document.toml",
    `[toml-schema]\nversion = "1.0.0-rc.1"\nlocation = "schema.tosd"\n`,
  );

  const result = await validateDocument(documentPath);
  assert.equal(result.valid, true);
  assert.equal(result.warnings[0]?.code, "version-mismatch");
  assert.equal(result.warnings[0]?.schemaPath, "$.toml-schema.version");
});

test("validateDocument refuses HTTP discovery without attempting retrieval", async () => {
  const dir = await tempDir();
  const documentPath = await writeFixture(
    dir,
    "document.toml",
    `[toml-schema]\nlocation = "http://127.0.0.1:1/schema.tosd"\n`,
  );

  const result = await validateDocument(documentPath);
  assert.equal(result.errors[0]?.code, "schema-retrieval-refused");
  assert.equal(result.errors[0]?.schemaPath, "$.toml-schema.location");
});
