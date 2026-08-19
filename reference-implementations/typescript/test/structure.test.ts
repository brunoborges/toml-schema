import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSchemaFromSource } from "../src/index.js";

test("arrays validate itemtype homogeneously", () => {
  const schema = loadSchemaFromSource(
    "array.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.tags]
type = "array"
itemtype = "string"
`,
  );
  assert.equal(schema.validate({ tags: ["a", "b"] }).valid, true);
  assert.equal(schema.validate({ tags: ["a", 1n] }).valid, false);
});

test("tuple arrays validate items positionally by the `items` property", () => {
  const schema = loadSchemaFromSource(
    "tuple.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.point]
type = "array"
items = ["integer", "integer", "string"]
`,
  );
  assert.equal(schema.validate({ point: [1n, 2n, "label"] }).valid, true);
  assert.equal(schema.validate({ point: [1n, "x", "label"] }).valid, false);
  assert.equal(schema.validate({ point: [1n, 2n] }).valid, false, "wrong arity must fail");
  assert.equal(schema.validate({ point: [1n, 2n, "label", "extra"] }).valid, false);
});

test("collections validate dynamic-key tables against itemtype and keypattern", () => {
  const schema = loadSchemaFromSource(
    "collection.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.servers]
type = "collection"
itemtype = "string"
keypattern = "^[a-z][a-z0-9_]*$"
minlength = 1
`,
  );
  assert.equal(schema.validate({ servers: { alpha: "1.2.3.4" } }).valid, true);
  assert.equal(schema.validate({ servers: {} }).valid, false, "minlength=1 requires at least one entry");
  assert.equal(schema.validate({ servers: { Bad: "x" } }).valid, false, "keypattern rejects uppercase");
  assert.equal(schema.validate({ servers: { ok: 1n } }).valid, false, "itemtype rejects non-strings");
});

test("collections with fixed children plus a dynamic itemtype validate both simultaneously", () => {
  const schema = loadSchemaFromSource(
    "mixed-collection.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.libraries]
type = "collection"
itemtype = "types.library"

[types.library]
type = "table"
[types.library.name]
type = "string"
[types.library.version]
type = "string"
`,
  );
  const result = schema.validate({
    libraries: { lib1: { name: "gcc", version: "10.2" }, lib2: { name: "make", version: "4.0" } },
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("dependentrequired: presence of a trigger key requires its dependency keys", () => {
  const schema = loadSchemaFromSource(
    "dependent-required.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.settings]
type = "table"
dependentrequired = { branch = ["git"], git = ["url"] }
[elements.settings.git]
type = "string"
optional = true
[elements.settings.url]
type = "string"
optional = true
[elements.settings.branch]
type = "string"
optional = true
`,
  );
  assert.equal(
    schema.validate({ settings: { branch: "main", git: "repo", url: "origin" } }).valid,
    true,
  );
  assert.equal(
    schema.validate({ settings: { branch: "main" } }).valid,
    false,
    "branch requires git (direct dependency)",
  );
  assert.equal(
    schema.validate({ settings: { branch: "main", git: "repo" } }).valid,
    false,
    "dependentrequired does not chain transitively: git's own dependency (url) is still enforced directly",
  );
});

test("mutuallyexclusive: at most one member of a group may be present", () => {
  const schema = loadSchemaFromSource(
    "mutually-exclusive.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.source]
type = "table"
mutuallyexclusive = [["git", "path"]]
[elements.source.git]
type = "string"
optional = true
[elements.source.path]
type = "string"
optional = true
`,
  );
  assert.equal(schema.validate({ source: { git: "repo" } }).valid, true);
  assert.equal(schema.validate({ source: {} }).valid, true);
  assert.equal(schema.validate({ source: { git: "repo", path: "." } }).valid, false);
});

test("exactlyone: exactly one member of a group must be present", () => {
  const schema = loadSchemaFromSource(
    "exactly-one.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.body]
type = "table"
exactlyone = [["file", "text"]]
[elements.body.file]
type = "string"
optional = true
[elements.body.text]
type = "string"
optional = true
`,
  );
  assert.equal(schema.validate({ body: { file: "README.md" } }).valid, true);
  assert.equal(schema.validate({ body: {} }).valid, false);
  assert.equal(schema.validate({ body: { file: "a", text: "b" } }).valid, false);
});

test("uniqueitems rejects duplicate array entries using TOML parsed-value equality", () => {
  const schema = loadSchemaFromSource(
    "unique-items.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.tags]
type = "array"
itemtype = "integer"
uniqueitems = true
`,
  );
  assert.equal(schema.validate({ tags: [1n, 2n, 3n] }).valid, true);
  assert.equal(schema.validate({ tags: [1n, 2n, 1n] }).valid, false);
});

test("uniqueitems compares tables recursively using structural TOML equality", () => {
  const schema = loadSchemaFromSource(
    "unique-items-tables.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.points]
type = "array"
itemtype = "table"
uniqueitems = true
`,
  );
  assert.equal(
    schema.validate({ points: [{ x: 1n }, { x: 2n }] }).valid,
    true,
  );
  assert.equal(
    schema.validate({ points: [{ x: 1n }, { x: 1n }] }).valid,
    false,
    "structurally identical tables are duplicates",
  );
});

test("default values are validated at schema-load time but never materialize into documents", () => {
  const schema = loadSchemaFromSource(
    "defaults.tosd",
    `
[toml-schema]
version = "1.0.0"

[types.base]
type = "integer"
min = 1
default = 2

[elements.inherited]
type = "types.base"
optional = true

[elements.local]
type = "types.base"
default = 3
optional = true
`,
  );
  const inherited = schema.element("inherited");
  assert.ok(inherited);
  assert.equal(inherited?.hasDefault(), true);
  assert.equal(inherited?.default(), 2n);

  const local = schema.element("local");
  assert.equal(local?.hasDefault(), true);
  assert.equal(local?.default(), 3n);

  const document: Record<string, unknown> = {};
  const result = schema.validate(document as never);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(Object.keys(document).length, 0, "validation must not mutate the document");
});

test("rejects a schema-declared default that fails its own constraints", async () => {
  await assert.rejects(async () => {
    loadSchemaFromSource(
      "invalid-default.tosd",
      `
[toml-schema]
version = "1.0.0"

[elements.count]
type = "integer"
min = 2
default = 1
`,
    );
  }, /default is invalid/);
});

test("rejects conflicting inherited defaults composed via allof", async () => {
  await assert.rejects(async () => {
    loadSchemaFromSource(
      "conflicting-default.tosd",
      `
[toml-schema]
version = "1.0.0"

[types.a]
type = "integer"
default = 1

[types.b]
type = "integer"
default = 2

[elements.value]
type = "integer"
allof = ["types.a", "types.b"]
`,
    );
  }, /conflicting inherited defaults/);
});

test("deprecated produces a structured, branch-local warning without affecting validity", () => {
  const schema = loadSchemaFromSource(
    "deprecated.tosd",
    `
[toml-schema]
version = "1.0.0"

[types.legacy]
type = "string"
pattern = "^old$"
deprecated = true

[types.current]
type = "integer"

[elements.value]
oneof = ["types.legacy", "types.current"]
`,
  );
  const result = schema.validate({ value: "old" });
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 1);
  const warning = result.warnings[0];
  assert.equal(warning?.severity, "warning");
  assert.equal(warning?.code, "deprecated");
  assert.equal(warning?.path, "$.value");

  const nonDeprecatedBranch = schema.validate({ value: 1n });
  assert.equal(nonDeprecatedBranch.valid, true);
  assert.equal(nonDeprecatedBranch.warnings.length, 0);
});
