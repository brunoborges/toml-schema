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

test("allof uses the selected union alternative's effective closure", () => {
  const schema = loadSchemaFromSource(
    "allof-table-union.tosd",
    `
[toml-schema]
version = "1.0.0"
[types.base]
type = "table"
[types.base.id]
type = "integer"
[types.named]
type = "table"
[types.named.name]
type = "string"
[types.labelled]
type = "table"
[types.labelled.label]
type = "string"
[types.identity]
oneof = ["types.named", "types.labelled"]
[elements.item]
type = "table"
allof = ["types.base", "types.identity"]
[elements.item.enabled]
type = "boolean"
optional = true
`,
  );
  for (const item of [
    { id: 1n, name: "a" },
    { id: 1n, label: "a" },
    { id: 1n, name: "a", enabled: true },
  ]) {
    const result = schema.validate({ item });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  }
  for (const item of [{ id: 1n, name: "a", label: "a" }, { id: 1n }]) {
    const result = schema.validate({ item });
    assert.equal(result.valid, false);
    assert(result.errors.some((error) => error.path === "$.item" && error.message.includes("found 0")));
  }
  const unexpected = schema.validate({ item: { id: 1n, name: "a", bogus: true } });
  assert(unexpected.errors.some((error) => error.path === "$.item.bogus"));
  const missing = schema.validate({ item: { name: "a" } });
  assert(missing.errors.some((error) => error.path === "$.item.id"));
});

test("an open union alternative cannot reopen a composed closed table", () => {
  const schema = loadSchemaFromSource(
    "allof-open-union.tosd",
    `
[toml-schema]
version = "1.0.0"
[types.base]
type = "table"
[types.base.name]
type = "string"
[types.open]
type = "table"
[types.closed]
type = "table"
[types.closed.known]
type = "string"
[types.identity]
oneof = ["types.open", "types.closed"]
[elements.item]
type = "table"
allof = ["types.base", "types.identity"]
`,
  );
  assert.equal(schema.validate({ item: { name: "a", known: "x" } }).valid, true);
  const invalid = schema.validate({ item: { name: "a", arbitrary: true } });
  assert(invalid.errors.some((error) => error.path === "$.item" && error.message.includes("found 0")));
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

test("sibling rules use only determinate effective fixed children", () => {
  assert.throws(
    () =>
      loadSchemaFromSource(
        "union-operands.tosd",
        `
[toml-schema]
version = "1.0.0"
[types.left]
type = "table"
[types.left.first]
type = "string"
optional = true
[types.right]
type = "table"
[types.right.second]
type = "string"
optional = true
[types.choice]
oneof = ["types.left", "types.right"]
[elements.value]
type = "table"
allof = ["types.choice"]
exactlyone = [["first", "second"]]
`,
      ),
    /unknown fixed child/,
  );

  loadSchemaFromSource(
    "type-selected-operands.tosd",
    `
[toml-schema]
version = "1.0.0"
[types.base]
type = "table"
[types.base.first]
type = "string"
optional = true
[types.base.second]
type = "string"
optional = true
[types.indirect]
type = "types.base"
[elements.value]
type = "table"
allof = ["types.indirect"]
exactlyone = [["first", "second"]]
`,
  );
});
