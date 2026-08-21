import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSchemaFromSource } from "../src/index.js";

test("loads a pure allof mixin and validates its determinate children", () => {
  const schema = loadSchemaFromSource("pure-allof.tosd", `
[toml-schema]
version = "1.0.0"
[types.named]
type = "table"
[types.named.name]
type = "string"
[types.packageBase]
type = "table"
[types.packageBase.version]
type = "string"
[types.package]
allof = ["types.packageBase", "types.named"]
dependentrequired = { name = ["version"] }
[types.positive]
type = "integer"
min = 1
[types.small]
type = "integer"
max = 10
[types.count]
allof = ["types.positive", "types.small"]
[elements.pkg]
type = "types.package"
[elements.count]
type = "types.count"
`);
  assert.equal(schema.validate({ pkg: { name: "x", version: "1" }, count: 5n }).valid, true);
  assert.equal(schema.validate({ pkg: { name: "x", version: "1" }, count: 0n }).valid, false);
});

test("rejects a mixed-kind pure allof at load time", () => {
  assert.throws(() => loadSchemaFromSource("mixed-allof.tosd", `
[toml-schema]
version = "1.0.0"
[types.aTable]
type = "table"
[types.aTable.x]
type = "string"
[types.anArray]
type = "array"
itemtype = "string"
[types.bad]
allof = ["types.aTable", "types.anArray"]
[elements.value]
type = "types.bad"
`));
});

test("validates inline array patterns", () => {
  const schema = loadSchemaFromSource("array-pattern.tosd", `
[toml-schema]
version = "1.0.0"
[elements.tags]
type = "array"
itemtype = "string"
pattern = '^[a-z]+$'
`);
  assert.equal(schema.validate({ tags: ["alpha", "beta"] }).valid, true);
  assert.equal(schema.validate({ tags: ["alpha", "Beta"] }).valid, false);
});

test("validates inline collection member constraints", () => {
  const schema = loadSchemaFromSource("collection-constraints.tosd", `
[toml-schema]
version = "1.0.0"
[elements.ports]
type = "collection"
itemtype = "integer"
min = 1
max = 65535
[elements.roles]
type = "collection"
itemtype = "string"
allowedvalues = ["admin", "reader"]
[elements.tags]
type = "collection"
itemtype = "string"
pattern = '^[a-z]+@example\\.com$'
[elements.emails]
type = "collection"
itemtype = "string"
format = "email"
`);
  assert.equal(schema.validate({
    ports: { http: 80n },
    roles: { owner: "admin" },
    tags: { release: "stable@example.com" },
    emails: { owner: "admin@example.com" },
  }).valid, true);
  for (const invalid of [
    { ports: { http: 0n }, roles: { owner: "admin" }, tags: { release: "stable@example.com" }, emails: { owner: "admin@example.com" } },
    { ports: { http: 70000n }, roles: { owner: "admin" }, tags: { release: "stable@example.com" }, emails: { owner: "admin@example.com" } },
    { ports: { http: 80n }, roles: { owner: "root" }, tags: { release: "stable@example.com" }, emails: { owner: "admin@example.com" } },
    { ports: { http: 80n }, roles: { owner: "admin" }, tags: { release: "Stable" }, emails: { owner: "admin@example.com" } },
    { ports: { http: 80n }, roles: { owner: "admin" }, tags: { release: "stable@example.com" }, emails: { owner: "not-an-email" } },
  ]) assert.equal(schema.validate(invalid).valid, false);
});

test("rejects duplicate inline and itemtype constraints at load time", () => {
  assert.throws(() => loadSchemaFromSource("duplicate-constraint.tosd", `
[toml-schema]
version = "1.0.0"
[types.item]
type = "integer"
min = 0
[elements.values]
type = "array"
itemtype = "types.item"
min = -10
`));
});

test("allows an inline constraint matching one acquired by itemtype allof", () => {
  const schema = loadSchemaFromSource("inherited-constraint.tosd", `
[toml-schema]
version = "1.0.0"
[types.mixin]
type = "string"
allowedvalues = ["a", "b"]
[types.item]
type = "string"
allof = ["types.mixin"]
[elements.values]
type = "array"
itemtype = "types.item"
allowedvalues = ["b", "c"]
`);
  assert.equal(schema.validate({ values: ["b"] }).valid, true);
  assert.equal(schema.validate({ values: ["a"] }).valid, false);
  assert.equal(schema.validate({ values: ["c"] }).valid, false);
});
