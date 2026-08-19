import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSchemaFromSource } from "../src/index.js";

const conditionalSchema = `
[toml-schema]
version = "1.0.0"

[types.postgresql]
type = "table"
[types.postgresql.engine]
type = "string"
[types.postgresql.host]
type = "string"
[types.postgresql.port]
type = "integer"

[types.sqlite]
type = "table"
[types.sqlite.engine]
type = "string"
[types.sqlite.path]
type = "string"

[elements.database]
if = { key = "engine", equals = "postgresql" }
then = "types.postgresql"
else = "types.sqlite"
`;

test("if/then/else selects and validates the matching branch", () => {
  const schema = loadSchemaFromSource("conditional.tosd", conditionalSchema);

  const postgres = schema.validate({
    database: { engine: "postgresql", host: "db.internal", port: 5432n },
  });
  assert.equal(postgres.valid, true, JSON.stringify(postgres.errors));

  const sqlite = schema.validate({ database: { engine: "sqlite", path: "./data.db" } });
  assert.equal(sqlite.valid, true, JSON.stringify(sqlite.errors));

  const wrongBranch = schema.validate({ database: { engine: "sqlite", host: "db.internal" } });
  assert.equal(wrongBranch.valid, false);
});

test("if selector uses TOML parsed-value equality, not identity", () => {
  const schema = loadSchemaFromSource(
    "conditional-equality.tosd",
    `
[toml-schema]
version = "1.0.0"

[types.enabled]
type = "table"
[types.enabled.flag]
type = "boolean"
[types.enabled.count]
type = "integer"

[types.disabled]
type = "table"
[types.disabled.flag]
type = "boolean"

[elements.item]
if = { key = "count", equals = 3 }
then = "types.enabled"
else = "types.disabled"
`,
  );
  assert.equal(schema.validate({ item: { flag: true, count: 3n } }).valid, true);
  assert.equal(
    schema.validate({ item: { flag: true } }).valid,
    true,
    "an absent discriminator key falls through to the else branch, which is satisfied here",
  );
  assert.equal(
    schema.validate({ item: { count: 3n } }).valid,
    false,
    "count=3 selects the enabled branch, which additionally requires flag",
  );
});

test("if selector supports an `in` alternative-set form", () => {
  const schema = loadSchemaFromSource(
    "conditional-in.tosd",
    `
[toml-schema]
version = "1.0.0"

[types.known]
type = "table"
[types.known.engine]
type = "string"
[types.known.host]
type = "string"

[types.other]
type = "table"
[types.other.engine]
type = "string"

[elements.database]
if = { key = "engine", in = ["postgresql", "mysql"] }
then = "types.known"
else = "types.other"
`,
  );
  assert.equal(schema.validate({ database: { engine: "mysql", host: "x" } }).valid, true);
  assert.equal(schema.validate({ database: { engine: "sqlite" } }).valid, true);
  assert.equal(schema.validate({ database: { engine: "postgresql" } }).valid, false);
});

test("a conditional discriminator key remains a legal direct child even when not a known branch key", () => {
  const schema = loadSchemaFromSource("conditional-discriminator.tosd", conditionalSchema);
  const result = schema.validate({
    database: { engine: "postgresql", host: "db.internal", port: 5432n },
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("rejects a conditional selector that names more than one key", async () => {
  await assert.rejects(async () => {
    loadSchemaFromSource(
      "bad-conditional.tosd",
      `
[toml-schema]
version = "1.0.0"

[types.a]
type = "string"
[types.b]
type = "string"

[elements.value]
if = { key = "engine", equals = "x", extra = 1 }
then = "types.a"
else = "types.b"
`,
    );
  });
});

test("rejects incompatible conditional branch effective kinds", async () => {
  await assert.rejects(async () => {
    loadSchemaFromSource(
      "conditional-incompatible.tosd",
      `
[toml-schema]
version = "1.0.0"

[types.tableBranch]
type = "table"
[types.tableBranch.engine]
type = "string"

[types.collectionBranch]
type = "collection"
itemtype = "string"
[types.collectionBranch.engine]
type = "string"

[elements.value]
if = { key = "engine", equals = "x" }
then = "types.tableBranch"
else = "types.collectionBranch"
`,
    );
  }, /incompatible/);
});

test("rejects a conditional selector cycle routed back through a plain type reference", async () => {
  await assert.rejects(async () => {
    loadSchemaFromSource(
      "conditional-cycle.tosd",
      `
[toml-schema]
version = "1.0.0"

[types.fallback]
type = "table"
[types.fallback.engine]
type = "string"

[types.first]
if = { key = "engine", equals = "x" }
then = "types.second"
else = "types.fallback"

[types.second]
type = "types.first"

[elements.value]
type = "types.fallback"
`,
    );
  }, /cyclic/);
});
