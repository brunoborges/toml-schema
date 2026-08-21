# TOML Schema Conformance Corpus

A shared, language-neutral set of fixture cases that every TOML Schema reference
implementation runs, so we can answer **"do all six implementations agree with
the specification?"** mechanically instead of by inspection.

This directory is only the corpus and its manifest. Wiring it into each
implementation's test suite is a separate task.

## What a case is

Each case lives in `cases/<case-id>/` and contains:

- `schema.tosd` — the TOML Schema document under test (always present);
- `document.toml` — the TOML document to validate against it (present only when
  the expected outcome involves a document).

The machine-readable index is [`manifest.toml`](manifest.toml): an array of
`[[case]]` tables, one per case.

## The `expect` vocabulary

Every case declares exactly one expected outcome, mapped to the canonical `tosd`
CLI exit code, which is the contract (see SPEC.md, *Command-Line Exit Status*):

| `expect`             | Meaning                                                                 | Exit | Document |
| -------------------- | ----------------------------------------------------------------------- | ---- | -------- |
| `schema-load-error`  | the schema itself is malformed; loading MUST fail before any document   | 2    | absent   |
| `document-parse-error` | the schema loads, but the document is not well-formed TOML            | 2    | required |
| `validation-failure` | the schema loads, but the document violates it                          | 1    | required |
| `valid`              | the schema loads and the document satisfies it (warnings permitted)     | 0    | required |

A `document-parse-error` case never reaches validation, so it MUST produce **no
diagnostics at all** — not a registry code and not an extension code. `SPEC.md`
requires that a document which is not well-formed TOML "never reaches a
validator, and its parse failure is a parse error rather than a validation
diagnostic", and that an implementation "MUST NOT report the document as
invalid". Such a case is therefore asserted by its exit status and by the
*absence* of diagnostics.

A case with no `document.toml` is always `schema-load-error`. A `valid` case
always supplies a document, so it proves the schema loads *and* accepts a value,
rather than merely not crashing.

### Running a `schema-load-error` case

The canonical CLI's two-argument form, `tosd validate <schema.tosd>
<document.toml>`, is what actually loads a schema. A `schema-load-error` case
carries no document, so a runner must still hand the CLI a throwaway document as
the second argument; the schema-load failure (exit 2) happens before the
document is examined. Do **not** run the one-argument form on the `.tosd`: it
treats the file as a *document* and fails schema **discovery**, which is a
different exit-2 path and does not test schema loading at all.

## What the corpus asserts — and what it does not

Each case asserts its outcome and phase (load vs. validation) via the `expect`
value above, and — for cases carrying `[[case.diagnostics]]` — the specific
diagnostics listed there, under the REQUIRED-PRESENT semantics described below.

It deliberately does **not** assert message text, and never compares
diagnostics by message: `SPEC.md` states implementations "MUST NOT be compared,
and MUST NOT compare themselves, by message text."

## How expectations are decided

**Every expected outcome is derived from `SPEC.md`, and each case cites the
section that dictates it** (the `spec` field in `manifest.toml`). An expectation
is never obtained by running an implementation and recording what it does — that
would enshrine current behavior, bugs included, and defeat the purpose. When an
implementation disagrees with a case, that is a finding about the
implementation, not a reason to edit the case.

## Adding a case

1. Read the relevant part of `SPEC.md` and decide what the specification
   **requires** for the situation.
2. Create `cases/<case-id>/schema.tosd` (and `document.toml` unless the case is
   `schema-load-error`). Keep the fixture **minimal**: the smallest schema that
   isolates the one rule.
3. Add a `[[case]]` entry to `manifest.toml` with `id`, `expect`, a one-line
   `summary`, the `spec` citation (a section heading or a quoted sentence), the
   `origin` (provenance), and `document` (`true`/`false`).
4. Every `schema.tosd` MUST declare `[toml-schema]` with `version = "1.0.0"`.
   TOML Schema 1.0.0 is not yet released; never write a higher version anywhere.
5. Every fixture MUST be valid TOML *syntax*, even when it is a semantically
   invalid schema — unless the case is specifically about a TOML syntax error,
   in which case flag that clearly in the case `summary`.
6. Keep each case self-contained; never reference files outside its directory.

### Case ids

Lowercase kebab-case, prefixed by provenance where it exists (`c07-`, `c22-`)
and otherwise by a short topical prefix (`permember-`, `pattern-`,
`allof-`). Ids are stable and descriptive because they appear in six test
suites' output.

## Provenance (`origin`)

- `grok C1`…`grok C35` — cases drawn from an adversarial counterexample catalog.
  `C1`–`C13`, `C34`, `C35` were genuine specification defects that have since
  been fixed; their cases are **regression guards** pinning the now-correct
  behavior. `C14`–`C33` are behaviors the spec deliberately defines (several
  surprising); their cases are **preservation cases** pinning intended behavior.
- `phase decision` — decisions settled across the three completed specification
  phases (closed keyword set, `min <= max`, `allof` composition, per-member
  constraints, the portable RE2 profile, and so on).

## Expected diagnostics (`[[case.diagnostics]]`)

A case MAY declare diagnostics that a conforming implementation must produce, in
addition to its `expect` outcome:

```toml
[[case]]
id = "c07-inverted-range-error"
expect = "schema-load-error"

  [[case.diagnostics]]
  phase = "schema-load"
  severity = "error"
  code = "inverted-range"
  schema_path = "$.elements.port"
