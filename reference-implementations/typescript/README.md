# TOML Schema — Node.js / TypeScript reference implementation

A TOML Schema 1.0 reference library for Node.js, written in TypeScript and
published as an ESM package (`@tomlschema/toml-schema`). It parses TOML with
[`smol-toml`](https://github.com/squirrelchat/smol-toml) and validates the
parsed data model against a `.tosd` schema document, following the same
behavior as the other reference implementations in this repository (see
[`../go`](../go), [`../java`](../java), [`../dotnet`](../dotnet), and
[`../rust`](../rust)).

This package is a **reference implementation**, not a versioned,
package-registry release: its own `package.json` version
(`1.0.0-rc.2`) tracks the reference-implementation artifact lifecycle, which
is independent from the TOML Schema **language** version it implements
(`1.0.0`, per `[toml-schema].version` in schema documents).

## Requirements

- Node.js >= 20.11 (native `node --test`, `node:fs/promises`, ESM)
- TypeScript 6.x (the package pins the **exact** version `6.0.3`; TypeScript 7
  is intentionally out of range until this implementation is verified against
  it)

## Install

```shell
cd reference-implementations/typescript
npm install
```

## Build, test, typecheck

```shell
npm run build       # tsc -p tsconfig.build.json -> dist/*.js, *.d.ts
npm test            # node --import tsx --test test/*.test.ts
npm run typecheck   # tsc -p tsconfig.test.json --noEmit (src + test)
```

## Why `smol-toml`

TOML parsing itself is intentionally **not** reimplemented here. `smol-toml`
is used with two options that matter for TOML Schema's data-model
distinctions:

- `integersAsBigInt: true` — TOML integers parse to `bigint`, kept distinct
  from `number`-valued floats. This preserves the integer/float type
  distinction that TOML Schema's `type = "integer"` vs. `type = "float"` and
  numeric range/`allowedvalues` comparisons depend on, including integers
  beyond `2^53` that would otherwise lose precision as `number`.
- `TomlDate` — offset date-times, local date-times, local dates, and local
  times parse to a shared `TomlDate` class that preserves which of the four
  temporal kinds a value is, so schema comparisons (`type`, `min`/`max`) can
  distinguish them exactly as `SPEC.md` requires. Note `TomlDate` itself
  represents sub-second precision to the millisecond, not with unbounded
  fractional-second precision.

## API overview

All entry points are exported from the package root (`src/index.ts`
-> `dist/index.js`):

```ts
import {
  loadSchema,
  loadDocument,
  Schema,
  schemaFromDocument,
  validateDocument,
  generateSchema,
  extractSchemaFile,
  BUILTIN_TYPES,
  DEFINITION_KEYS,
} from "@tomlschema/toml-schema";
```

### Loading and validating with an explicit schema

```ts
import { loadSchema, loadDocument } from "@tomlschema/toml-schema";

const schema = await loadSchema("config.tosd");
const document = await loadDocument("config.toml");

const result = schema.validate(document);
// or, in one step, reading the document from disk:
const result2 = await schema.validateFile("config.toml");

if (!result.valid) {
  for (const error of result.errors) {
    console.error(`${error.path}: ${error.message}`);
  }
}
```

`Schema.validate`/`validateFile` return a `ValidationResult`:

```ts
class ValidationResult {
  readonly errors: readonly ValidationError[];     // fatal — validity failures
  readonly warnings: readonly Diagnostic[];         // non-fatal — deprecation, version mismatch, etc.
  readonly diagnostics: readonly Diagnostic[];      // errors ++ warnings, in that order
  get valid(): boolean;                             // errors.length === 0
  isValid(): boolean;                                // method form of `.valid`
}
```

Each `ValidationError`/`Diagnostic` carries a `severity` (`"error"` |
`"warning"`), a stable `code`, the offending document `path` (e.g.
`$.database.port`, with `.` and quoting applied to keys that need it), and a
human-readable `message`.

### Discovering the schema from the document (`[toml-schema].location`)

```ts
import { validateDocument, schemaFromDocument } from "@tomlschema/toml-schema";

// one-shot discover + validate
const result = await validateDocument("config.toml");

// or, to inspect the discovered schema/warnings first:
const { schema, document } = await schemaFromDocument("config.toml");
console.log(schema.version, schema.warnings);
const result2 = schema.validate(document);
```

`schemaFromDocument` resolves a `[toml-schema].location` value that is either
a path relative to the document's own directory, an absolute local path, or a
hierarchical `file:` URI; it rejects unsupported URI schemes, opaque `file:`
URIs, non-local hosts, and query/fragment components. If the document also
declares `[toml-schema].version`, discovery rejects a major-version mismatch
against the schema's own declared version and records other (minor/patch)
mismatches as a warning on the returned `Schema`.

### Extracting a starter schema from a document

```ts
import { generateSchema, extractSchemaFile } from "@tomlschema/toml-schema";

const draftSource = generateSchema(document); // string of draft .tosd TOML
await extractSchemaFile("config.toml", "config.draft.tosd");
```

Extraction infers `[types]`/`[elements]` structure and built-in types from
the parsed document, emits homogeneous arrays with an inferred `itemtype`,
sorts keys deterministically, and quotes keys that are not valid bare TOML
keys.

### Inspecting a schema's definitions

```ts
const schema = await loadSchema("config.tosd");
const element = schema.element("database"); // Definition | undefined
element?.description;                       // effective, inherited description
element?.deprecated;                        // effective, inherited deprecated flag
element?.hasDefault();                      // whether an effective default exists
element?.default();                         // the effective default value, if any
element?.child("port");                     // Definition | undefined, for table/collection children
element?.childNames();                      // string[]

const namedType = schema.type("types.server"); // also accepts "server"
```

`Definition` accessors always resolve inherited/effective annotations
(`description`, `deprecated`, `default`) through named-type references and
`allof` composition, matching the other reference implementations.

### Vocabulary constants

```ts
import { BUILTIN_TYPES, DEFINITION_KEYS, CURRENT_TOML_SCHEMA_VERSION } from "@tomlschema/toml-schema";
```

- `BUILTIN_TYPES` — the 12 built-in `type` values (`string`, `integer`,
  `float`, `boolean`, `offset-date-time`, `local-date-time`, `local-date`,
  `local-time`, `array`, `table`, `collection`, `any`).
- `DEFINITION_KEYS` — the full set of recognized schema-vocabulary keys that
  may appear on a definition (`type`, `optional`, `default`, `if`,
  `dependentrequired`, etc.), used to disambiguate an inline-table annotation
  from a colliding child-table name (see below).
- `CURRENT_TOML_SCHEMA_VERSION` — `"1.0.0"`, the schema-language version this
  implementation targets.

Both constants are checked in `test/abnf.test.ts` against `toml-schema.abnf`
so vocabulary drift between the grammar and the implementation is caught in
CI.

## Implemented semantics

This implementation follows `SPEC.md` and mirrors the Go reference
implementation's behavior (`../go/schema.go`, `source.go`, `extract.go`) for:

- All built-in types, `[toml-schema]`/`[types]`/`[elements]` top-level shape,
  and SemVer-validated `[toml-schema].version` (rejecting shorthand forms
  like `"1"`/`"1.0"`).
- Required/optional/closed table structure, arrays (`itemtype` for
  homogeneous arrays, `items` for positional tuples), and dynamic-key
  `collection`s (`itemtype`/`keypattern`).
- Numeric/date-time `min`/`max` ranges (inclusive) and Unicode-scalar-value
  `minlength`/`maxlength` string bounds.
- `allowedvalues` and RE2-portable-style `pattern`/`keypattern` string
  constraints.
- `oneof` (exactly one alternative), `anyof` (at least one alternative), and
  `allof` (additive composition, including table/collection structural
  closure over every contributing shape, with an effective-kind conflict
  check).
- `if`/`then`/`else` conditional selectors, matched by TOML parsed-value
  equality (`equals`/`in`) rather than identity, with cycle detection and
  incompatible-branch-kind rejection.
- `dependentrequired`, `mutuallyexclusive`, and `exactlyone` sibling-presence
  rules.
- `uniqueitems`, compared using TOML/structural equality (including nested
  tables), not reference identity.
- `default` values, validated against their own definition at schema-load
  time but never materialized into a validated document, including
  inheritance through named-type references and conflict detection across
  `allof` composition.
- `deprecated`, producing a structured, branch-local warning without
  affecting `valid`.
- Named type references (`types.<name>`), reference-cycle detection, and
  schema-level semantic validation (performed once at schema-load time, not
  per document).
- Reserved root `[toml-schema]` metadata (ignored during document validation
  unless the schema explicitly defines `[elements.toml-schema]`).
- Local-path/`file:` URI schema discovery via `[toml-schema].location`, and
  version-mismatch warnings/errors.
- Draft-schema extraction with quoted-key encoding for keys that are not
  valid bare TOML keys.
- The inline-table-annotation vs. colliding-child-table-name distinction: a
  raw-source scanner (`src/tomlSource.ts`) records which table-valued schema
  keys were written as `key = { ... }` (an annotation, e.g. `default = { ... }`
  or `dependentrequired = { ... }`) versus a `[a.b.key]` table header (a child
  definition literally named `default`), because a parsed TOML value alone
  cannot recover this distinction.

## Package layout

```
src/
  builtins.ts     BUILTIN_TYPES, DEFINITION_KEYS, and other vocabulary constants
  values.ts       TOML value model (TomlValue/TomlTable/TomlScalar) and equality/kind helpers
  errors.ts       SchemaError, DocumentError
  document.ts     parseToml, loadDocument
  tomlSource.ts   raw-source scanner recovering inline-table-vs-table-header syntax choices
  paths.ts        validation-diagnostic path encoding and TOML key quoting
  definition.ts   RawDefinition (internal) and the public Definition accessor class
  schemaParser.ts parses [types]/[elements] tables into RawDefinition trees
  semantics.ts    schema-load-time semantic validation (references, cycles, defaults, ranges, ...)
  validator.ts    DocumentValidator: validates a parsed document against a loaded schema
  semver.ts       SemVer 2.0.0 parsing/validation shared by schema loading and discovery
  schema.ts       the public Schema class, loadSchema, loadSchemaFromSource
  discovery.ts    schemaFromDocument, validateDocument, [toml-schema].location resolution
  extract.ts      generateSchema, extractSchemaFile
  index.ts        public package entry point
test/
  helpers.ts           shared test utilities (repo-root/example-path resolution, scratch dir)
  checked-in.test.ts   validates this repo's checked-in config.toml/config.tosd/toml-schema.tosd
  abnf.test.ts         BUILTIN_TYPES/DEFINITION_KEYS vs. toml-schema.abnf conformance
  diagnostics.test.ts  ValidationResult shape (errors/warnings/diagnostics/valid/isValid)
  discovery.test.ts    schema discovery via [toml-schema].location, version mismatches
  extract.test.ts      generateSchema/extractSchemaFile
  composition.test.ts  oneof/anyof/allof
  conditional.test.ts  if/then/else selectors
  structure.test.ts    arrays, collections, sibling rules, uniqueitems, defaults, deprecation
  keys.test.ts         quoted/dotted/colliding schema keys, inline-annotation disambiguation
  values.test.ts       bigint/float precision and temporal-kind edge cases
```

Tests run directly against the TypeScript sources via `tsx` (no separate
compile step is required to run `npm test`); `npm run build` produces the
published `dist/` output separately.

## Notes and limitations

- `TomlDate`'s fractional-second precision is millisecond-level; documents or
  schema `min`/`max` boundaries relying on finer sub-millisecond precision
  are not distinguished beyond that resolution. This is a `smol-toml`
  characteristic, not a TOML Schema semantic gap.
- This package targets Node.js's built-in test runner and ESM only; it does
  not ship a CommonJS build.
