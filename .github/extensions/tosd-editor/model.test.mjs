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
    assert.throws(
        () => parseDocument('[toml-schema]\nversion = "1.0.0"\n[elements.parent]\ntype = "table"\n[elements.parent.children.arbitrary]\ntype = "string"\n'),
        /may escape only schema-property child names/,
    );
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

test("string formats round-trip and validate allowed values and defaults", () => {
    const source = `
[toml-schema]
version = "1.0.0"

[elements.endpoint]
type = "string"
format = "uri"
allowedvalues = [ "https://example.com/a%20b" ]
default = "https://example.com/a%20b"
`;
    const parsed = parseDocument(source);
    assert.equal(parsed.elements[0].props.format, "uri");
    assert.deepEqual(errors(parsed), []);
    assert.deepEqual(parseDocument(serializeDocument(parsed)), parsed);

    for (const invalid of [
        model([definition("x", { type: "integer", format: "uuid" })]),
        model([definition("x", { type: "string", format: "date" })]),
        model([definition("x", { type: "string", format: "email", allowedvalues: ['"not-an-email"'] })]),
        model([definition("x", { type: "string", format: "ipv4", default: '"192.168.001.1"' })]),
    ]) {
        assert.ok(errors(invalid).length > 0);
    }
});

test("conditional selectors round-trip and validate the selected default branch", () => {
    const source = `
[toml-schema]
version = "1.0.0"

[types.sqlite]
type = "table"
[types.sqlite.engine]
type = "string"
[types.sqlite.path]
type = "string"

[types.server]
type = "table"
[types.server.engine]
type = "string"
[types.server.host]
type = "string"

[elements.database]
if = { key = "engine", equals = "sqlite" }
then = "types.sqlite"
else = "types.server"
default = { engine = "sqlite", path = "data.db" }
`;
    const parsed = parseDocument(source);
    assert.deepEqual(parsed.elements[0].props.if, { key: "engine", equals: "'sqlite'" });
    assert.deepEqual(errors(parsed), []);
    assert.deepEqual(parseDocument(serializeDocument(parsed)), parsed);

    parsed.elements[0].props.default = '{ engine = "sqlite", host = "wrong-branch" }';
    assert.ok(errors(parsed).some((issue) => issue.message.includes("`default`")));
});

test("conditional selector shape, branches, kinds, and cycles are validated", () => {
    const tableBranch = definition("tableBranch", { type: "table" }, [
        definition("engine", { type: "string" }),
    ]);
    const collectionBranch = definition("collectionBranch", { type: "collection", itemtype: "string" });

    const malformed = [
        model([definition("x", { if: { key: "engine", equals: '"x"' }, then: "types.a" })], [
            definition("a", { type: "table" }),
        ]),
        model([definition("x", { if: { key: "engine", equals: '"x"', in: ['"x"'] }, then: "types.a", else: "types.a" })], [
            definition("a", { type: "table" }),
        ]),
        model([definition("x", { if: { key: "engine", equals: '"x"' }, then: "table", else: "table" })]),
        model([definition("x", { if: { key: "engine", equals: '"x"' }, then: "types.tableBranch", else: "types.collectionBranch" })], [
            tableBranch,
            collectionBranch,
        ]),
        model([], [
            definition("first", { if: { key: "engine", equals: '"x"' }, then: "types.second", else: "types.fallback" }),
            definition("second", { type: "types.first" }),
            definition("fallback", { type: "table" }),
        ]),
        model([definition("x", { if: { key: "engine", equals: '"x"' }, then: "types.mixed", else: "types.tableBranch" })], [
            definition("mixed", { oneof: ["table", "string"] }),
            tableBranch,
        ]),
    ];
    malformed.forEach((value, index) => assert.ok(errors(value).length > 0, `conditional malformed case ${index}`));
});

