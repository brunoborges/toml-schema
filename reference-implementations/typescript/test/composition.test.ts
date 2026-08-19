import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSchemaFromSource } from "../src/index.js";

test("oneof validates against exactly one alternative type", () => {
  const schema = loadSchemaFromSource(
    "oneof.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.value]
oneof = ["string", "integer"]
`,
  );
  assert.equal(schema.validate({ value: "text" }).valid, true);
  assert.equal(schema.validate({ value: 1n }).valid, true);
  assert.equal(schema.validate({ value: true }).valid, false);
});

test("anyof validates against at-least-one matching alternative", () => {
  const schema = loadSchemaFromSource(
    "anyof.tosd",
    `
[toml-schema]
version = "1.0.0"

[types.small]
type = "integer"
max = 10

[types.big]
type = "integer"
min = 5

[elements.value]
anyof = ["types.small", "types.big"]
`,
  );
  assert.equal(schema.validate({ value: 7n }).valid, true); // matches both
  assert.equal(schema.validate({ value: 1n }).valid, true); // matches small only
  assert.equal(schema.validate({ value: 100n }).valid, true); // matches big only
  assert.equal(schema.validate({ value: "nope" }).valid, false);
});

test("allof composes table structure additively (closure over all contributing shapes)", () => {
  const schema = loadSchemaFromSource(
    "allof.tosd",
    `
[toml-schema]
version = "1.0.0"

[types.base]
type = "table"
[types.base.id]
type = "integer"

[types.extra]
type = "table"
[types.extra.label]
type = "string"

[elements.item]
type = "table"
allof = ["types.base", "types.extra"]
`,
  );
  const valid = schema.validate({ item: { id: 1n, label: "x" } });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));

  const missingLabel = schema.validate({ item: { id: 1n } });
  assert.equal(missingLabel.valid, false);

  const unexpectedKey = schema.validate({ item: { id: 1n, label: "x", other: true } });
  assert.equal(unexpectedKey.valid, false);
});

test("allof composes collection dynamic-entry constraints from every component", () => {
  const schema = loadSchemaFromSource(
    "allof-collection.tosd",
    `
[toml-schema]
version = "1.0.0"

[types.evenLength]
type = "collection"
itemtype = "string"
keypattern = "^[a-z]+$"

[elements.values]
type = "collection"
itemtype = "string"
minlength = 1
allof = ["types.evenLength"]
`,
  );
  assert.equal(schema.validate({ values: { ok: "x" } }).valid, true);
  assert.equal(schema.validate({ values: { BAD: "x" } }).valid, false);
  assert.equal(schema.validate({ values: {} }).valid, false);
});

test("allof accepts oneof/anyof components with an unambiguous effective kind", () => {
  const schema = loadSchemaFromSource(
    "allof-union.tosd",
    `
[toml-schema]
version = "1.0.0"

[types.a]
type = "integer"
min = 0

[types.b]
type = "integer"
max = 100

[types.union]
oneof = ["types.a"]

[elements.value]
type = "integer"
allof = ["types.union", "types.b"]
`,
  );
  assert.equal(schema.validate({ value: 5n }).valid, true);
  assert.equal(schema.validate({ value: -1n }).valid, false);
  assert.equal(schema.validate({ value: 500n }).valid, false);
});

test("allof rejects components whose effective kind conflicts", async () => {
  await assert.rejects(async () => {
    loadSchemaFromSource(
      "allof-conflict.tosd",
      `
[toml-schema]
version = "1.0.0"

[types.a]
type = "integer"

[types.b]
type = "string"

[elements.value]
type = "integer"
allof = ["types.a", "types.b"]
`,
    );
  }, /incompatible/);
});
