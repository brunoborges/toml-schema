import assert from "node:assert/strict";
import { test } from "node:test";
import { TomlDate } from "smol-toml";
import { loadSchemaFromSource } from "../src/index.js";

const valueSemanticsSchema = `
[toml-schema]
version = "1.0.0"

[elements.precise]
type = "integer"
allowedvalues = [ 9007199254740992 ]

[elements.mixed]
type = "integer"
max = 9007199254740992.0

[elements.nanValue]
type = "float"
allowedvalues = [ nan ]

[elements.nanRange]
type = "float"
min = 0.0

[elements.zero]
type = "float"
allowedvalues = [ -0.0 ]

[elements.instant]
type = "offset-date-time"
min = 2024-01-01T00:00:00Z
max = 2024-01-01T00:00:00Z

[elements.instantMember]
type = "offset-date-time"
allowedvalues = [ 2024-01-01T00:00:00Z ]

[elements.localMember]
type = "local-time"
allowedvalues = [ 12:00:00.1 ]

[elements.localDateTime]
type = "local-date-time"
max = 2024-01-01T00:00:00.100

[elements.localDate]
type = "local-date"
max = 2024-01-01

[elements.localTime]
type = "local-time"
max = 12:00:00.100
`;

test("preserves exact bigint-vs-float numeric precision beyond 2^53", () => {
  const schema = loadSchemaFromSource("value-semantics.tosd", valueSemanticsSchema);

  const valid = schema.validate({
    precise: 9007199254740992n,
    mixed: 9007199254740992n,
    nanValue: NaN,
    nanRange: 0.0,
    zero: -0.0,
    instant: new TomlDate("2023-12-31T19:00:00-05:00"),
    instantMember: new TomlDate("2024-01-01T00:00:00+00:00"),
    localMember: new TomlDate("12:00:00.100"),
    localDateTime: new TomlDate("2024-01-01T00:00:00.100"),
    localDate: new TomlDate("2024-01-01"),
    localTime: new TomlDate("12:00:00.100"),
  });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));
});

test("rejects out-of-range/imprecise values across every temporal and numeric kind", () => {
  const schema = loadSchemaFromSource("value-semantics.tosd", valueSemanticsSchema);

  const invalid = schema.validate({
    precise: 9007199254740993n,
    mixed: 9007199254740993n,
    nanValue: 0.0,
    nanRange: NaN,
    zero: 1.0,
    instant: new TomlDate("2024-01-01T00:00:00.001Z"),
    instantMember: new TomlDate("2023-12-31T19:00:00-05:00"),
    localMember: new TomlDate("12:00:00.101"),
    localDateTime: new TomlDate("2024-01-01T00:00:00.101"),
    localDate: new TomlDate("2024-01-02"),
    localTime: new TomlDate("12:00:00.101"),
  });
  assert.equal(invalid.valid, false);
  const paths = new Set(invalid.errors.map((e) => e.path));
  for (const expected of [
    "$.precise",
    "$.mixed",
    "$.nanValue",
    "$.nanRange",
    "$.zero",
    "$.instant",
    "$.instantMember",
    "$.localMember",
    "$.localDateTime",
    "$.localDate",
    "$.localTime",
  ]) {
    assert.ok(paths.has(expected), `expected an error at ${expected}, got ${JSON.stringify([...paths])}`);
  }
});

test("rejects a schema whose allowedvalues/max comparison would require lossy float rounding", async () => {
  await assert.rejects(async () => {
    loadSchemaFromSource(
      "value-semantics-malformed.tosd",
      `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
allowedvalues = [ 9007199254740993 ]
max = 9007199254740992.0
`,
    );
  });

  test("validates range boundaries during schema loading", () => {
    const load = (name: string, definition: string) =>
      loadSchemaFromSource(
        `${name}.tosd`,
        `[toml-schema]\nversion = "1.0.0"\n[elements.value]\n${definition}\n`,
      );

    assert.doesNotThrow(() => load("valid", 'type = "float"\nmin = -inf\nmax = inf'));
    assert.doesNotThrow(() => load("ordered", 'type = "integer"\nmin = 1\nmax = 10'));
    const reversed = new Map([
      ["numeric", 'type = "integer"\nmin = 10\nmax = 1'],
      [
        "mixed-precision",
        'type = "integer"\nmin = 9007199254740993\nmax = 9007199254740992.0',
      ],
      [
        "offset",
        'type = "offset-date-time"\nmin = 2024-01-02T00:00:00Z\nmax = 2024-01-01T23:00:00Z',
      ],
      [
        "local-date-time",
        'type = "local-date-time"\nmin = 2024-01-02T00:00:00\nmax = 2024-01-01T23:00:00',
      ],
      ["local-date", 'type = "local-date"\nmin = 2024-01-02\nmax = 2024-01-01'],
      ["local-time", 'type = "local-time"\nmin = 12:00:01\nmax = 12:00:00'],
      ["array", 'type = "array"\nitemtype = "integer"\nmin = 10\nmax = 1'],
    ]);
    for (const [name, definition] of reversed) {
      assert.throws(() => load(name, definition), /min must not be greater than max/);
    }
    for (const [name, boundary] of [
      ["infinite-min", "min = -inf"],
      ["infinite-max", "max = inf"],
    ]) {
      assert.throws(
        () => load(name as string, `type = "integer"\n${boundary}`),
        /when comparable kind is integer/,
      );
    }
  });
});