test("declared defaults are rejected when they violate the effective definition", () => {
    const cases = [
        // Built-in type and constraint violations.
        model([definition("x", { type: "string", default: "1" })]),
        model([definition("x", { type: "string", allowedvalues: ['"a"', '"b"'], default: '"c"' })]),
        model([definition("x", { type: "string", pattern: "^[a-z]+$", default: '"A1"' })]),
        model([definition("x", { type: "integer", min: "1", max: "10", default: "0" })]),
        model([definition("x", { type: "string", minlength: 2, maxlength: 3, default: '"abcd"' })]),
        // Named type reference inherits the referenced constraints.
        model(
            [definition("x", { type: "types.Port", default: "70000" })],
            [definition("Port", { type: "integer", min: "1", max: "65535" })],
        ),
        // Inherited default is validated at the definition that inherits it.
        model(
            [definition("x", { type: "types.Port" })],
            [definition("Port", { type: "integer", max: "65535", default: "70000" })],
        ),
        // Alternative selection.
        model([definition("x", { oneof: ["string", "integer"], default: "true" })]),
        model([definition("x", { anyof: ["string", "integer"], default: "true" })]),
        // Conjunctive allof: every component must accept the default.
        model(
            [definition("x", { type: "string", allof: ["types.Lower", "types.Short"], default: '"abcd"' })],
            [
                definition("Lower", { type: "string", pattern: "^[a-z]+$" }),
                definition("Short", { type: "string", maxlength: 3 }),
            ],
        ),
        // Unequal defaults contributed by allof with no local default.
        model(
            [definition("x", { type: "types.A", allof: ["types.B"] })],
            [
                definition("A", { type: "integer", default: "1" }),
                definition("B", { type: "integer", default: "2" }),
            ],
        ),
        // Fixed children: required child missing and closure violation.
        model([definition("x", { type: "table", default: "{ }" }, [
            definition("name", { type: "string" }),
        ])]),
        model([definition("x", { type: "table", default: '{ name = "a", extra = 1 }' }, [
            definition("name", { type: "string" }),
        ])]),
        // Sibling presence rules.
        model([definition("x", {
            type: "table",
            dependentrequired: { cert: ["key"] },
            default: '{ cert = "c" }',
        }, [
            definition("cert", { type: "string", optional: true }),
            definition("key", { type: "string", optional: true }),
        ])]),
        model([definition("x", {
            type: "table",
            mutuallyexclusive: [["path", "url"]],
            default: '{ path = "p", url = "u" }',
        }, [
            definition("path", { type: "string", optional: true }),
            definition("url", { type: "string", optional: true }),
        ])]),
        model([definition("x", {
            type: "table",
            exactlyone: [["path", "url"]],
            default: "{ }",
        }, [
            definition("path", { type: "string", optional: true }),
            definition("url", { type: "string", optional: true }),
        ])]),
        // Arrays: itemtype, tuple items, uniqueitems, and length.
        model([definition("x", { type: "array", itemtype: "integer", default: '[ 1, "two" ]' })]),
        model([definition("x", { type: "array", items: ["string", "integer"], default: '[ "a" ]' })]),
        model([definition("x", { type: "array", itemtype: "integer", uniqueitems: true, default: "[ 1, 1 ]" })]),
        model([definition("x", { type: "array", itemtype: "integer", minlength: 2, default: "[ 1 ]" })]),
        model([definition("x", { type: "array", itemtype: "integer", min: "0", default: "[ -1 ]" })]),
        // Collections: fixed children, dynamic itemtype, and keypattern.
        model(
            [definition("x", { type: "collection", itemtype: "types.Entry", default: "{ }" }, [
                definition("enabled", { type: "boolean" }),
            ])],
            [definition("Entry", { type: "integer" })],
        ),
        model(
            [definition("x", { type: "collection", itemtype: "types.Entry", default: '{ a = "one" }' })],
            [definition("Entry", { type: "integer" })],
        ),
        model(
            [definition("x", {
                type: "collection",
                itemtype: "types.Entry",
                keypattern: "^[a-z]+$",
                default: "{ AB = 1 }",
            })],
            [definition("Entry", { type: "integer" })],
        ),
    ];
    for (const value of cases) {
        const found = errors(value).filter((issue) => issue.message.includes("`default`"));
        assert.equal(found.length > 0, true, JSON.stringify(value.elements[0]));
    }
});