```

Fields follow the `### Diagnostic Record` table in SPEC.md. `phase` is
`discovery`, `schema-load`, or `validation`; `severity` is `error` or `warning`;
`code` is a registry code. `instance_path` is present for validation diagnostics
and absent for schema-load ones; `schema_path` is present when the condition is
attributable to a location in the schema. `message` is never asserted: SPEC.md
states messages are presentation and that implementations "MUST NOT be compared,
and MUST NOT compare themselves, by message text."

### These are REQUIRED-PRESENT, not an exact set

An implementation passes when every listed diagnostic appears in its output. It
MAY emit more.

An omitted `instance_path` or `schema_path` on an expectation means **unasserted**,
not "must be absent". A case may pin a code without committing to a path where the
specification does not fix one. The one exception is normative rather than
conventional: schema-load and discovery diagnostics MUST NOT carry an
`instance_path` at all, and universal check 4 below enforces that for every
diagnostic regardless of what a case asserts.

This is deliberate and follows from SPEC.md rather than from convenience. A
validator "MAY stop after the first validation error (fail-fast) or collect
further errors", and "a single schema-load error is sufficient to reject the
schema". Two implementations that both conform can therefore emit different
*numbers* of diagnostics for the same input. An exact-set assertion would fail
conforming implementations, so the corpus asserts presence.

Because presence alone cannot catch an implementation that emits the right
diagnostic plus junk, runners pair it with the universal checks below, which
apply to every diagnostic of every case and do constrain the whole output.

### Universal checks (every diagnostic, every case)

1. Every unprefixed `code` MUST appear in the SPEC.md registry. SPEC.md:
   "Implementations MUST NOT emit an unprefixed code that is not in this
   registry." Any other code MUST match `x-[a-z][a-z0-9]*-` (an extension code).
2. `severity` MUST be `error` or `warning`, and `phase` MUST be one of the three
   phases.
3. `deprecated` and `version-mismatch` are the only warnings in this version;
   every other registry code is an error.
4. Schema-load and discovery diagnostics MUST NOT carry an `instance_path`. The
   sole exception in SPEC.md is `resource-limit-exceeded` produced during
   validation.
5. Any `instance_path` or `schema_path` MUST parse under the path grammar:
   starting `$`, then `.` plus either a bare segment of `[A-Za-z0-9_-]+` or an
   RFC 8259 JSON string, or `[` plus an index with no sign and no leading zeros.
6. A `valid` case MUST produce no `error`-severity diagnostic; a
   `validation-failure` case MUST produce at least one.

### Deriving expectations

Same anti-tautology rule as the rest of the corpus, and it matters more here.
Expectations MUST be derived from SPEC.md, never from what an implementation
currently prints. At the time these were written no implementation emitted
`schema_path` at all and four emitted a generic `validation-error` code that the
specification forbids, so recording observed behavior would have encoded exactly
the defects the corpus exists to detect.

Where SPEC.md fixes the instance path for a code, that wording governs. It is
often deliberately not the obvious node: `missing-required` points at the absent
child's path "even though no node is there", `tuple-length` points at the array
rather than an index, `uniqueitems` points at the *later* duplicate,
`mutuallyexclusive` and `exactlyone` point at the parent table, and
`dependentrequired` points at the missing dependent rather than the trigger.



This corpus is consumed by all six reference implementations (Rust — including
the canonical `tosd` CLI — Java, Go, .NET, Python, and TypeScript). Each is
expected to reproduce the `expect` outcome for every case.
