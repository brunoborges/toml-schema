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
| `validation-failure` | the schema loads, but the document violates it                          | 1    | required |
| `valid`              | the schema loads and the document satisfies it (warnings permitted)     | 0    | required |

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

Each case asserts **only the outcome and the phase** (load vs. validation) via
the `expect` value above.

It deliberately does **not** assert error codes, message text, severity, or
instance/schema paths. A canonical diagnostic model and error-code registry is
specified but not yet implemented (tracked in issue #169). Asserting codes now
would couple this corpus to unfinished work and make it fail across the board.
Tightening the corpus to also assert diagnostic codes is the natural follow-up
once #169 lands.

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

## Consumers

This corpus is consumed by all six reference implementations (Rust — including
the canonical `tosd` CLI — Java, Go, .NET, Python, and TypeScript). Each is
expected to reproduce the `expect` outcome for every case.