test("declared defaults that satisfy the effective definition are accepted", () => {
    const valid = [
        model([definition("x", {
            type: "string",
            pattern: "^[a-z]+$",
            minlength: 1,
            maxlength: 4,
            allowedvalues: ['"abc"', '"ab"'],
            default: '"abc"',
        })]),
        model([definition("x", { type: "float", min: "0.0", max: "1.0", default: "0.5" })]),
        model([definition("x", { type: "local-time", min: "12:00:00.100", default: "12:00:00.1" })]),
        model(
            [definition("x", { type: "types.Port", default: "8080" })],
            [definition("Port", { type: "integer", min: "1", max: "65535" })],
        ),
        model(
            [definition("x", { oneof: ["string", "integer"], default: "7" })],
            [],
        ),
        model(
            [definition("x", { type: "string", allof: ["types.Lower", "types.Short"], default: '"abc"' })],
            [
                definition("Lower", { type: "string", pattern: "^[a-z]+$" }),
                definition("Short", { type: "string", maxlength: 3 }),
            ],
        ),
        // Equal defaults contributed by composition are deduplicated.
        model(
            [definition("x", { type: "types.A", allof: ["types.B"] })],
            [
                definition("A", { type: "integer", default: "1" }),
                definition("B", { type: "integer", default: "1" }),
            ],
        ),
        model([definition("x", {
            type: "table",
            exactlyone: [["path", "url"]],
            dependentrequired: { path: ["mode"] },
            default: '{ path = "p", mode = "fast" }',
        }, [
            definition("path", { type: "string", optional: true }),
            definition("url", { type: "string", optional: true }),
            definition("mode", { type: "string", optional: true }),
        ])]),
        model([definition("x", {
            type: "array",
            itemtype: "integer",
            uniqueitems: true,
            minlength: 2,
            min: "0",
            default: "[ 1, 2 ]",
        })]),
        model([definition("x", { type: "array", items: ["string", "integer"], default: '[ "a", 1 ]' })]),
        model(
            [definition("x", {
                type: "collection",
                itemtype: "types.Entry",
                keypattern: "^[a-z]+$",
                default: '{ enabled = true, alpha = { port = 1 } }',
            }, [definition("enabled", { type: "boolean" })])],
            [definition("Entry", { type: "table" }, [definition("port", { type: "integer" })])],
        ),
    ];
    for (const value of valid) {
        assert.deepEqual(errors(value), [], JSON.stringify(value.elements[0]));
    }
});

test("default validation suppresses deprecation warnings and tolerates cycles", () => {
    const deprecated = model(
        [definition("x", { type: "types.Legacy", default: '"value"' })],
        [definition("Legacy", { type: "string", deprecated: true })],
    );
    assert.deepEqual(validateModel(deprecated), []);

    const recursive = model(
        [definition("x", { type: "types.A", default: '"value"' })],
        [
            definition("A", { type: "types.B" }),
            definition("B", { type: "types.A" }),
        ],
    );
    const cyclic = errors(recursive).filter((issue) => issue.path === "elements.x");
    assert.equal(cyclic.length, 1);
    assert.match(cyclic[0].message, /cyclic type reference/);

    // Recursion through child definitions is legal and terminates on a finite value.
    const nested = model(
        [definition("x", { type: "types.Node", default: "{ child = { } }" })],
        [definition("Node", { type: "table" }, [
            definition("child", { type: "types.Node", optional: true }),
        ])],
    );
    assert.deepEqual(errors(nested), []);

    const withoutDefault = model(
        [definition("x", { type: "types.Node" })],
        [definition("Node", { type: "table" }, [
            definition("child", { type: "types.Node", optional: true }),
        ])],
    );
    assert.deepEqual(errors(withoutDefault), []);
});

test("default annotations never mutate the model and keep parser precision", () => {
    const source = `
[toml-schema]
version = "1.0.0"

[elements.big]
type = "integer"
default = 9223372036854775807

[elements.exact]
type = "float"
default = 1e0

[elements.moment]
type = "offset-date-time"
default = 2026-08-18T12:00:00-04:00

[elements.holder]
type = "table"
default = { name = 'a' }

    [elements.holder.name]
    type = "string"
`;
    const parsed = parseDocument(source);
    const snapshot = JSON.parse(JSON.stringify(parsed));
    assert.deepEqual(errors(parsed), []);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed)), snapshot);
    const serialized = serializeDocument(parsed);
    assert.match(serialized, /default = 9223372036854775807/);
    assert.match(serialized, /default = 1e0/);
    assert.match(serialized, /default = 2026-08-18T12:00:00-04:00/);
    assert.match(serialized, /default = \{ name = 'a' \}/);
    assert.deepEqual(parseDocument(serialized), parsed);
});
