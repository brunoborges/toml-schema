import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSchemaFromSource } from "../src/index.js";

test("supports quoted, dotted, empty, and schema-keyword-named element keys", () => {
  const schema = loadSchemaFromSource(
    "quoted-keys.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.""]
type = "string"

[elements.children]
type = "string"

[elements.site."google.com"]
type = "boolean"

[elements.plugin.type]
type = "string"
`,
  );
  const result = schema.validate({
    "": "blank",
    children: "literal",
    site: { "google.com": true },
    plugin: { type: "npm" },
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("disambiguates an inline-table `default` annotation from a `[..default]` child table", () => {
  const schema = loadSchemaFromSource(
    "default-disambiguation.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements]
inline = { type = "table", optional = true, default = { keep = true } }

[elements.range]
type = "table"
optional = true
default = { min = 1, max = 10 }

[elements.range.min]
type = "integer"
[elements.range.max]
type = "integer"

[elements.options]
type = "table"

[elements.options.default]

[elements.options.default.min]
type = "integer"

[elements.entry]
type = "table"

[elements.entry.dependentrequired]
type = "string"
optional = true
`,
  );

  const inline = schema.element("inline");
  assert.ok(inline);
  assert.equal(inline?.hasDefault(), true);
  assert.deepEqual(inline?.default(), { keep: true });
  assert.equal(inline?.child("default"), undefined, "a nested inline default must not become a child");

  const range = schema.element("range");
  assert.equal(range?.hasDefault(), true);
  assert.deepEqual(range?.default(), { min: 1n, max: 10n });
  assert.equal(range?.child("default"), undefined);
  assert.ok(range?.child("min"));

  const options = schema.element("options");
  assert.equal(options?.hasDefault(), false, "a [..default] table header must not become an annotation");
  const defaultChild = options?.child("default");
  assert.ok(defaultChild, "expected a child definition literally named default");
  assert.ok(defaultChild?.child("min"));

  const entry = schema.element("entry");
  assert.ok(entry?.child("dependentrequired"), "expected a child definition literally named dependentrequired");

  const valid = schema.validate({
    options: { default: { min: 1n } },
    entry: { dependentrequired: "x" },
  });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));

  const missing = schema.validate({ options: {}, entry: {} });
  assert.equal(missing.valid, false);
  assert.equal(missing.errors.length, 1);
  assert.equal(missing.errors[0]?.path, "$.options.default");
});

test("a default whose members happen to be schema-keyword-named strings is still treated as an annotation", () => {
  const schema = loadSchemaFromSource(
    "keyword-shaped-default.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.plugin]
type = "table"
optional = true
default = { type = "linter", oneof = "unused", anyof = "unused" }
`,
  );
  const plugin = schema.element("plugin");
  assert.equal(plugin?.hasDefault(), true);
  assert.deepEqual(plugin?.default(), { type: "linter", oneof: "unused", anyof: "unused" });
});

test("Object prototype names remain ordinary closed-schema keys", () => {
  const schema = loadSchemaFromSource(
    "prototype-keys.tosd",
    `
[toml-schema]
version = "1.0.0"

[elements.name]
type = "string"

[elements.server]
type = "table"
[elements.server.host]
type = "string"

[elements.environment]
type = "collection"
itemtype = "string"
keypattern = "^[a-z]+$"
`,
  );

  const result = schema.validate({
    name: "example",
    toString: 1n,
    server: { host: "localhost", constructor: 2n },
    environment: { valueOf: 3n },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === "$.toString"));
  assert.ok(result.errors.some((error) => error.path === "$.server.constructor"));
  assert.ok(result.errors.some((error) => error.path === "$.environment.valueOf"));
});

test("Object prototype names do not resolve as implicit named types", () => {
  assert.throws(
    () =>
      loadSchemaFromSource(
        "prototype-reference.tosd",
        `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "toString"
`,
      ),
    /unknown type reference/,
  );
});
