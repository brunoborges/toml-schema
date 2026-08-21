import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSchemaFromSource } from "../src/index.js";

const schema = (definition: string) =>
  loadSchemaFromSource(
    "phase2.tosd",
    `[toml-schema]\nversion = "1.0.0"\n${definition}\n`,
  );

test("prefixed built-ins are normalized before selector classification", () => {
  assert.doesNotThrow(() =>
    schema(`[elements.port]
type = "types.integer"
min = 1
max = 65535`),
  );
  assert.throws(() => schema('[elements.value]\noneof = ["types.any"]'));
});

test("invalid and non-portable patterns fail during schema loading", () => {
  const cases = [
    ['type = "string"\npattern = "["', /invalid-pattern/],
    [String.raw`type = "string"
pattern = "\\d+"`, /unsupported-pattern/],
    [
      'type = "collection"\nitemtype = "string"\nkeypattern = "(?=x)"',
      /unsupported-pattern/,
    ],
  ] as const;
  for (const [definition, expected] of cases) {
    assert.throws(() => schema(`[elements.value]\n${definition}`), expected);
  }
});

test("portable character escapes and escaped metacharacters load", () => {
  assert.doesNotThrow(() =>
    schema(String.raw`[elements.whitespace]
type = "string"
pattern = '[ \t]'
    [elements.controls]
    type = "string"
    pattern = '\t\n\r\f\v\a'
    [elements.dot]
type = "string"
pattern = '\.'`),
  );
});

test("closed conditional branches must declare their discriminator", () => {
  for (const missing of ["then", "else"] as const) {
    const thenChild = missing === "then" ? "value" : "engine";
    const elseChild = missing === "else" ? "value" : "engine";
    assert.throws(() =>
      schema(`[types.selected]
type = "table"
[types.selected.${thenChild}]
type = "string"
[types.fallback]
type = "table"
[types.fallback.${elseChild}]
type = "string"
[elements.item]
if = { key = "engine", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"`),
    );
  }
});

test("a non-table conditional default fails during schema loading", () => {
  assert.throws(() =>
    schema(`[types.selected]
type = "table"
[types.fallback]
type = "table"
[elements.item]
if = { key = "engine", equals = "sqlite" }
then = "types.selected"
else = "types.fallback"
default = "sqlite"`),
  );
});
