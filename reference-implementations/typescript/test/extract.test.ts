import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractSchemaFile, generateSchema, loadDocument, loadSchemaFromSource } from "../src/index.js";
import { tempDir, writeFixture } from "./helpers.js";

test("generateSchema infers types, homogeneous array itemtype, and sorted keys", async () => {
  const document = {
    zebra: "z",
    alpha: 1n,
    ratio: 1.5,
    flag: true,
    numbers: [1n, 2n, 3n],
    mixed: [1n, "two"],
    nested: { inner: "value" },
  };
  const draft = generateSchema(document);
  assert.match(draft, /\[toml-schema\]/);
  assert.match(draft, /version = "1\.0\.0"/);
  assert.match(draft, /\[elements\]/);
  assert.match(draft, /\[elements\.alpha\]\ntype = "integer"/);
  assert.match(draft, /\[elements\.ratio\]\ntype = "float"/);
  assert.match(draft, /\[elements\.flag\]\ntype = "boolean"/);
  assert.match(draft, /\[elements\.zebra\]\ntype = "string"/);
  assert.match(draft, /\[elements\.numbers\]\ntype = "array"\nitemtype = "integer"/);
  assert.match(draft, /\[elements\.mixed\]\ntype = "array"\nitemtype = "any"/);
  assert.match(draft, /\[elements\.nested\]\ntype = "table"/);
  assert.match(draft, /\[elements\.nested\.inner\]\ntype = "string"/);

  // alpha (a) must sort before numbers (n) before zebra (z)
  const alphaIndex = draft.indexOf("[elements.alpha]");
  const numbersIndex = draft.indexOf("[elements.numbers]");
  const zebraIndex = draft.indexOf("[elements.zebra]");
  assert.ok(alphaIndex < numbersIndex);
  assert.ok(numbersIndex < zebraIndex);
});

test("generateSchema skips the root [toml-schema] table", () => {
  const draft = generateSchema({ "toml-schema": { location: "x.tosd" }, name: "hi" });
  assert.doesNotMatch(draft, /elements\."toml-schema"/);
  assert.match(draft, /\[elements\.name\]/);
});

test("generateSchema quotes keys that are not valid bare TOML keys", () => {
  const draft = generateSchema({ "has space": "x", 'has"quote': "y", "": "z" });
  assert.match(draft, /\[elements\."has space"\]/);
  assert.match(draft, /\[elements\."has\\"quote"\]/);
  assert.match(draft, /\[elements\.""\]/);
});

test("the generated draft schema itself loads and successfully validates the source document", async () => {
  const document = { title: "Example", count: 3n, tags: ["a", "b"] };
  const draft = generateSchema(document);
  const schema = loadSchemaFromSource("draft.tosd", draft);
  const result = schema.validate(document);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("generated schemas preserve every TOML temporal kind", async () => {
  const document = await loadDocument(
    await writeFixture(
      await tempDir(),
      "temporals.toml",
      `
offset = 1979-05-27T07:32:00-08:00
local_datetime = 1979-05-27T07:32:00
local_date = 1979-05-27
local_time = 07:32:00
`,
    ),
  );
  const draft = generateSchema(document);
  assert.match(draft, /\[elements\.offset\]\ntype = "offset-date-time"/);
  assert.match(draft, /\[elements\.local_datetime\]\ntype = "local-date-time"/);
  assert.match(draft, /\[elements\.local_date\]\ntype = "local-date"/);
  assert.match(draft, /\[elements\.local_time\]\ntype = "local-time"/);
  assert.equal(loadSchemaFromSource("temporals.tosd", draft).validate(document).valid, true);
});

test("extractSchemaFile reads a document from disk and writes a draft schema file", async () => {
  const dir = await tempDir();
  const documentPath = await writeFixture(
    dir,
    "doc.toml",
    `
title = "hi"
[owner]
name = "Ada"
`,
  );
  const schemaPath = `${dir}/generated.tosd`;
  await extractSchemaFile(documentPath, schemaPath);
  const written = await readFile(schemaPath, "utf-8");
  assert.match(written, /\[elements\.title\]/);
  assert.match(written, /\[elements\.owner\]/);
  assert.match(written, /\[elements\.owner\.name\]/);

  const schema = loadSchemaFromSource(schemaPath, written);
  const document = await loadDocument(documentPath);
  const result = schema.validate(document);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
