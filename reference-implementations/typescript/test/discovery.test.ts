import assert from "node:assert/strict";
import { test } from "node:test";
import { schemaFromDocument, validateDocument } from "../src/index.js";
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
  assert.match(schema.warnings[0] ?? "", /1\.0\.5/);
  assert.match(schema.warnings[0] ?? "", /1\.0\.0/);
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
