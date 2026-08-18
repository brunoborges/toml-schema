import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseDocument, serializeDocument, validateModel } from "./model.mjs";
import { parseToml } from "./toml.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const definition = (name, props, children = []) => ({ name, props, children });
const model = (elements = [], types = [], version = "1.0.0") => ({
    version,
    meta: null,
    types,
    elements,
});
const errors = (value) => validateModel(value).filter((issue) => issue.level === "error");

test("all checked-in schemas parse and semantically round-trip", () => {
    const files = execFileSync("git", ["ls-files", "*.tosd"], { cwd: REPO, encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean);

    for (const file of files) {
        const parsed = parseDocument(readFileSync(resolve(REPO, file), "utf8"));
        assert.deepEqual(parseDocument(serializeDocument(parsed)), parsed, file);
        assert.deepEqual(errors(parsed), [], file);
    }
});

test("property-name child definitions coexist with schema properties", () => {
    const source = `
[toml-schema]
version = "1.0.0"

[types.module]
type = "table"

[types.module.type]
type = "string"

[elements]
`;
    const parsed = parseDocument(source);
    assert.equal(parsed.types[0].props.type, "table");
    assert.equal(parsed.types[0].children[0].name, "type");
    assert.equal(parsed.types[0].children[0].props.type, "string");
    assert.deepEqual(parseDocument(serializeDocument(parsed)), parsed);
});

test("large TOML integers round-trip without precision loss", () => {
    const source = `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
allowedvalues = [ 9223372036854775807, -9223372036854775808 ]
`;
    const parsed = parseDocument(source);
    const serialized = serializeDocument(parsed);
    assert.match(serialized, /9223372036854775807/);
    assert.match(serialized, /-9223372036854775808/);
    assert.deepEqual(parseDocument(serialized), parsed);
});

test("floating-point spellings and non-finite metadata round-trip", () => {
    const source = `
[toml-schema]
version = "1.0.0"

[toml-schema.meta]
positive = inf
negative = -inf
missing = nan

[elements.value]
type = "float"
allowedvalues = [ 1.0, 1e0, inf, nan ]
`;
    const parsed = parseDocument(source);
    const serialized = serializeDocument(parsed);
    assert.match(serialized, /allowedvalues = \[ 1\.0, 1e0, inf, nan \]/);
    assert.deepEqual(parseDocument(serialized), parsed);
    assert.deepEqual(errors(parsed), []);
});

test("TOML integers outside the signed 64-bit range are rejected", () => {
    for (const value of ["9223372036854775808", "-9223372036854775809"]) {
        const source = `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "integer"
allowedvalues = [ ${value} ]
`;
        assert.throws(() => parseDocument(source), /signed 64-bit/);
    }
});

test("schema property TOML types are not coerced", () => {
    const malformedProperties = [
        `optional = "false"`,
        `minlength = "1"`,
        `description = 123`,
        `oneof = [ 1, 2 ]`,
        `allowedvalues = "value"`,
    ];
    for (const property of malformedProperties) {
        const source = `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
${property}
`;
        assert.throws(() => parseDocument(source), property);
    }
});

test("range validation compares exact integers and normalized temporal fields", () => {
    const tooSmall = model([definition("value", {
        type: "integer",
        min: "9223372036854775807",
        allowedvalues: ["9223372036854775806"],
    })]);
    assert.ok(errors(tooSmall).some((issue) => issue.message.includes("violates `min`")));

    const equivalentTime = model([definition("value", {
        type: "local-time",
        min: "12:00:00.100",
        allowedvalues: ["12:00:00.1"],
    })]);
    assert.deepEqual(errors(equivalentTime), []);

    const equivalentInstant = model([definition("value", {
        type: "offset-date-time",
        min: "2026-08-18T12:00:00-04:00",
        allowedvalues: ["2026-08-18T16:00:00Z"],
    })]);
    assert.deepEqual(errors(equivalentInstant), []);
});

test("duplicate top-level and nested definition names are rejected", () => {
    const duplicates = model([
        definition("same", { type: "string" }),
        definition("same", { type: "integer" }),
        definition("parent", { type: "table" }, [
            definition("child", { type: "string" }),
            definition("child", { type: "boolean" }),
        ]),
    ]);
    assert.equal(errors(duplicates).filter((issue) => issue.message.includes("Duplicate schema definition")).length, 2);
});

test("metadata keys with apostrophes serialize as valid TOML", () => {
    const source = `
[toml-schema]
version = "1.0.0"

[toml-schema.meta]
"it's" = 1

[elements]
`;
    const parsed = parseDocument(source);
    assert.deepEqual(parseDocument(serializeDocument(parsed)), parsed);
});

test("toml-schema.meta must be a table", () => {
    const source = `
[toml-schema]
version = "1.0.0"
meta = "not a table"

[elements]
`;
    assert.throws(() => parseDocument(source), /meta must be a table/);
});

test("array item enums do not use array length constraints as string lengths", () => {
    const valid = model([definition("values", {
        type: "array",
        itemtype: "string",
        minlength: 3,
        allowedvalues: ['"x"'],
    })]);
    assert.deepEqual(errors(valid), []);
});

test("tuple items are mutually exclusive with allowedvalues", () => {
    const invalid = model([definition("values", {
        type: "array",
        items: ["string", "integer"],
        allowedvalues: ['"x"', "1"],
    })]);
    assert.ok(errors(invalid).some((issue) => issue.message.includes("mutually exclusive with `allowedvalues`")));
});

test("empty allowedvalues arrays remain valid and round-trip", () => {
    const source = `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
allowedvalues = []
`;
    const parsed = parseDocument(source);
    assert.deepEqual(errors(parsed), []);
    assert.deepEqual(parseDocument(serializeDocument(parsed)), parsed);
});

test("duplicate TOML keys and table declarations are rejected", () => {
    const duplicateKey = `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"
type = "integer"
`;
    const duplicateTable = `
[toml-schema]
version = "1.0.0"

[elements.value]
type = "string"

[elements.value]
type = "integer"
`;
    assert.throws(() => parseDocument(duplicateKey), /Duplicate key/);
    assert.throws(() => parseDocument(duplicateTable), /Duplicate table declaration/);
});

test("TOML keys cannot modify object prototypes", () => {
    assert.equal({}.polluted, undefined);
    const parsed = parseToml("__proto__.polluted = true");
    assert.equal(parsed.__proto__.polluted, true);
    assert.equal({}.polluted, undefined);
});

test("invalid calendar, clock, and offset fields are rejected", () => {
    for (const value of [
        "2023-99-99",
        "2023-02-29",
        "25:61:61",
        "2026-08-18T25:00:00",
        "2026-08-18T12:00:00+99:99",
    ]) {
        assert.throws(() => parseToml(`value = ${value}`), /Invalid/);
    }
    assert.doesNotThrow(() => parseToml("value = 2024-02-29T23:59:59.100+23:59"));
});

test("document structure violations are rejected while parsing", () => {
    const malformed = [
        `[types.X]\ntype = "string"\n`,
        `[toml-schema]\nversion = "1.0.0"\n[elements]\n[extra]\nx = 1\n`,
        `[toml-schema]\nversion = "1.0.0"\n[elements.x]\ntype = "table"\ntypo = "value"\n`,
        `[toml-schema]\nversion = 1\n[elements]\n`,
        `[toml-schema]\nversion = "1.0.0"\ncustom = "value"\n[elements]\n`,
    ];
    for (const source of malformed) assert.throws(() => parseDocument(source));
});

test("current schema-load rules reject malformed models", () => {
    const malformed = [
        model([], [definition("string", { type: "string" })]),
        model([definition("x", { oneof: ["any", "string"] })]),
        model([definition("x", { type: "array", itemtype: "collection" })]),
        model([definition("x", { type: "string", minlength: -1 })]),
        model([definition("x", { type: "string", minlength: 2, maxlength: 1 })]),
        model(
            [definition("x", { type: "types.S", allowedvalues: ['"x"'] })],
            [definition("S", { type: "string" })],
        ),
        model([definition("x", { type: "float", min: "nan" })]),
        model([definition("x", { type: "integer", min: '"x"' })]),
        model([definition("x", { type: "string", pattern: "^[a-z]+$", allowedvalues: ['"123"'] })]),
        model([], [], "1.0.0garbage"),
        model([], [], "2.0.0"),
    ];
    for (const value of malformed) assert.ok(errors(value).length > 0);
});

test("supported patch, prerelease, and build versions remain valid", () => {
    for (const version of ["1.0.0", "1.0.9", "1.0.0-rc.1", "1.0.0-1a", "1.0.0+build.7"]) {
        assert.deepEqual(errors(model([], [], version)), [], version);
    }
});

test("portable patterns use Unicode scalar-value semantics", () => {
    const value = model([definition("emoji", {
        type: "string",
        pattern: "^.$",
        allowedvalues: ['"😀"'],
    })]);
    assert.deepEqual(errors(value), []);
});
