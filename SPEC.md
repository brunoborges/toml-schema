# TOML Schema Specification

TOML Schema is a set of TOML-based constructs that define the structure, the names, and the types of configuration data in a TOML file.

TOML Schema validates the parsed input of a TOML file to:

1. Eliminate or reduce misconfiguration that could cause damage if it were only detected when the configuration is evaluated in production,
1. Be leveraged by editors and other tools to provide and enrich auto-completion and code hints for validation on the fly.

The schema format follows the TOML specification, meaning that a TOML Schema is in itself a valid TOML document. The revision of TOML that this specification is defined against is pinned under [TOML Language Version](#toml-language-version).

## Conformance Terminology

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
**MAY**, and **OPTIONAL** in this document are to be interpreted as described in
[BCP 14](https://www.rfc-editor.org/info/bcp14) when, and only when, they
appear in all capitals.

A **schema loader** parses a TOML Schema document and rejects malformed
schemas. A **validator** applies a successfully loaded schema to a TOML
document. An **implementation** may provide both components in one API or
command.

## Terminology

This section defines the domain terms the normative rules in this document are
written with. It complements [Conformance Terminology](#conformance-terminology):
that section fixes the BCP 14 keywords and the schema loader, validator, and
implementation roles, and this one fixes the nouns those roles act on. Where an
authoritative rule for a concept already exists, the entry below points at the
section that owns it rather than restating it.

Two sides are kept strictly apart, because most cross-term confusion comes from
mixing them:

- the **schema side** — the TOML Schema document and the definitions it
  contains; and
- the **document side** — the parsed TOML document under validation and its
  values.

A term that names something on one side MUST NOT be read as its counterpart on
the other.

### Schema-side terms

- **Schema definition** (also **definition**). One coherent set of rules that
  governs a single position. A definition is written as a TOML table or
  key/value entry inside `[types]` or `[elements]`, or nested below one. Every
  definition has exactly one effective type and MAY carry
  [schema definition properties](#schema-definition-properties). "Definition" is
  the preferred short form; "schema definition" is the same thing spelled in
  full.

- **Element**. A definition that is a direct child of `[elements]`; it describes
  one top-level key of the validated document. See
  [Elements table](#elements-table---elements). Elements follow the same rules as
  `[types]` definitions except that an element MUST NOT reference another
  element.

- **Schema (definition) property**. A key/value pair written directly inside a
  definition whose name is one of the closed set of keywords listed under
  [Schema Definition Properties](#schema-definition-properties) (`type`, `oneof`,
  `itemtype`, `optional`, `default`, and the rest). A schema property is metadata
  on the schema side; it is never a key of the validated document. A same-named
  document key is instead described by a **child definition** (see *fixed
  child*), written through the reserved `children` namespace when the definition
  also uses the property. Do not use "property" for a document key.

- **Selector**. The property by which a definition chooses the type it governs:
  `type`, `oneof`, `anyof`, or the `if`/`then`/`else` triple. At most one
  selector applies to a definition, and two constructs supply an omitted one: a
  definition with nested child definitions and no explicit selector is an
  **implicit table** (`type = "table"`), and a definition whose only applicator
  is `allof` is a **pure mixin** whose effective type comes from its components.
  See [Types table](#types-table---types) and
  [Composition Supplying the Local Skeleton](#composition-supplying-the-local-skeleton).

- **Schema type**. The type a definition *selects* through `type`: a built-in
  type name (`"string"`, `"integer"`, `"array"`, `"table"`, `"collection"`,
  `"any"`, a temporal type, and so on) or a named reusable definition from
  `[types]`. The schema type is what is written; it is not yet resolved through
  references or composition.

- **Effective type**. The type a definition *resolves to* after following every
  named `type` reference to a concrete definition and composing every
  [`allof`](#conjunctive-composition---allof) component. Compatibility of a
  composition, the applicability of kind-specific properties such as `format`,
  `min`, and `keypattern`, and the choice of merge rule are all decided from the
  effective type, not from the written schema type. A definition's effective type
  has a coarse category — a scalar of a specific scalar type, `array`, `table`,
  or `collection` — and that category is what a composition MUST agree on and
  what a parsed value's **TOML kind** (below) is checked against. Some existing
  prose in this document spells this concept *effective kind* or *effective TOML
  kind*; those are the same concept, and *effective type* is the preferred term.

- **Named type** / **reusable definition**. A definition under `[types]`,
  referenced by name from a selector, `itemtype`, `items`, or `allof`. See
  [Types table](#types-table---types).

- **Type reference** / **reference**. A string that names a built-in type or a
  named reusable definition, accepted by `type`, `itemtype`, `items`, `oneof`,
  `anyof`, `allof`, `then`, and `else`. The optional `types.` prefix is stripped
  once before lookup. Which reference each of those positions accepts is stated
  under [Type Reference Restrictions](#type-reference-restrictions), and the
  resolution and edge-classification rules for references
  are defined under [Reference Resolution](#reference-resolution) and
  [The Reference Graph](#the-reference-graph).

- **Use site**. The location at which a named definition is referenced, as
  opposed to the named definition itself. A **use-site** annotation (`optional`,
  `default`) is one written at the reference rather than on the referenced
  definition; the interaction of use-site and referenced annotations is defined
  under [Type Reference](#type-reference),
  [Optionality](#optionality---optional), and [Default](#default---default).

- **Participant** and **`allof` component**. In an
  [`allof`](#conjunctive-composition---allof) composition, a *participant* is the
  local definition or any one of its `allof` components, as defined in place
  under [Merging by TOML Kind](#merging-by-toml-kind). An *`allof` component* is
  one referenced definition contributed to the composition.

- **Pure mixin**. A definition whose only applicator is a non-empty `allof`,
  with no selector and no nested child definition. It is valid when its
  components resolve to exactly one TOML kind, which becomes its effective type.
  [Composition Supplying the Local Skeleton](#composition-supplying-the-local-skeleton)
  is authoritative.

- **Per-member value-constraint subset**. The five properties `allowedvalues`,
  `min`, `max`, `pattern`, and `format`, which MAY be written directly on an
  `array` or a `collection` and then constrain each item or each dynamic entry
  rather than the container. `minlength` and `maxlength` are not in the subset;
  on a container they bound its member count.
  [Per-Member Value Constraints](#per-member-value-constraints) is
  authoritative.

- **Local check** and **effective check**. An applicability or exclusivity check
  that reads one definition only, versus one that reads the composed view
  contributed by `allof` components, alternatives, or branches. Checks are local
  unless a rule explicitly says *effective*, and
  [Local and Effective Checks](#local-and-effective-checks) enumerates every
  effective one.

- **Assertion**, **annotation**, and **applicator**. An *assertion* is a schema
  property a document value must satisfy for the node to be valid. An
  *annotation* never decides validity; `description`, `default`, and `deprecated`
  are the annotations, as defined under [Annotations](#annotations). An
  *applicator* applies other definitions to the same node without selecting its
  type; `allof` is the only applicator in version 1.0, as described under
  [Conjunctive Composition](#conjunctive-composition---allof).

- **Alternative**. One entry of a `oneof` or `anyof` array — a candidate type the
  value MAY validate against. See
  [Alternative Types](#alternative-types---oneof-and-anyof). Distinct from
  *branch*.

- **Branch**. One of the two named table-like definitions selected by an
  `if`/`then`/`else` conditional: `then` when the condition holds, `else`
  otherwise. See
  [Conditional Selection](#conditional-selection---if-then-and-else). Only the
  selected branch is applied. Distinct from *alternative*: a branch belongs to a
  conditional, an alternative belongs to a union.

- **Fixed child**. A child that a definition names statically, as opposed to a
  dynamically keyed **collection entry**. The fixed children of a definition are
  its own nested child definitions — *including* those written through the
  reserved `children` namespace — plus those contributed by `allof` components
  and by the selected alternative or branch. Entries under `children` **are**
  fixed children: `children` is a purely syntactic escape for target keys whose
  names collide with schema property names, not a different kind of child, and
  both spellings denote the same target key and validate identically (see
  [Quoted and Special Keys](#quoted-and-special-keys)). The **operand** of a
  sibling presence rule and of a conditional `key` is a fixed child's target key
  name, never the literal string `children`. Which fixed children count for which
  rule is governed by the two sets below.

- **Determinate fixed-child set**. The fixed children a definition is known to
  have *whatever* document value is later validated against it, computed at
  schema-load time without reference to any document. `oneof`/`anyof`
  alternatives and `if`/`then`/`else` branches contribute nothing to it. It is
  the set every schema-load rule reads: sibling-rule operand resolution,
  `exactlyone` applicability, and the collection `itemtype` requirement.
  [Determinate Fixed-Child Set](#determinate-fixed-child-set) is authoritative.

- **Effective closure set**. The fixed children in force for one particular
  document node, computed at validation time: the determinate fixed-child set of
  the node's definition plus the fixed children of whichever alternative or
  branch was selected for that node. It is the set that unknown-key rejection,
  requiredness, and per-child value validation read, and the set that decides
  whether a table is open or closed. [Effective Closure Set](#effective-closure-set)
  is authoritative. The two sets MUST NOT be conflated: a schema-load rule MUST
  read the determinate set, and unknown-key rejection MUST read the effective
  closure set.

- **Effective definition**. The single merged definition `allof` produces by
  combining the local definition with every component before any value is
  validated; the document value is validated against it as a whole.
  [The Effective Definition](#the-effective-definition) is authoritative.

### Document-side terms

- **Key**. A decoded TOML key of the parsed document — the identifier of a table
  entry or the name of a top-level key. Keys are compared as decoded values, not
  by lexical spelling (see [Parsed Value Equality](#parsed-value-equality)). A
  **direct child key** is a key one level below the table currently being
  validated.

- **TOML kind** (also **parsed TOML kind**). The kind of an actual parsed TOML
  value: a scalar of a specific type (string, integer, float, boolean, or one of
  the temporal types), an array, or a table. `collection` is not a TOML kind; it
  is a schema-level refinement of the table kind (see
  [Container Types](#container-types)). Validation requires the parsed value's
  TOML kind to match the coarse category of the governing definition's *effective
  type* before any assertion is applied, as required by the kind check under
  [Keyword Evaluation Order](#keyword-evaluation-order). "TOML kind" is a
  document-side term and MUST NOT be substituted for "effective type".

- **Node** (also **document node**). A value in the parsed document that a
  definition governs — a present scalar, array, or table value at some path.
  Validation is expressed as applying a definition to a node;
  [The Validation Contract](#the-validation-contract) defines the
  `validate(node, definition)` operation over this term. A node is always
  present: a position where no value exists is a *slot*, not a node.

- **Slot**. A position a definition governs, which MAY be absent. A slot is
  filled by a node when the corresponding value is present in the document and is
  empty when it is absent. This distinction is what makes requiredness and
  [`optional`](#optionality---optional) statable: a required slot MUST be filled;
  an optional slot MAY be empty, and an annotation such as a `default` attaches to
  the slot even when no node fills it. Every node occupies a slot; not every slot
  holds a node.

- **Collection entry** / **dynamic entry**. A document key of a `collection` node
  that is not a fixed child; its name is constrained by `keypattern` and its value
  by `itemtype` rather than by a named child definition (see
  [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys)).
  A collection entry is never a sibling-rule operand.

- **Open table** / **closed table**. A document table node whose governing
  definition contributes no fixed child (open: any keys accepted, contents
  unvalidated) versus one that contributes at least one (closed: every key MUST
  be a fixed child). Openness is decided from the node's effective closure set;
  the authoritative rule is under [Tables](#tables).

- **Instance path** and **schema path**. The serialized location of a document
  node and of a schema location, respectively. Their grammars are defined under
  [Instance Path](#instance-path) and [Schema Path](#schema-path).

### Deprecated near-synonym mapping

Some prose written before this section was added uses a near-synonym for one of
the terms above. A later editorial pass SHOULD replace each deprecated spelling
with its preferred term. Until then, the two spellings denote the same concept,
and the preferred term is the one to use in new text.

| Deprecated / conflated spelling | Preferred term | Notes |
| --- | --- | --- |
| schema node, current schema node | definition (current definition) | "node" is reserved for the document side |
| effective kind, effective TOML kind | effective type | one concept, three spellings; keep "effective type" |
| branch (of a `oneof`/`anyof`) | alternative | "branch" is reserved for `if`/`then`/`else` |
| property (of a document table) | key (or child) | "property" is reserved for a schema keyword |
| element (used for any definition) | definition | "element" is reserved for a direct child of `[elements]` |
| schema type (used for the resolved type) | effective type | "schema type" is the *written* selected type only |
| TOML kind (used for a definition's resolved type) | effective type | "TOML kind" is the parsed value's kind only |
| component (bare, meaning an `allof` participant) | participant / `allof` component | see [Merging by TOML Kind](#merging-by-toml-kind) |

## Table of Contents

- [Conformance Terminology](#conformance-terminology)
- [Terminology](#terminology)
  - [Schema-side terms](#schema-side-terms)
  - [Document-side terms](#document-side-terms)
  - [Deprecated near-synonym mapping](#deprecated-near-synonym-mapping)
- [First Glance](#first-glance)
  - [TOML example](#toml-example)
  - [TOML Schema example](#toml-schema-example)
- [TOML Language Version](#toml-language-version)
- [Schema Structure Reference](#schema-structure-reference)
  - [Top-level Structure Conditions](#top-level-structure-conditions)
- [Metadata Table - `[toml-schema]`](#metadata-table---toml-schema)
  - [Supported Properties](#supported-properties)
  - [Schema Versioning](#schema-versioning)
- [Elements table - `[elements]`](#elements-table---elements)
- [Types table - `[types]`](#types-table---types)
  - [Type Reference Restrictions](#type-reference-restrictions)
  - [Schema Definition Properties](#schema-definition-properties)
    - [Local and Effective Checks](#local-and-effective-checks)
  - [Quoted and Special Keys](#quoted-and-special-keys)
  - [Scalar and Unconstrained Built-in Types](#scalar-and-unconstrained-built-in-types)
    - [Allowed Values - `allowedvalues`](#allowed-values---allowedvalues)
    - [String Format - `format`](#string-format---format)
  - [Minimum Value / Maximum Value - `min` and `max`](#minimum-value--maximum-value---min-and-max)
  - [Length - `minlength` and `maxlength`](#length---minlength-and-maxlength)
  - [Container Types](#container-types)
    - [Tables](#tables)
    - [Arrays](#arrays)
      - [Observations on Conditions to Arrays](#observations-on-conditions-to-arrays)
      - [Array Item Schemas and Arrays of Tables](#array-item-schemas-and-arrays-of-tables)
      - [Tuple / Positional Array Validation - `items`](#tuple--positional-array-validation---items)
      - [Array Uniqueness - `uniqueitems`](#array-uniqueness---uniqueitems)
    - [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys)
    - [Per-Member Value Constraints](#per-member-value-constraints)
  - [Type Reference](#type-reference)
  - [Conjunctive Composition - `allof`](#conjunctive-composition---allof)
    - [Composition Supplying the Local Skeleton](#composition-supplying-the-local-skeleton)
    - [The Effective Definition](#the-effective-definition)
    - [Merging by TOML Kind](#merging-by-toml-kind)
    - [Determinate Fixed-Child Set](#determinate-fixed-child-set)
    - [Effective Closure Set](#effective-closure-set)
    - [Composition Examples](#composition-examples)
  - [Alternative Types - `oneof` and `anyof`](#alternative-types---oneof-and-anyof)
  - [Conditional Selection - `if`, `then`, and `else`](#conditional-selection---if-then-and-else)
    - [The discriminator key and closed branches](#the-discriminator-key-and-closed-branches)
  - [Sibling Presence Rules](#sibling-presence-rules)
    - [Dependencies - `dependentrequired`](#dependencies---dependentrequired)
    - [Mutual Exclusion - `mutuallyexclusive`](#mutual-exclusion---mutuallyexclusive)
    - [Exactly One - `exactlyone`](#exactly-one---exactlyone)
  - [Annotations](#annotations)
  - [Description - `description`](#description---description)
  - [Default - `default`](#default---default)
  - [Deprecation - `deprecated`](#deprecation---deprecated)
  - [Optionality - `optional`](#optionality---optional)
  - [Pattern - `pattern`](#pattern---pattern)
  - [Key Pattern - `keypattern`](#key-pattern---keypattern)
- [Validation and Data Model](#validation-and-data-model)
  - [Parsed Value Equality](#parsed-value-equality)
  - [Expressiveness and Validation Scope](#expressiveness-and-validation-scope)
- [Evaluation](#evaluation)
  - [Evaluation Phases](#evaluation-phases)
    - [Schema-Load Phase](#schema-load-phase)
    - [Document-Validation Phase](#document-validation-phase)
  - [Reference Resolution](#reference-resolution)
    - [Resolution Algorithm](#resolution-algorithm)
    - [Built-in Names Are Reserved](#built-in-names-are-reserved)
  - [The Reference Graph](#the-reference-graph)
    - [Consuming and Non-Consuming Edges](#consuming-and-non-consuming-edges)
    - [Cycle Legality](#cycle-legality)
  - [The Validation Contract](#the-validation-contract)
    - [Results](#results)
    - [The Unit of Validation](#the-unit-of-validation)
    - [Slot Evaluation](#slot-evaluation)
    - [Keyword Evaluation Order](#keyword-evaluation-order)
    - [Error Reporting Completeness](#error-reporting-completeness)
    - [Combining Results](#combining-results)
  - [Alternative and Branch Commit and Discard](#alternative-and-branch-commit-and-discard)
- [Diagnostics](#diagnostics)
  - [Phases](#phases)
  - [Diagnostic Record](#diagnostic-record)
  - [Severity](#severity)
  - [Instance Path](#instance-path)
  - [Schema Path](#schema-path)
  - [Aggregation, Ordering, and Branch Diagnostics](#aggregation-ordering-and-branch-diagnostics)
  - [Extensibility](#extensibility)
  - [Command-Line Exit Status](#command-line-exit-status)
  - [Code Registry](#code-registry)
    - [Discovery codes](#discovery-codes)
    - [Schema-load codes](#schema-load-codes)
    - [Validation codes](#validation-codes)
  - [Informative examples](#informative-examples)
- [Schema Self-Validation](#schema-self-validation)
- [Security Considerations](#security-considerations)
  - [Schema Discovery and Retrieval](#schema-discovery-and-retrieval)
  - [Resource Limits](#resource-limits)
  - [Regular-Expression Safety](#regular-expression-safety)
  - [Safe Failure](#safe-failure)
- [Filename Extension](#filename-extension)
- [MIME Type](#mime-type)
- [TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema)

## First Glance

*This section is informative. It illustrates the language through a worked pair
of documents; the normative rules are stated in the sections that follow.*

### TOML example
Let's look at the TOML example displayed on the front page of [toml.io](https://toml.io/en/):

```toml
# This is a TOML document

title = "TOML Example"

[owner]
name = "Tom Preston-Werner"
dob = 1979-05-27T07:32:00-08:00

[database]
enabled = true
ports = [ 8000, 8001, 8002 ]
data = [ ["delta", "phi"], [3.14] ]
temp_targets = { cpu = 79.5, case = 72.0 }

[servers]

[servers.alpha]
ip = "10.0.0.1"
role = "frontend"

[servers.beta]
ip = "10.0.0.2"
role = "backend"
```

### TOML Schema example

Example of a TOML Schema that validates the TOML document above:

```toml
# This is a TOML Schema document
[toml-schema]
version = "1.0.0"

[types.serverType]
type="table"

    [types.serverType.ip]
    type="string"
    format="ipv4"
    [types.serverType.role]
    type="string"

[elements.title]
type="string"

[elements.owner]
type="table"
    [elements.owner.name]
    type="string"
    [elements.owner.dob]
    type="offset-date-time"

[elements.database]
type="table"

    [elements.database.enabled]
    type = "boolean"
    [elements.database.ports]
    type = "array"
    itemtype = "integer"
    [elements.database.data]
    type = "array"
    itemtype = "array"
    [elements.database.temp_targets]
    type = "table"

[elements.servers]
type="collection"
itemtype = "types.serverType"
minlength = 1
```

## TOML Language Version

This specification is defined against [TOML 1.0.0](https://toml.io/en/v1.0.0).
That revision fixes both the grammar a conforming parser accepts and the logical
value model — the TOML kinds `string`, `integer`, `float`, `boolean`, offset
date-time, local date-time, local date, local time, array, and table — that every
rule in this document is written against.

- A TOML Schema document MUST be a well-formed TOML 1.0.0 document. Schema
  loaders MUST reject a schema document that is not.
- A TOML document being validated MUST be parsed as TOML 1.0.0 before validation
  begins. Parsing precedes validation: a document that is not well-formed TOML
  never reaches a validator, and its parse failure is a parse error rather than
  a validation diagnostic.

This baseline is a property of the language, not of an individual schema. No
schema property selects a TOML version, and a schema document cannot request a
different one.

A TOML parser MAY accept input beyond TOML 1.0.0, whether from a later TOML
revision — multi-line inline tables, trailing commas in inline tables,
additional string escapes, or omitted seconds in date-times, for example — or
from a vendor extension. Such a parser MUST NOT silently change validation
outcomes. An implementation built on one:

- MUST NOT report a schema document or a validated document as conforming to
  TOML Schema 1.0 when the document parses only because of an extension;
- MUST NOT let an extension change the logical value produced for input that is
  well-formed TOML 1.0.0, because every validation rule in this specification is
  evaluated against that logical value; and
- MUST document the extended profile it accepts and SHOULD provide a mode that
  restricts parsing to TOML 1.0.0.

An implementation that cannot restrict its parser MUST treat acceptance beyond
TOML 1.0.0 as an implementation extension and MUST report it, so that a schema
or document that depends on it is never mistaken for a portable one. Conformance
suites MUST use only TOML 1.0.0 syntax.

**This is not the schema language version.** The TOML version pinned here and
the TOML Schema language version described under
[Schema Versioning](#schema-versioning) are different numbers with different
meanings, and conflating them is a misreading this specification explicitly
rejects. `[toml-schema].version` states which revision of the *schema
vocabulary* — the properties, built-in type names, and validation rules defined
by this document — a schema document is written against. This section states
which revision of *TOML itself* both the schema document and the validated
document are parsed as. The two version numbers move independently: a schema
document that declares `version = "1.0.0"` declares TOML Schema 1.0.0, not
TOML 1.0.0, and a future TOML Schema version would not by itself change the
pinned TOML version.

## Schema Structure Reference

A TOML Schema file has the following structure:

```toml
# Metadata
[toml-schema]

# Types
[types]

# Elements
[elements]
```

### Top-level Structure Conditions

 - `[toml-schema]`: table with information and metadata of the schema.
   - **REQUIRED**
 - `[types]`: table with definitions of types to be reused in elements.
   - **OPTIONAL**
 - `[elements]`: table with the overall structure of the TOML document, its tables, properties, and conditions.
   - **REQUIRED**

Any other top-level table or key-value pair MUST NOT appear in a TOML Schema document.

## Metadata Table - `[toml-schema]`

This table is reserved for metadata regarding the TOML Schema itself.

```toml
[toml-schema]
version = "1.0.0"
# custom = "value" # *NOT allowed

[toml-schema.meta]
<any> = <value> # allowed
...

[toml-schema.meta.subtable] # allowed

# [toml-schema.custom] # *NOT allowed
...
```

### Supported Properties

 - `version`: the TOML Schema language version used by this schema document. **Type:** string.
   - **REQUIRED**.
 - `meta`: subtable reserved for any custom user-provided metadata. **Type:** table.
   - **OPTIONAL**.

Custom properties and tables MUST NOT appear directly under `toml-schema`; they
MAY appear only inside the `toml-schema.meta` table.

### Schema Versioning

This section is about the TOML Schema **language** version, which is unrelated
to the TOML language version pinned under
[TOML Language Version](#toml-language-version). A schema document declares the
schema vocabulary it uses; it never declares which revision of TOML it is
written in.

TOML Schema follows the same version-numbering policy as the TOML specification: schema language versions use [Semantic Versioning](https://semver.org/).

The `version` property MUST be a string containing a complete Semantic
Versioning 2.0.0 value. The `MAJOR.MINOR.PATCH` core is required; a valid
pre-release suffix and build metadata are optional. The current TOML Schema
version is `1.0.0`.

```toml
[toml-schema]
version = "1.0.0"
```

Schema loaders MUST reject schema documents whose `version` is missing, is not a string, or is not a valid SemVer value. Shorthand values such as `"1"` and `"1.0"` are invalid.

An implementation that supports TOML Schema version `MAJOR.MINOR.PATCH` MUST accept schema documents with the same major version and a minor version less than or equal to the implementation's supported minor version. Patch versions, pre-release identifiers, and build metadata do not add schema-language features and do not affect compatibility. Schema loaders MUST reject schema documents with an unsupported major version or a greater minor version. Support for schema documents from an earlier major version is implementation-defined; an implementation MUST NOT treat support for a later major version as implicit support for an earlier one.

That compatibility rule assumes a non-zero major version. Semantic Versioning
2.0.0 gives `0.y.z` no stability guarantee and permits a minor increment to
change the language incompatibly, so the rule's "same major version" test would
not be sound there. This specification therefore defines no major-version-zero
language version: the first TOML Schema language version is `1.0.0`. A `0.y.z`
value is well-formed Semantic Versioning but is not a TOML Schema language
version, and a schema loader MUST reject it as an unsupported major version.

## Elements table - `[elements]`

The `[elements]` table is the root schema for the TOML document being validated. Schema authors use it to describe the application data that may appear at the top level of the TOML document.

Each direct child of `[elements]` defines one top-level TOML key. Nested children define the structure below that key, such as fields inside a table or item definitions inside arrays and collections.

The root is closed: every top-level application-data key MUST be defined by a direct child of `[elements]`. Validators MUST reject any other top-level application-data key. This rule applies even when `[elements]` has no children, so an empty `[elements]` table accepts no application data.

The reserved root `[toml-schema]` metadata table is the only exception. When `[elements.toml-schema]` is omitted, validators ignore that table during application-data validation as described in [TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema). Therefore, a document validated by an empty `[elements]` table may contain only the reserved `[toml-schema]` table and no application data.

This root behavior differs from a nested property declared as `type = "table"` with no child definitions. Such a nested table is intentionally open-ended as described in [Tables](#tables); an empty `[elements]` table is not an implicit allow-anything schema.

For example, this schema:

```toml
[elements.title]
type = "string"

[elements.database]
type = "table"

    [elements.database.enabled]
    type = "boolean"
```

validates a TOML document shaped like this:

```toml
title = "Example"

[database]
enabled = true
```

Use `[elements]` for document-specific keys. Use `[types]` for reusable definitions that can be referenced from `[elements]` or from other reusable types. Elements follow the same structure and validation rules as types, except that elements cannot reference other elements. To reuse conditions and structures, define them under `[types]` and reference them from `[elements]`.

## Types table - `[types]`

The `[types]` table is for use when there is a need for custom, reusable types of structure or properties. A type is referenced in an element or another type with a type reference.

Type references are strings accepted by `type`, `itemtype`, `items`, `oneof`,
`anyof`, `allof`, `then`, and `else`. A type reference may be either:

- a built-in type name such as `"string"`, `"boolean"`, or `"integer"`;
- a named reusable definition from `[types]`, written either as `"types.<typename>"` or `"<typename>"`.

Which references each of those positions accepts, and which recursion each
permits, is stated once under
[Type Reference Restrictions](#type-reference-restrictions).

Each reusable type is a direct child of `[types]`, and its name is the exact
decoded TOML key of that child. A dot in a type name is an ordinary character
when the key is quoted, so `[types."network.endpoint"]` defines the reusable
type named `network.endpoint`; it does not define a nested type hierarchy.
Tables below a direct child define that type's fixed children.

The optional `types.` reference prefix is removed exactly once before lookup.
Consequently, both `"network.endpoint"` and `"types.network.endpoint"` refer
to the direct definition `[types."network.endpoint"]`. To keep those two forms
unambiguous, a reusable type name MUST NOT begin with the literal characters
`types.`. Built-in type names are also reserved and MUST NOT be used as
`[types]` definition names. The reserved names are `any`, `string`, `integer`,
`float`, `boolean`, `offset-date-time`, `local-date-time`, `local-date`,
`local-time`, `array`, `table`, and `collection`.

`type`, `oneof`, `anyof`, and the `if`/`then`/`else` triple are alternative
ways to select the type of the current schema node. A definition MUST declare
at most one selector, and two constructs supply the selection in place of one:

- a definition with nested child definitions MAY omit all selectors and is then
  treated as `type = "table"`; and
- a definition whose only applicator is a non-empty `allof` MAY omit all
  selectors and all nested child definitions, and then takes its effective type
  from that composition. [Composition Supplying the Local
  Skeleton](#composition-supplying-the-local-skeleton) is authoritative for when
  such a definition is valid and for the code a loader reports when it is not.

Schema loaders MUST reject a definition that combines selectors, contains only
part of a conditional triple, or declares no selector, no nested child
definitions, and no `allof`. `type` accepts either a built-in type name or a
named reusable definition from `[types]`. Container member types are selected separately with
`itemtype`: it validates each member of an `array` or each dynamically keyed
value of a `collection`. `itemtype` requires the same definition to declare the
built-in `type = "array"` or `type = "collection"`; it cannot be attached to
another built-in or to a named type reference.

Nested child definitions are valid only when the current node selects the
built-in `table` or `collection` type, or when the node omits a selector and is
therefore an implicit table. Schema loaders MUST reject child definitions attached to
a scalar, `array`, named type reference, `oneof`, `anyof`, or conditional node rather than
silently ignoring them.

```toml
[types]

[types.<typename>]
type = "<type-reference>"
description = "<human-readable description>"
format = "<email|uuid|uri|hostname|ipv4|ipv6>"
itemtype = "<type-reference>"
items = [ "<type-reference>", ... ]
oneof = [ "<type-reference>", ... ]
anyof = [ "<type-reference>", ... ]
if = { key = "<direct-child-name>", equals = <toml-value> }
# or: if = { key = "<direct-child-name>", in = [ <toml-value>, ... ] }
then = "types.<typename>"
else = "types.<typename>"
allof = [ "<type-reference>", ... ]
allowedvalues = [ <array-with-enumeration-of-allowed-values> ]
pattern = "<string-regex-for-string-validation>"
keypattern = "<string-regex-for-collection-key-validation>"
optional = true|false
min = <integer | float | offset-date-time | local-date-time | local-date | local-time>
max = <integer | float | offset-date-time | local-date-time | local-date | local-time>
minlength = <integer>
maxlength = <integer>
uniqueitems = true|false
dependentrequired = { <fixed-child> = [ "<fixed-child>", ... ], ... }
mutuallyexclusive = [ [ "<fixed-child>", "<fixed-child>", ... ], ... ]
exactlyone = [ [ "<fixed-child>", "<fixed-child>", ... ], ... ]
default = <toml-value>
deprecated = true|false
```

### Type Reference Restrictions

This section is the single authority for which references each reference
position accepts. Every other mention of these restrictions in this
specification points here rather than restating them.

| Position | Bare built-in name | Named `[types]` reference | Reference to a pure mixin | Reference edge |
| --- | --- | --- | --- | --- |
| `type` | Any built-in. `collection` only when the effective definition obtains an `itemtype` locally or from a compatible `allof` component | Yes | Yes | Non-consuming |
| `itemtype` | Any built-in except `collection` | Yes | Yes | Consuming |
| `items` | Any built-in except `collection` | Yes | Yes | Consuming |
| `oneof`, `anyof` | Any built-in except `any` and `collection` | Yes | Yes | Non-consuming |
| `allof` | Any built-in except `any` and `collection` | Yes | Yes | Non-consuming |
| `then`, `else` | None; a bare built-in reference is invalid in either | Yes, and both branches MUST resolve to the same effective kind, which MUST be `table` or `collection` | Yes, subject to that same kind requirement | Non-consuming |

The two restricted built-ins are restricted for one reason each:

- `collection` is valid for `type` only when the effective definition obtains
  an `itemtype` locally or from a compatible `allof` component. It MUST NOT be
  used as a bare reference in `itemtype`, `items`, `oneof`, `anyof`, `allof`,
  `then`, or `else`, because those locations cannot supply the collection's dynamic-value
  rule. Schema loaders MUST reject such references at schema-load time.
- `any` is valid for `type`, `itemtype`, and `items`, but it MUST NOT appear
  directly in `oneof`, `anyof`, `allof`, `then`, or `else`. Schema loaders MUST
  reject a direct `any` component at schema-load time.

These restrictions apply to bare built-in references, not to named reusable
definitions. A named definition that declares a complete collection or selects
`type = "any"` remains a valid reference. A
[pure mixin](#composition-supplying-the-local-skeleton) is an ordinary named
definition once its components determine its effective type, so it may be
referenced wherever any other named definition may be, subject to the same kind
requirement the position imposes on a named reference. What a definition may
declare *beside* a named reference is stated under
[Type Reference](#type-reference).

Every named reference used by `type`, `itemtype`, `items`, `oneof`, `anyof`,
`allof`, `then`, or `else`
MUST resolve to a definition in `[types]`. Schema loaders MUST reject unresolved
references at schema-load time, including references in definitions that are
optional or not exercised by the document being validated. The ordered algorithm
that turns a reference string into a built-in type or a reusable definition is
defined under [Reference Resolution](#reference-resolution), which is
authoritative for how the restrictions above are applied. An element MUST NOT
reference another element, as
[Elements table](#elements-table---elements) requires.

Type-selection and composition references MUST be acyclic. A cycle composed of
named `type` aliases, `oneof` alternatives, `anyof` alternatives, conditional
branches, or `allof` components — the positions the table above marks
**non-consuming** — cannot resolve to a concrete definition and
schema loaders MUST reject it at schema-load time. Structural recursion through
table or collection children, array `itemtype`, or tuple `items` — the
**consuming** positions — remains valid
because each recursive step consumes a nested document value.
[Cycle Legality](#cycle-legality) states this classification in terms of the
reference graph and is authoritative for deciding which cycles are legal.

### Schema Definition Properties

The following matrix summarizes where definition properties apply. The
detailed sections below remain authoritative.

| Property | Applicable definition |
| --- | --- |
| `type` | Selects one built-in or named type; at most one selector per definition, per [Types table](#types-table---types) |
| `oneof`, `anyof` | Select the current node from one or more alternatives; at most one selector per definition, per [Types table](#types-table---types) |
| `if`, `then`, `else` | Exhaustively select one of two named table-like definitions from a direct child's parsed value |
| `allof` | Conjunctively applies one or more compatible type references in addition to the local definition; alone, it also supplies an omitted selector, per [Composition Supplying the Local Skeleton](#composition-supplying-the-local-skeleton) |
| `description`, `optional`, `default`, `deprecated` | Any definition, including a named reference or alternative selector |
| `format` | A definition with built-in `type = "string"`; or, as a [per-member constraint](#per-member-value-constraints), a non-tuple `array` or `collection` whose member type is `string` |
| `itemtype` | A definition with built-in `type = "array"` or `type = "collection"` |
| `items` | A definition with built-in `type = "array"`; mutually exclusive with `itemtype`, `minlength`, `maxlength`, and the whole [per-member value-constraint subset](#per-member-value-constraints) (`allowedvalues`, `min`, `max`, `pattern`, `format`) |
| `allowedvalues` | A scalar or unconstrained built-in type; or, as a [per-member constraint](#per-member-value-constraints), a non-tuple `array` or `collection` |
| `pattern` | A definition with built-in `type = "string"`; or, as a [per-member constraint](#per-member-value-constraints), a non-tuple `array` or `collection` whose member type is `string` |
| `keypattern` | A definition with built-in `type = "collection"`; constrains dynamic entry keys, never their values |
| `min`, `max` | A numeric or temporal built-in type; or, as a [per-member constraint](#per-member-value-constraints), a non-tuple `array` or `collection` whose member type resolves to one comparable kind |
| `minlength`, `maxlength` | A definition with built-in `type = "string"`, `type = "array"`, or `type = "collection"`; on a container these always bound the container's own member count and are never per-member |
| `uniqueitems` | A definition with built-in `type = "array"` |
| `dependentrequired`, `mutuallyexclusive`, `exactlyone` | A definition with effective type `table` or `collection` and a non-empty [determinate fixed-child set](#determinate-fixed-child-set) |

Every applicability and exclusivity statement in this matrix is **local** unless
it names the effective type or an effective set, as
[Local and Effective Checks](#local-and-effective-checks) requires.

A named type reference, alternative selector, and conditional selector may
additionally declare only `allof`, `description`, `optional`, `default`, and
`deprecated`.
Kind-specific constraints for the referenced or alternative types belong in
reusable definitions.

The properties named in the matrix above are the complete set of schema
definition properties defined by this version of the language. In full, they
are `type`, `description`, `format`, `itemtype`, `items`, `oneof`, `anyof`,
`if`, `then`, `else`, `allof`, `allowedvalues`, `pattern`, `keypattern`,
`optional`, `min`, `max`, `minlength`, `maxlength`, `uniqueitems`,
`dependentrequired`, `mutuallyexclusive`, `exactlyone`, `default`, and
`deprecated`. The set is closed: a key/value pair written directly inside a
schema definition whose name is not one of those properties is malformed, and
schema loaders MUST reject it at schema-load time rather than ignoring it. A
misspelled property such as `patttern` is therefore an error and never a
silently inert annotation. Applying a recognized property to a definition that
the matrix above and the detailed sections do not permit it on is likewise a
schema-load error. Custom, tool-specific, or experimental keys have no place in
a schema definition; they belong in the `[toml-schema.meta]` table described
under [Supported Properties](#supported-properties).

The set is closed per language version rather than permanently fixed. A future
MINOR version of TOML Schema MAY add properties to it. Because an
implementation MUST reject a schema document whose minor version is greater
than the version it supports, as required by
[Schema Versioning](#schema-versioning), a loader never encounters a property
introduced after the version it implements in a document it accepts. Within the
versions an implementation does accept, the recognized set is exactly the set
defined by this specification, so an unrecognized property name is always an
error and never a forward-compatible extension point.

This closure constrains schema vocabulary only, never the key names a validated
TOML document may contain. As described under
[Quoted and Special Keys](#quoted-and-special-keys), a key/value pair directly
inside a schema definition is a schema property, while a table-header path
segment below that definition is a child definition. A target document key named
`pattern`, `min`, or `deprecated` is described by a child definition of that
name, written through the reserved `children` namespace when the same definition
also uses the property and TOML cannot represent both spellings. Rejecting an
unrecognized property name therefore never restricts the application data a
schema can describe.

#### Local and Effective Checks

Applicability and exclusivity checks are **local** unless a rule in this
specification explicitly says *effective*. This statement is authoritative for
both readings, and the sections that depend on either one point here rather than
restating it.

A **local** check reads one definition only: its own selector, its own key/value
properties, its own nested child definitions, and the definitions its own
references resolve to. It MUST NOT read the properties, fixed children,
`itemtype`, or `keypattern` contributed by an `allof` component, by a `oneof` or
`anyof` alternative, or by a conditional branch.

Locality is what makes these checks decidable one definition at a time, and it
is why an exclusion such as `items` against the
[per-member value-constraint subset](#per-member-value-constraints) binds only
the definition that writes both. An `allof` component MAY contribute a
constraint the local definition could not have written beside `items`. The two
then apply conjunctively, as [Merging by TOML Kind](#merging-by-toml-kind)
requires, and the result is an effective definition that no document value
satisfies rather than a schema-load error. This is not a loophole in the
exclusion: an exclusion states what one definition may write, while composition
states what a value must satisfy, and the two questions have different answers
by design.

The checks that read the effective, composed view instead are exactly the
following, and each says so where it is defined:

1. **Composition compatibility.** Whether the participants of an `allof` agree
   on one effective type, including the rejection of a multi-kind local union
   combined with `allof`. See
   [The Effective Definition](#the-effective-definition).
2. **The effective type of a pure mixin.** A definition whose only applicator is
   `allof` takes its effective type from its components. See
   [Composition Supplying the Local Skeleton](#composition-supplying-the-local-skeleton).
3. **The collection `itemtype` requirement.** A `collection` obtains its
   mandatory dynamic-entry rule locally or from a compatible `allof` component.
   See
   [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys).
4. **Sibling-rule operands and applicability.** `dependentrequired`,
   `mutuallyexclusive`, and `exactlyone` resolve their operands against the
   [determinate fixed-child set](#determinate-fixed-child-set), which includes
   the children contributed by `allof`, and their `table`-or-`collection`
   applicability is decided from the effective type. See
   [Sibling Presence Rules](#sibling-presence-rules).
5. **`default` validity.** A declared `default` is checked against the full
   effective definition. See [Default](#default---default).
6. **Openness, closure, requiredness, and unknown keys.** Whether a table is
   open or closed, which document keys are unknown, which fixed children are
   required, and which definitions validate a present child are all decided from
   the node's [effective closure set](#effective-closure-set). See
   [Tables](#tables).
7. **Conjunctive application of contributed assertions.** Every assertion any
   participant contributes applies to the document value, including an
   `itemtype` or `keypattern` contributed to a collection. See
   [Merging by TOML Kind](#merging-by-toml-kind).

Items 1 through 5 are schema-load checks and read only what is determinate at
schema-load time. Items 6 and 7 are document-validation checks. No other rule in
this specification reads the composed view, and an implementation MUST NOT
extend the effective reading to a check that is not listed here.

### Quoted and Special Keys

Schema child definitions use TOML tables. When a target TOML key is empty or contains characters that TOML requires to be quoted, such as a literal dot, quote that key in the schema table path.

Target keys may have the same names as TOML Schema properties, such as `type`,
`itemtype`, `optional`, or `pattern`. A key/value pair directly inside a schema
definition is a schema property, while a table-header path segment below that
definition is normally a target child definition.

A schema definition with nested child definitions and no explicit selector is an
implicit table, as [Types table](#types-table---types) defines. This lets
schemas describe target keys that would
otherwise share a name with schema properties when the parent does not also use
the property.

TOML itself forbids one table from containing both a value and a subtable with
the same key. When a definition must simultaneously use a schema property and
define a target child with that property's name, place the child definition
under the reserved `children` table. The segment immediately following
`children` is the target key; `children` is not part of the target document
path.

The `children` table is a selective escape hatch, not a general alternative
child syntax. The restriction is categorical rather than per-definition: every
direct entry below `children` MUST be named either `children` or one of the
[schema-definition properties](#schema-definition-properties) listed above, and
schema loaders MUST reject any other name there. A loader does not additionally
require that the surrounding definition actually declare a property of that
name. Ordinary, quoted, dotted, and empty child keys continue to use direct TOML
table paths.

Consequently, when a definition does not declare the property in question, a
child whose target key is a property name has two valid spellings: the direct
table path and the `children` path. Both denote the same target key and validate
identically. Authors SHOULD prefer the direct form and reserve `children` for
definitions in which TOML makes the direct form impossible; a schema generator
MAY instead emit the `children` form uniformly for property-named children. When
a definition does declare that property as a key/value pair, TOML permits only
the `children` form, so exactly one spelling is available.

A table named `children` whose own definition declares a `type`, `oneof`,
`anyof`, or `if` selector property is an ordinary target child definition
rather than the escape namespace. This preserves the direct form for a target
child literally named `children`. A selectorless table child with that name is
written through the escape namespace as
`[elements.parent.children.children]`.

For example, this schema defines a scalar target key named `children` directly:

```toml
[elements.parent]
type = "table"

[elements.parent.children]
type = "string"
```

It validates:

```toml
[parent]
children = "value"
```

The `type` selector makes `[elements.parent.children]` an ordinary child
definition. To define a selectorless target table named `children`, repeat the
name through the escape namespace:

```toml
[elements.parent]
type = "table"

[elements.parent.children.children]

[elements.parent.children.children.name]
type = "string"
```

It validates:

```toml
[parent.children]
name = "value"
```

The first `children` segment is the escape namespace. The second is the literal
target key, and the selectorless definition is inferred as `type = "table"`.

Example TOML document:

```toml
[plugin]
type = "npm"
name = "example"
```

Schema:

```toml
[elements.plugin]
type = "table"

[elements.plugin.children.type]
type = "string"
allowedvalues = [ "npm", "local" ]

[elements.plugin.name]
type = "string"
```

Here `elements.plugin.type = "table"` selects the parent type, while
`[elements.plugin.children.type]` describes the target key `plugin.type`.
Without the `children` segment, TOML would require `type` to be both a string
and a table at the same path.

### Scalar and Unconstrained Built-in Types

The unconstrained built-in type is:

- Any: `any`

The scalar built-in types are:

- String: `string`
- Integer: `integer`
- Float: `float`
- Boolean: `boolean`
- Offset Date-Time: `offset-date-time`
- Local Date-Time: `local-date-time`
- Local Date: `local-date`
- Local Time: `local-time`

#### Allowed Values - `allowedvalues`

`allowedvalues` provides an enumeration for a scalar or unconstrained built-in
type. On an `array` or a `collection` it is instead a
[per-member constraint](#per-member-value-constraints) and enumerates the values
permitted for each item or each dynamic entry, as also described
under [Observations on Conditions to Arrays](#observations-on-conditions-to-arrays).
It is invalid on a `table`.

The `allowedvalues` array MUST contain at least one entry. Every entry on a
definition that is neither an `array` nor a `collection` MUST have the TOML kind
selected by that definition;
`type = "any"` is the exception and permits entries of any TOML kind. Numeric
equality between integers and floats does not make their TOML kinds
interchangeable for this schema-load check. A malformed enumeration MUST be
rejected at schema-load time.

For a definition that is neither an `array` nor a `collection`, when
`allowedvalues` is combined with `pattern`, `format`,
`min`, `max`, `minlength`, or `maxlength` on the same definition, every entry in
`allowedvalues` MUST satisfy every applicable constraint. A schema containing an
entry that violates one of those constraints is malformed, and schema loaders
MUST reject it at schema-load time. This is a consistency check on the
enumeration itself; it describes nothing about how a document value is
validated. For offset date-times, this boundary check uses instant
ordering even though subsequent `allowedvalues` membership uses parsed-value
equality; equivalent instants with different retained local fields or offsets
therefore compare equal for a boundary but remain distinct enumeration values.

After a schema with `allowedvalues` has been loaded successfully, each document
value governed by that definition — each item or dynamic-entry value, for an
`array` or `collection` definition —
is evaluated in the following order:

1. The value's parsed TOML kind MUST be the kind the definition selects for it,
   through `type` or, for container members, through `itemtype`. A kind mismatch
   is a
   validation error regardless of `allowedvalues`, and membership in the
   enumeration never satisfies the type check. For example, a definition with
   `type = "integer"` and `allowedvalues = [ 80, 443 ]` rejects the document
   value `80.0` even though [Parsed Value Equality](#parsed-value-equality)
   makes `80.0` equal to `80`. The unconstrained `any` selects no kind and
   imposes no such restriction.
2. Every other assertion that applies to the value is evaluated, including the
   assertions declared on the definition itself and those contributed by `allof`
   components. Validators MUST NOT skip an assertion on the grounds that the
   enumeration was already checked while loading the schema: that schema-load
   check covers only the definition's own constraints listed above, and a
   composed constraint does not participate in it.
3. The value MUST be a member of `allowedvalues` according to
   [Parsed Value Equality](#parsed-value-equality).

The value is valid for that definition only when all three steps succeed.

Example:
```toml
[types.colorType]
type="string"
allowedvalues=[ "red", "black", "blue" ]
```

#### String Format - `format`

`format` applies a standardized semantic assertion to a parsed TOML string.
It MUST be one of the following case-sensitive names:

| Format | Required syntax |
| --- | --- |
| `email` | An ASCII SMTP `Mailbox` as defined by [RFC 5321, section 4.1.2](https://www.rfc-editor.org/rfc/rfc5321#section-4.1.2), with the length limits from section 4.5.3.1 |
| `uuid` | The hexadecimal-and-dash UUID representation defined by [RFC 9562, section 4](https://www.rfc-editor.org/rfc/rfc9562#section-4) |
| `uri` | An absolute `URI` as defined by [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986), including a scheme |
| `hostname` | The preferred ASCII host-name syntax from [RFC 1123, section 2.1](https://www.rfc-editor.org/rfc/rfc1123#section-2.1) |
| `ipv4` | IPv4 dotted-decimal notation |
| `ipv6` | IPv6 text representation as defined by [RFC 4291, section 2.2](https://www.rfc-editor.org/rfc/rfc4291#section-2.2) |

The formats use the following portable rules:

- `email` accepts the RFC 5321 dot-string and quoted-string local-part forms.
  It is not an internationalized mailbox format: every character MUST be ASCII.
  The local-part MUST be at most 64 octets and the complete mailbox MUST be at
  most 254 octets. The domain MUST be an RFC 1123 host name or an RFC 5321
  `address-literal` as defined by RFC 5321, including IPv4, IPv6, and registered
  General-address-literal forms. Validators MUST parse these structures and
  MUST NOT substitute a simplified `text@text` regular expression.
- `uuid` consists of exactly 32 hexadecimal digits, case-insensitive, displayed
  in groups of 8, 4, 4, 4, and 12 digits separated by hyphens.
- `uri` MUST match the RFC 3986 `URI` production rather than `relative-ref`.
  It is ASCII; non-ASCII components MUST be percent-encoded. Every percent
  escape MUST contain exactly two hexadecimal digits.
- `hostname` is ASCII and case-insensitive. After excluding one optional final
  root dot, its total length MUST be from 1 through 253 characters. Each
  dot-separated label MUST contain 1 through 63 ASCII letters, digits, or
  hyphens, MUST begin and end with a letter or digit, and MAY be entirely
  numeric.
- `ipv4` contains exactly four decimal octets from 0 through 255 separated by
  dots. An octet MUST NOT contain a leading zero unless the octet is exactly
  `0`.
- `ipv6` accepts the compressed and IPv4-embedded forms defined by RFC 4291.
  It does not accept a URI host's brackets or a zone identifier. An embedded
  IPv4 suffix follows the `ipv4` rules above.

`format` is valid on a definition whose selected type is the built-in
`string`, and, as a [per-member constraint](#per-member-value-constraints), on a
non-tuple `array` or `collection` whose effective member type is the built-in
`string`. It cannot be attached to another built-in type, an alternative
selector, or a named type reference, as
[Schema Definition Properties](#schema-definition-properties) requires. A schema
loader MUST reject an unsupported
format name or incompatible use at schema-load time rather than ignoring it.

When `format` is combined with `allowedvalues`, every allowed string MUST
satisfy the format at schema-load time. `format` is independent of `pattern`,
`minlength`, and `maxlength`; a document string MUST satisfy every declared
constraint.

```toml
[elements.contact]
type = "string"
format = "email"

[elements.endpoint]
type = "string"
format = "uri"

[elements.instance-id]
type = "string"
format = "uuid"
```

### Minimum Value / Maximum Value - `min` and `max`

These properties define inclusive value ranges. The **comparable kinds** are:

 - `float`
 - `integer`
 - date and/or time types: `offset-date-time`, `local-date-time`, `local-date`, and `local-time`

`min` and `max` MAY be declared only on a definition whose type resolves to
exactly one comparable kind, and on an `array` or a `collection` whose members
do, as the next paragraph describes.

On an `array` or a `collection`, `min` and `max` are
[per-member constraints](#per-member-value-constraints) and apply to each item
or each dynamic entry. That section is authoritative for the per-member reading,
for how the member type is resolved through `itemtype` and through the
alternatives of a referenced `oneof` or `anyof`, and for the schema-load
rejection of a member type that is indeterminate or of the wrong kind. The
interaction between array range
boundaries and `allowedvalues` is defined under
[Observations on Conditions to Arrays](#observations-on-conditions-to-arrays).

A `min` or `max` boundary MUST be a TOML value that is comparable with the schema type: `integer` or `float` boundaries for `integer` and `float` values, and matching temporal boundaries for temporal values.

`nan`, `+nan`, and `-nan` are not valid `min` or `max` boundaries because NaN is unordered. `inf`, `+inf`, and `-inf` are valid float boundaries, but they are not valid boundaries on a definition whose comparable kind is `integer`; an infinite boundary has no integer counterpart and constrains no integer value, so schema loaders MUST reject it there at schema-load time.

Date/time boundaries compare only against values of the same TOML temporal type. For example, an `offset-date-time` boundary applies to `offset-date-time` values, not to `local-date-time` values.

Numeric ranges use mathematical ordering after TOML parsing. Integer-to-integer
ordering MUST remain exact across the full signed 64-bit range. Mixed
integer/float ordering MUST compare the exact integer with the parsed binary
floating-point value without first rounding the integer to that floating-point
format. Positive and negative zero have the same position. A document NaN is
unordered and never satisfies a range constraint.

Offset date-times are ordered by the instant they identify after applying their
offset; representations of the same instant compare equal even when their local
fields and offsets differ. Local date-times, local dates, and local times are
ordered lexicographically by their parsed fields, from the largest component to
the smallest, including fractional seconds. No timezone or daylight-saving
conversion is applied to a local temporal value.

When both `min` and `max` are present, `min` MUST be less than or equal to `max`
under the same ordering this section defines for validation: mathematical
ordering for numeric boundaries, instant ordering for `offset-date-time`
boundaries, and parsed-field ordering for `local-date-time`, `local-date`, and
`local-time` boundaries. A schema violating that rule is malformed and schema
loaders MUST reject it at schema-load time. The comparison is always defined
because the unordered boundary values excluded above are not valid boundaries in
the first place.

### Length - `minlength` and `maxlength`

These properties MUST be used only to define the allowed length of a `string`,
an `array`, or a `collection`.

For `string` values, length is counted as the number of Unicode scalar values after TOML parsing and escape processing. It is not the number of UTF-8 bytes, UTF-16 code units, or user-perceived grapheme clusters. For example, `"\U0001F600"` has length 1, while `"e\u0301"` has length 2 because it is composed of two Unicode scalar values.

For an `array`, length is its number of items. For a `collection`, length is
the number of dynamic entries to which `itemtype` applies; fixed child
definitions are excluded from the count.

Both `minlength` and `maxlength` MUST be integers `>= 0`. When both are present, `minlength` MUST be less than or equal to `maxlength`. A schema violating either rule is malformed and schema loaders MUST reject it at schema-load time.

`minlength` and `maxlength` are valid only on definitions whose selected type is
the built-in `string`, `array`, or `collection`. They cannot be attached to
another built-in type, an alternative selector, or a named type reference, as
[Schema Definition Properties](#schema-definition-properties) requires.
Schema loaders MUST reject an incompatible length constraint at schema-load time rather
than silently ignoring it.

On an `array` or a `collection` these two properties always bound the
container's own member count. They are deliberately excluded from the
[per-member value-constraint subset](#per-member-value-constraints), which
explains why, and a per-member length bound is written on the definition the
container's `itemtype` reaches.

### Container Types

- Array: `array`
- Table: `table`
- Collection: `collection`

`array` and `table` correspond to parsed TOML value kinds. `collection` is a
schema-level specialization of `table` for dynamically named entries. TOML
inline tables parse as table values and therefore do not need a separate
built-in type.

#### Tables

A definition whose effective type is `table` matches a parsed TOML table value.
Table headers and inline tables produce the same value kind and are validated
identically.

If a schema definition has nested child definitions but does not declare a
selector, it is an implicit table, as
[Types table](#types-table---types) defines.

The **fixed children** of a table, for the purpose of the rules below, are its
own nested child definitions together with the children contributed by every
`allof` component and by the union alternative or conditional branch selected
for the document value being validated. That set is the table's
[effective closure set](#effective-closure-set). Sibling presence rules resolve
their operands against a narrower, schema-load-time set instead; see
[Determinate Fixed-Child Set](#determinate-fixed-child-set).

A table with at least one fixed child is **closed**. Validators MUST apply all
of the following rules to it:

 - every fixed child that is not optional MUST be present in the document table;
 - every present fixed child's value MUST validate against its definition; and
 - every document key that is not a fixed child MUST be reported as an
   unknown-key error.

The third rule is what makes a closed table reject misspelled and undeclared
keys. It is the same rule the root applies under
[Elements table](#elements-table---elements).

A table with no fixed children is **open**. Validators MUST accept any TOML
table value without validating its contents, including its keys. This is useful
for representing custom data payloads. Openness is a property of the effective
closure set, so a table is open only when neither the local definition, nor any
`allof` component, nor the selected alternative or branch contributes a fixed
child. Openness and unknown-key rejection are two of the checks that read the
effective rather than the local view; the complete list is under
[Local and Effective Checks](#local-and-effective-checks).

An open table is not the same as an empty root `[elements]` table. An open table
accepts any keys; an empty `[elements]` table accepts no application data at
all, as described under [Elements table](#elements-table---elements).

#### Arrays

Arrays can be defined using the following properties:

 - `itemtype`: a type reference used to validate every item in a homogeneous array.
 - `items`: ordered type references for tuple-style positional validation with fixed arity.
 - `minlength`: the minimum length of the array (e.g. no less than 2 elements).
 - `maxlength`: the maximum length of the array (e.g. no more than 2 elements).
 - `min`: the minimum value allowed for each comparable array item (e.g. 80).
 - `max`: the maximum value allowed for each comparable array item (e.g. 8080).
 - `allowedvalues`: enumeration of the values permitted for each item.
 - `pattern`: a regular expression each string item must match.
 - `format`: a standardized semantic format each string item must satisfy.
 - `uniqueitems`: whether every parsed array item must be unique.

`min`, `max`, `allowedvalues`, `pattern`, and `format` are the
[per-member value-constraint subset](#per-member-value-constraints); they
constrain each item rather than the array, and a `collection` accepts the same
five with the same meaning. `minlength` and `maxlength` bound the array itself.

Example for schema definition:

```toml
[elements.colors]
type="array"
itemtype="string"
```

Example of TOML file:

```toml
colors=[ "red", "yellow", "green" ]
```

##### Observations on Conditions to Arrays

The `min` and `max` conditions set an inclusive range for every array item.
[Per-Member Value Constraints](#per-member-value-constraints) is authoritative
for that per-item reading, for the shared subset `min`, `max`, `allowedvalues`,
`pattern`, and `format`, for how a named `itemtype` and its alternatives are
resolved, and for the equivalence of an inline constraint to the same constraint
written on the `itemtype` definition. The comparable kinds and the ordering
rules used for numeric and temporal items are defined under
[Minimum Value / Maximum Value](#minimum-value--maximum-value---min-and-max).

When `allowedvalues` is present on an array, every array item MUST be a member
of that enumeration. The enumeration does not have to be sorted. If `min` or
`max` is also present, every enumerated value MUST satisfy the applicable
inclusive boundary, and a schema loader MUST reject an enumerated value that
violates one; an enumerated value need not equal either boundary.

When the array declares `itemtype`, every enumerated value MUST have a TOML
kind permitted by the effective item type, as
[Per-Member Value Constraints](#per-member-value-constraints) requires. An
`itemtype` that permits `any` permits enumeration entries of any TOML kind. This
schema-load check verifies the permitted TOML kind; constraints inside a named
item definition still apply normally when a document array is validated.

`minlength` and `maxlength` constrain the document array's item count, not the
number of entries in `allowedvalues`, and never the length of an individual
item; see [Per-Member Value Constraints](#per-member-value-constraints).

If neither `itemtype` nor `items` is defined, array items default to `any`, so
items of different TOML types may be mixed.

If `type = "array"` and `itemtype = "array"`, every item MUST be an array. The
contents of those nested arrays are unconstrained; only omitting `itemtype`
permits non-array and array items to be mixed in the outer array.

##### Array Item Schemas and Arrays of Tables

`itemtype` accepts the references
[Type Reference Restrictions](#type-reference-restrictions) permits at that
position. Use a
built-in reference such as `itemtype = "string"` for a homogeneous scalar
array, or a reusable schema definition when members require constraints or
structure. A reusable table definition is required for TOML arrays of tables
and arrays of inline tables because both parse as arrays whose items are table
values. The same keyword selects the type of each dynamic value in a
`collection`.

Example with TOML arrays of tables:

```toml
[[products]]
name = "Hammer"
sku = 738594937

[[products]]
name = "Nail"
sku = 284758393
```

Schema:

```toml
[types.productType]
type = "table"

    [types.productType.name]
    type = "string"

    [types.productType.sku]
    type = "integer"

[elements.products]
type = "array"
itemtype = "types.productType"
```

Example with TOML arrays of inline tables:

```toml
points = [
  { x = 1, y = 2 },
  { x = 3, y = 4 }
]
```

Schema:

```toml
[types.pointType]
type = "table"

    [types.pointType.x]
    type = "integer"

    [types.pointType.y]
    type = "integer"

[elements.points]
type = "array"
itemtype = "types.pointType"
```

##### Tuple / Positional Array Validation - `items`

Use `items` to validate each array entry by position with an exact length.

Example:

```toml
[types.coordinate]
type = "float"

[types.label]
type = "string"

[types.coordinateLabel]
type = "array"
items = [ "types.coordinate", "types.label" ]
```

Semantics:

 - `items` is ordered, and each index validates against the corresponding referenced type.
 - `items` MUST contain at least one type reference. A schema loader MUST reject
   `items = []`; to require an empty array, omit `items` and declare
   `maxlength = 0` instead.
 - When `items` is present, the array MUST have exactly the same number of items.
 - `items` is mutually exclusive with `itemtype`.
 - `items` is also mutually exclusive with `minlength` and `maxlength`.
 - `items` is mutually exclusive with the whole
   [per-member value-constraint subset](#per-member-value-constraints):
   `allowedvalues`, `min`, `max`, `pattern`, and `format`. Constraints for a
   tuple position belong in the reusable definition referenced at that position.
   The exclusion is local, as
   [Local and Effective Checks](#local-and-effective-checks) states, so an
   `allof` component MAY still contribute one of those constraints
   conjunctively.
 - `items` MAY name the same type reference more than once. Each entry denotes a
   position rather than an alternative, so a tuple whose positions share a type,
   such as `items = [ "types.coordinate", "types.coordinate" ]`, is valid and
   repetition is meaningful.

##### Array Uniqueness - `uniqueitems`

`uniqueitems` is a boolean property valid only on a definition whose selected
type is the built-in `array`. When it is `true`, no two items in the document
array may be equal. When it is `false` or absent, the schema imposes no
uniqueness condition. It applies to homogeneous arrays, tuple arrays, and
arrays whose item type is otherwise unconstrained.

Items are compared using
[Parsed Value Equality](#parsed-value-equality), recursively for arrays and
tables.

Uniqueness compares complete item values. Version 1.0 does not define a
field-selecting operation such as `uniqueBy`; two tables that share an `id` but
differ elsewhere remain distinct. A schema loader MUST reject a non-boolean
`uniqueitems` value or its use on a non-array definition.

#### Collection of Elements for Dynamic Keys

One can set an element of type `collection` when there is a need to have multiple children with dynamic, user-provided keys or table headers.

A `collection` is represented by a TOML table and may have fixed child
definitions in addition to dynamically named entries. It remains a distinct
schema type from `table` because it applies `itemtype` and collection
unknown-key semantics to dynamic entries. Fixed children may use any schema
definition, including nested tables, arrays, and named types.

A `collection` requires at least one effective `itemtype` constraint to define
the type of its dynamic child values. The constraint may be declared locally or
contributed by a compatible `allof` component; this is the collection instance
of the general principle stated under
[Composition Supplying the Local Skeleton](#composition-supplying-the-local-skeleton),
not a rule peculiar to collections. Each dynamic child must be given
a unique key in the TOML document. `itemtype` accepts the references
[Type Reference Restrictions](#type-reference-restrictions) permits at that
position. A schema loader MUST reject an effective collection
when neither its local definition nor any referenced or composed definition
contributes an `itemtype`. This is a schema-load check, so it reads only the
contributions that are determinate at schema-load time; which components make
one is defined under
[Determinate Fixed-Child Set](#determinate-fixed-child-set). It is one of the
checks that read the effective rather than the local view, as
[Local and Effective Checks](#local-and-effective-checks) enumerates.

The built-in `collection` cannot itself be used as `itemtype` or as an entry in
`items`, `oneof`, `anyof`, or `allof`, as
[Type Reference Restrictions](#type-reference-restrictions) states: those bare
references provide no place to declare
the nested collection's required `itemtype`. Define a reusable collection with
its own `itemtype` and reference that named definition instead.

When collection values may have alternative types, define those alternatives in a reusable `[types]` definition with `oneof` or `anyof`, then reference that definition with `itemtype`. This keeps `oneof` and `anyof` consistently scoped to the current node rather than changing their meaning on a container.

Unlike a `table`, a `collection` is never closed. Validators MUST classify every
key of the document table as either a fixed child or a dynamic entry, using the
collection's [effective closure set](#effective-closure-set) to decide which. A
key that names a fixed child definition is validated by that definition. Every
other key is a dynamic entry: its name MUST satisfy every applicable
`keypattern` and its
value MUST validate against every applicable `itemtype`. A collection therefore
never produces an `unknown-key` error; an undeclared key that is not acceptable is
reported as a `keypattern` failure on the key, or as an ordinary failure of the
entry's value against the item definition, as
[Code Registry](#code-registry) requires. Fixed children that
are not optional remain required, exactly as in a closed table.

This difference in unknown-key semantics is why `table` and `collection` are not
interchangeable for `allof` composition.

A `collection` may additionally constrain the **keys** (entry names) of its dynamic children with `keypattern`. See [Key Pattern - `keypattern`](#key-pattern---keypattern).

A `collection` may also constrain the **values** of its dynamic entries inline,
with `allowedvalues`, `min`, `max`, `pattern`, or `format`, instead of pushing
each such constraint into a named `itemtype` definition. Those five properties
behave identically on an `array` and on a `collection`; see
[Per-Member Value Constraints](#per-member-value-constraints).

This precedence is what lets a collection validate known keys precisely while
applying `itemtype` only to all other keys. For example, `itemtype = "any"`
makes unknown keys forward-compatible while fixed children still receive their
declared validation. Authors choosing this pattern trade typo detection on
unknown keys for extensibility; use a closed `table` when undeclared keys must
be rejected.

This precedence also supports open extension namespaces with typed well-known
entries. For example, a `pyproject.toml` schema can define `[tool]` as a
collection of open tables, then add fixed `[tool.ruff]` and `[tool.uv]` child
definitions with their respective schemas. Other tool names continue to use the
collection's general `itemtype`.


**Example:**
The below example shows a table `servers` that is a `collection`.
Each server MUST be given a key and follow the defined structure of `types.serverType`.
A server may also have a DNS table with user-provided key names.

TOML:
```toml
[servers]
group = "group1"

    [servers.alpha]
    name = "Alpha DC0"
    address = "dc0.alpha"

        [servers.alpha.dnstable]
        cloudflare = "1.1.1.1"
        google1 = "4.4.4.4"
        google2 = "8.8.8.8"
        internal = "mydns.intranet"

    [servers.beta]
    name = "Beta DC0"
    address = "dc0.beta"
```

TOML Schema:
```toml
[types]

    [types.dnsType]
    type = "string"
    pattern = "<ip-regex-pattern>"

    [types.hostnameType]
    type = "string"
    pattern = "<valid-hostname-regex-pattern>"

    [types.dnsValue]
    anyof = [ "types.dnsType", "types.hostnameType" ]

    [types.serverType]
    type = "table"

        [types.serverType.name]
        type = "string"

        [types.serverType.address]
        type = "string"

        [types.serverType.dnstable]
        type = "collection"
        itemtype = "types.dnsValue"
        optional = true

[elements]

    [elements.servers]
    type = "collection"
    itemtype = "types.serverType"

        [elements.servers.group]
        type = "string"
```

A `collection` may be represented as subtables of a common table in a TOML document.

#### Per-Member Value Constraints

Five value constraints form the **per-member value-constraint subset**:
`allowedvalues`, `min`, `max`, `pattern`, and `format`. Any of them MAY be
declared directly on a definition that selects the built-in `type = "array"` or
the built-in `type = "collection"`. Declared there, a constraint does not
describe the container. It applies to **each item** of the array and to **each
dynamically keyed entry** of the collection. The subset is identical for the two
containers, because an array item and a collection entry are the same thing: one
member value that the container's `itemtype` governs.

Declaring a per-member constraint inline is exactly equivalent to declaring that
same constraint on the member definition the container's `itemtype` reaches. The
two spellings MUST validate identically, and authors MAY choose either. Inline
is the shorter spelling for a container whose members need one or two
constraints; a named `itemtype` definition is the reusable one.

```toml
[elements.ports]
type = "array"
itemtype = "integer"
min = 1
max = 65535

[elements.hosts]
type = "collection"
itemtype = "string"
format = "hostname"
keypattern = "^[a-z][a-z0-9-]*$"
```

On a `collection`, `pattern` constrains each dynamic entry's **value** while
`keypattern` constrains each dynamic entry's **key**. The two are independent,
apply to different subjects, and MAY be combined on the same definition.

Because the two spellings are equivalent, declaring the **same** constraint both
inline and on the resolved `itemtype` definition is a schema-load error, and
schema loaders MUST reject it with `exclusive-properties`. This specification
defines no precedence between them and needs none: a schema that would say the
same thing twice says it once instead. Different constraints MAY be split across
the two spellings and then apply conjunctively. The check compares the inline
constraint against the constraint the resolved `itemtype` definition declares
itself; a constraint that definition acquires from its own `allof` is not part
of the check and merges conjunctively as
[Merging by TOML Kind](#merging-by-toml-kind) requires.

A per-member constraint obeys the same applicability rule its own section
states, applied to the **member** type rather than to the container:

- `pattern` and `format` require the effective member type to be the built-in
  `string`, as [Pattern](#pattern---pattern) and
  [String Format](#string-format---format) require of a string constraint.
- `min` and `max` require the effective member type to resolve to exactly one
  comparable kind, as
  [Minimum Value / Maximum Value](#minimum-value--maximum-value---min-and-max)
  requires.
- every `allowedvalues` entry MUST have a TOML kind the effective member type
  permits, as [Allowed Values](#allowed-values---allowedvalues) requires.

The member type is the one the container's `itemtype` selects, resolved through
named references and through the alternatives of a referenced `oneof` or
`anyof`, which MUST all resolve to the same kind. When a container declares no
`itemtype`, its members are unconstrained `any`: `allowedvalues` still applies
and enumerates values of any TOML kind, while `min`, `max`, `pattern`, and
`format` have no determinate member kind to apply to. Schema loaders MUST reject
a per-member constraint whose member type is indeterminate or of the wrong kind
at schema-load time.

`items` is mutually exclusive with the whole subset. A tuple position is
described by the reusable definition named at that position, so a constraint
that would apply uniformly to every member has no meaning beside a positional
definition.

**`minlength` and `maxlength` are deliberately not in the subset.** On an
`array` or a `collection` those two spellings are already taken: they constrain
the **container**, bounding an array's item count and a collection's
dynamic-entry count, as [Length](#length---minlength-and-maxlength) defines.
That meaning is unchanged. One spelling cannot mean both "this container holds
at least two members" and "each member is a string of at least two characters",
and reinterpreting it per member on a container whose members happen to be
strings would make the same keyword mean different things in two schemas that
differ only in their `itemtype`. Per-member string length is therefore expressed
through `itemtype`:

```toml
[types.shortName]
type = "string"
minlength = 1
maxlength = 32

[elements.tags]
type = "array"
itemtype = "types.shortName"
minlength = 1
```

Here `minlength = 1` on `elements.tags` requires at least one tag, while the
bounds inside `types.shortName` govern each tag's length in characters. This is
the one exception to the symmetry above, and it exists because the spelling is
occupied, not because container members are otherwise privileged.

### Type Reference

A type reference applies a built-in type or inherits the rules of a named reusable type. Both `[types]` definitions and `[elements]` definitions may use type references. The `type` property selects the current node's type; built-in and named references use the same syntax.

When `type` selects a named reusable definition, the reference inherits that
definition's validation rules as-is. This inheritance includes `optional`, as
[Optionality](#optionality---optional) defines. In version 1.0, the
referencing definition MAY additionally declare only `allof`, `description`,
`optional`, `default`, and `deprecated`; it MUST NOT declare any other sibling
property or child definition. `allof` adds conjunctive components rather than
overriding the named reference. A local `default` is the use-site annotation
described below, and `deprecated = false` cannot cancel deprecation inherited
from a reference. In particular, validation constraints such as `pattern`,
`keypattern`, `min`, `max`, `minlength`, `maxlength`, `allowedvalues`,
`itemtype`, and `items` cannot be added or overridden at the reference site.
Schema loaders MUST reject such schemas at schema-load time.

To specialize validation rules, declare another named reusable definition rather than adding constraints to a reference:

```toml
[types.lowercaseName]
type = "string"
pattern = "^[a-z]+$"

[elements.name]
type = "types.lowercaseName"
description = "Display name"
optional = true
```

The following is invalid because `pattern` attempts to override the referenced definition:

```toml
[types.name]
type = "string"
pattern = "^[a-z]+$"

[elements.name]
type = "types.name"
pattern = "^[A-Z]+$" # invalid
```

```toml
[types]

    [types.nameType]
    type="string"
    pattern="[a-zA-Z]"  # unanchored: matches any string containing a letter

    [types.serverType.name]
    type = "types.nameType"

    [types.serverType.enabled]
    type = "boolean"

[elements]

    [elements.datacenter]
    type="table"

        [elements.datacenter.name]
        type="types.nameType"

        [elements.datacenter.tags]
        type = "array"
        itemtype = "string"

        [elements.datacenter.servers]
        type = "collection"
        itemtype = "types.serverType"
```

### Conjunctive Composition - `allof`

`allof` applies a non-empty array of type references to the current node in
addition to its local definition. It is an applicator, not a type selector: it
never chooses between alternatives and never defers a decision to a document
value. The local definition normally declares its own `type`, `oneof`, `anyof`,
or conditional selector, or has fixed children that make it an implicit table;
[Composition Supplying the Local Skeleton](#composition-supplying-the-local-skeleton)
defines the one case in which the composition supplies that skeleton instead.

```toml
[types.packageBase]
type = "table"

    [types.packageBase.version]
    type = "string"

[types.package]
type = "table"
allof = [ "types.packageBase" ]

    [types.package.name]
    type = "string"
```

#### Composition Supplying the Local Skeleton

One principle governs how much of a definition `allof` may supply:
**composition MAY supply the local skeleton when it determines that skeleton
unambiguously.** A definition need not restate a structural fact its components
already fix beyond doubt, and it MUST state anything they leave open.

A definition whose only applicator is a non-empty `allof` — one that declares no
`type`, no `oneof`, no `anyof`, no part of the conditional triple, and no nested
child definitions — is a **pure mixin**. A pure mixin is valid when the
effective types of its `allof` components resolve to exactly one TOML kind. That
kind becomes the definition's effective type, exactly as if `type` had named it:

```toml
[types.packageBase]
type = "table"

    [types.packageBase.version]
    type = "string"

[types.named]
type = "table"

    [types.named.name]
    type = "string"

[types.package]
allof = [ "types.packageBase", "types.named" ]
```

`types.package` has the effective type `table` and the fixed children `version`
and `name`. Writing `type = "table"` beside that `allof` remains valid and adds
nothing.

When the components resolve to more than one TOML kind, or when the kind cannot
be determined at schema-load time, the composition determines no skeleton and
there is nothing for the definition to inherit. Schema loaders MUST reject such
a definition at schema-load time with `incompatible-composition`. Authors
resolve the ambiguity by declaring the intended type with `type`, which turns an
indeterminate composition into an ordinary compatibility failure against a
stated kind. Determining a pure mixin's effective type is one of the checks that
read the effective rather than the local view; see
[Local and Effective Checks](#local-and-effective-checks).

A pure mixin is still an application and never a selection. Because `allof` is
not a selector, its components contribute their fixed children to the
definition's [determinate fixed-child set](#determinate-fixed-child-set), and
any `itemtype` and `keypattern` they declare are likewise determinate, exactly
as they are for a definition that also declares `type`. Nothing about a pure
mixin is deferred to validation time.

The same principle governs the one other place a composition supplies a
required local element: a `collection` may obtain its mandatory `itemtype` from
a compatible `allof` component, as
[Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys)
describes. That allowance is a consequence of this principle rather than a
special case for collections.

A definition that declares no selector, no nested child definition, and no
`allof` determines nothing at all, and it remains a schema-load error under
[Types table](#types-table---types).

#### The Effective Definition

`allof` does not validate the document value separately against the local
definition and against each component in isolation. It first composes an
**effective definition** by merging the local definition with every referenced
component, and the document value is then validated against that single
effective definition. Merging follows two different rules, and the difference
between them is normative:

 - **Assertions merge conjunctively.** Every assertion declared by the local
   definition or by any component applies to the value, and no assertion
   overrides another. If two participants constrain the same value, both
   constraints apply. A contradiction may therefore describe an effective
   definition for which no document value is valid; it does not create
   last-wins behavior.
 - **Structure merges by union.** The fixed-child names contributed by the
   local definition and by every component are unioned into one set *before*
   any unknown-key, requiredness, or sibling rule is applied, and openness or
   closure is decided from that merged set rather than participant by
   participant. Two such sets are defined below, computed at two different
   times and read by different rules: see
   [Determinate Fixed-Child Set](#determinate-fixed-child-set) and
   [Effective Closure Set](#effective-closure-set).

The two rules MUST NOT be conflated, because they give opposite answers for the
primary use of `allof`. Take a closed table `A` with the single fixed child
`x`, a closed table `B` with the single fixed child `y`, and a definition that
composes both. The document table `{ x = 1, y = 2 }` is valid: the effective
closure set is `{ x, y }`, so neither key is unknown. Checking that same
table separately against `A` and against `B` would instead make `y` unknown to
`A` and `x` unknown to `B`, rejecting every document and making mixin
composition useless. Only the effective-definition reading is conforming.

Composition compatibility is judged from the effective view, which is one of
the checks [Local and Effective Checks](#local-and-effective-checks) lists as
effective; every other applicability and exclusivity check remains local.

A composition is well formed only when its participants agree on kind.
Every component MUST resolve to an effective TOML kind compatible with the
local definition, or, when the local definition is a pure mixin and states no
kind of its own, with one another. When the local selector is `oneof` or
`anyof`, all of its
alternatives MUST resolve to the same effective kind before `allof` can be
applied; a multi-kind local union combined with `allof` is indeterminate and
MUST be rejected at schema-load time. Scalar and array components MUST have the
same kind as the local definition. Structured components MUST all be `table` or
all be `collection`; a `table` and a `collection` are not interchangeable for
composition because they have different unknown-key semantics. A component
whose alternatives resolve to different kinds is likewise indeterminate and
MUST be rejected. Which references `allof` accepts at all is stated under
[Type Reference Restrictions](#type-reference-restrictions).

`allof` MUST NOT list the same component twice. Duplication is judged on
resolved identity, after the optional `types.` prefix has been removed, exactly
as it is for union alternatives under
[Alternative Types - `oneof` and `anyof`](#alternative-types---oneof-and-anyof).
`allof = [ "types.a", "a" ]` therefore names one component twice and is
malformed; schema loaders MUST reject it at schema-load time. A repeated
component could never change the effective definition, because both merge rules
above are idempotent.

#### Merging by TOML Kind

The following rules define the effective definition for each TOML kind a
composition may produce. Throughout, *participant* means the local definition
or any `allof` component.

For a composed scalar, the effective definition carries every `format`,
`pattern`, `allowedvalues`, `min`, `max`, `minlength`, and `maxlength`
declared by any participant, and the document value MUST satisfy all of them.
Two `allowedvalues` enumerations therefore behave as an intersection, and two
boundaries narrow to the greatest `min` and the least `max`. The schema-load
consistency check described under
[Allowed Values - `allowedvalues`](#allowed-values---allowedvalues) inspects one
definition at a time and never inspects composed constraints, so a composed
constraint is always evaluated at document-validation time.

For a composed array, the effective definition carries every array assertion
declared by any participant. Homogeneous `itemtype` constraints from different
participants all apply to every item. A tuple `items` constraint contributes its
exact arity and its per-position definitions, and it applies alongside, rather
than instead of, any homogeneous or tuple constraint contributed elsewhere: each
item MUST satisfy its positional definition and every contributed `itemtype`.
Length bounds narrow to the greatest `minlength` and the least `maxlength`,
`uniqueitems = true` from any participant applies to the whole array and cannot
be cancelled by `uniqueitems = false` elsewhere, and item enumeration and item
range constraints likewise remain conjunctive. Two participants declaring
different arities, or a tuple arity outside a contributed length bound, make the
effective definition unsatisfiable. Such conflicts do not use last-wins merging
and are not by themselves a schema-load error.

For a composed table, validators MUST form the
[effective closure set](#effective-closure-set) before applying
unknown-key rules. The value of a fixed child named by more than one
participant MUST validate against every contributing child definition, and the
child is required when any contributing child definition requires it. A
composed table is open only when the effective closure set is empty.
Otherwise it is closed against exactly that set.

For a composed collection, the effective closure set retains precedence
over dynamic entries in the same way a locally declared fixed child does. Every
remaining dynamic entry MUST satisfy every contributed `itemtype`, and its key
MUST satisfy every contributed `keypattern`. A collection's required
dynamic-entry constraint may therefore be supplied entirely by one or more
`allof` components; it need not repeat a local `itemtype`.

Whether a composed node may be absent is governed by `optional` on the local
definition, as [Optionality](#optionality---optional) defines.

#### Determinate Fixed-Child Set

The **determinate fixed-child set** of a definition is computed at schema-load
time, without reference to any document. It names exactly the children the
definition is known to have whatever value is later validated against it. It is
the union of:

 - the names of the definition's own nested child definitions, including those
   written through the reserved `children` namespace;
 - the determinate fixed-child set of the definition named by `type`, when the
   selector is a reference to a reusable definition, followed through a chain of
   such references; and
 - the determinate fixed-child set of every `allof` component.

The computation is therefore recursive: a component that itself composes with
`allof` contributes everything its own composition contributes determinately.

A `oneof` or `anyof` selector and an `if`/`then`/`else` selector contribute
**nothing** to this set, and contribute no `itemtype` and no `keypattern`
either. Their alternatives and branches may declare different children, and
which one applies is not knowable until a document value exists, so no
schema-load rule may depend on that choice. The restriction is a property of the
selector, not of the whole definition: a union or conditional definition that
also declares `allof` still contributes whatever those components contribute
determinately.

Entries written through the reserved `children` namespace are ordinary fixed
children. As described under
[Quoted and Special Keys](#quoted-and-special-keys), `children` is a syntactic
escape for target keys whose names collide with schema property names, not a
different kind of child; both spellings denote the same target key and validate
identically. Such entries therefore belong to both sets defined here, take part
in requiredness and unknown-key handling like any other fixed child, and are
valid sibling-rule operands. The operand is the target key name, which is the
path segment following `children`, never the literal string `children`.

The determinate set is the set every schema-load rule reads, and it is the only
one such a rule may read, because no document exists at schema-load time. Two
rules read it:

 - Sibling-rule operand resolution and `exactlyone` applicability, as required
   under [Sibling Presence Rules](#sibling-presence-rules).
 - The collection `itemtype` requirement, as required under
   [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys).

Validators MUST NOT use the determinate set to reject unknown document keys.
Load-time determinacy and validation-time closure are different questions: a
child no schema-load rule may assume exists is still an ordinary child of a
document node whose alternative or branch declares it. Unknown-key rejection
reads the effective closure set defined next.

#### Effective Closure Set

The **effective closure set** of a document node is computed at validation time,
for that one node. It is the determinate fixed-child set of the node's
definition plus the fixed children declared by whichever union alternative or
conditional branch was selected for that node:

 - When the node's definition, or any `allof` component of it, uses `oneof` or
   `anyof`, the alternative being evaluated contributes its own effective
   closure set for that node. `oneof` and `anyof` try each alternative as a
   candidate, so every candidate is judged against the set that candidate itself
   contributes.
 - When the node's definition, or any `allof` component of it, uses the
   conditional triple, the branch the condition selected contributes its own
   effective closure set for that node. The branch that was not selected
   contributes nothing.

Validators MUST judge unknown keys against the effective closure set, and MUST
apply requiredness and the value validation of each present child against the
same set. A key contributed by the alternative or branch that actually matched
is a known key and MUST NOT be reported as an unexpected key, and a child that
alternative or branch requires MUST be present. Judging unknown keys against the
determinate set instead is incorrect: it rejects the composition patterns this
language exists to express, because a composed conditional or variant table
would reject every key its matched shape declares.

Dynamic-entry rules are not contributed this way. An alternative or branch that
is itself a collection applies its own `itemtype` and `keypattern` while it
validates the node, and the node's effective closure set keeps its precedence
over dynamic entries under every participant, exactly as
[Merging by TOML Kind](#merging-by-toml-kind) describes for a composed
collection.

When no alternative matches, a key that belongs to the effective closure set of
no candidate could not have been accepted by any of them. An implementation MAY
report such a key as an `unknown-key` error on the node in addition to, or
instead of, the union's arity failure, as permitted under
[Aggregation, Ordering, and Branch Diagnostics](#aggregation-ordering-and-branch-diagnostics).

Openness is likewise decided from the effective closure set. A table is open for
a document node only when that node's effective closure set is empty, and is
closed against exactly that set otherwise. It follows that a union alternative
that is itself an open table does not re-open a node that another participant
has closed: the open alternative contributes no name, so the node's effective
closure set under that alternative is just the determinate set, and a key
outside it makes the alternative fail rather than being accepted as arbitrary
data. When no other participant contributes a fixed child — a standalone `oneof`
over an open table and a closed table, for instance — the effective closure set
under the open alternative is empty, and that alternative accepts any table
exactly as it would if it were referenced directly.

Worked example. `types.database` selects a table shape from an `engine`
discriminator and contributes `id` through its own `allof`, and
`elements.composed` composes the whole conditional definition:

```toml
[types.common]
type = "table"

    [types.common.id]
    type = "integer"

[types.sqliteDatabase]
type = "table"

    [types.sqliteDatabase.engine]
    type = "string"

    [types.sqliteDatabase.file]
    type = "string"

[types.serverDatabase]
type = "table"

    [types.serverDatabase.engine]
    type = "string"

    [types.serverDatabase.host]
    type = "string"

[types.database]
if = { key = "engine", equals = "sqlite" }
then = "types.sqliteDatabase"
else = "types.serverDatabase"
allof = [ "types.common" ]

[elements.composed]
type = "table"
allof = [ "types.database" ]
```

The determinate fixed-child set of `elements.composed` is `{ id }`. The local
definition declares no child, and the `types.database` component contributes
only what its own `allof` contributes, because its conditional selector
contributes nothing. A sibling rule written on `elements.composed` could
therefore name `id` and no other child.

| Document value | Effective closure set | Result |
| --- | --- | --- |
| `{ id = 2, engine = "postgresql", host = "db.internal" }` | `{ id, engine, host }` | valid |
| `{ id = 2, engine = "sqlite", file = "db.sqlite" }` | `{ id, engine, file }` | valid |
| `{ id = 2, engine = "postgresql", host = "db.internal", bogus = true }` | `{ id, engine, host }` | invalid: `bogus` is an unknown key |
| `{ id = 2, engine = "sqlite", host = "db.internal" }` | `{ id, engine, file }` | invalid: `file` is required and `host` is an unknown key |

`host` is a known key in the first row because the condition selected
`types.serverDatabase`, and an unknown key in the last row because the same
document key selected `types.sqliteDatabase` instead. Nothing about `host` is
determinate, and nothing about it needs to be; only schema-load rules need
determinacy.

The same reading applies to a variant table composed from a base and a union:

```toml
[types.base]
type = "table"

    [types.base.id]
    type = "integer"

[types.named]
type = "table"

    [types.named.name]
    type = "string"

[types.labelled]
type = "table"

    [types.labelled.label]
    type = "string"

[types.identity]
oneof = [ "types.named", "types.labelled" ]

[elements.item]
type = "table"
allof = [ "types.base", "types.identity" ]
```

| Document value | Result |
| --- | --- |
| `{ id = 1, name = "a" }` | valid: `types.named` matched and contributes `name` |
| `{ id = 1, label = "a" }` | valid: `types.labelled` matched and contributes `label` |
| `{ id = 1, name = "a", label = "b" }` | invalid: both alternatives fail on the other's key, so `oneof` matches none |
| `{ id = 1, other = true }` | invalid: no alternative contributes `other`, so no alternative matches |
| `{ name = "a" }` | invalid: `id` is required |

The determinate fixed-child set here is `{ id }`, so `id` is the only name an
`exactlyone`, `mutuallyexclusive`, or `dependentrequired` rule on
`elements.item` could use, while `name` and `label` are ordinary known keys of
whichever document node their alternative matched.

#### Composition Examples

Two components with disjoint fixed children. Both fixed-child sets are
`{ x, y }`, both children are required, and the composed table is closed
against exactly those two names:

```toml
[types.hasX]
type = "table"

    [types.hasX.x]
    type = "integer"

[types.hasY]
type = "table"

    [types.hasY.y]
    type = "integer"

[types.point]
type = "table"
allof = [ "types.hasX", "types.hasY" ]
```

| Document value | Result |
| --- | --- |
| `{ x = 1, y = 2 }` | valid |
| `{ x = 1 }` | invalid: `y` is required |
| `{ x = 1, y = 2, z = 3 }` | invalid: `z` is an unknown key |

Two components that overlap on one child. The effective definition has a single
`name` child whose value must satisfy both contributing definitions, and `name`
is required because one contributor requires it:

```toml
[types.namedThing]
type = "table"

    [types.namedThing.name]
    type = "string"
    minlength = 3

[types.slugNamed]
type = "table"

    [types.slugNamed.name]
    type = "string"
    pattern = "^[a-z]+$"
    optional = true

[types.entity]
type = "table"
allof = [ "types.namedThing", "types.slugNamed" ]
```

| Document value | Result |
| --- | --- |
| `{ name = "alpha" }` | valid: satisfies `minlength` and `pattern` |
| `{ name = "Alpha" }` | invalid: fails the contributed `pattern` |
| `{ name = "ab" }` | invalid: fails the contributed `minlength` |
| `{ }` | invalid: `name` is required by `types.namedThing` |

A collection whose fixed child and whose dynamic-entry rules come from
different participants. `schemaVersion` is contributed locally, while
`itemtype` and `keypattern` are contributed by the component and apply only to
the remaining dynamic entries:

```toml
[types.featureFlags]
type = "collection"
itemtype = "boolean"
keypattern = "^[a-z][a-z0-9-]*$"

[types.versionedFlags]
type = "collection"
allof = [ "types.featureFlags" ]

    [types.versionedFlags.schemaVersion]
    type = "integer"
```

| Document value | Result |
| --- | --- |
| `{ schemaVersion = 2, dark-mode = true }` | valid |
| `{ schemaVersion = 2 }` | valid: a collection needs no dynamic entries |
| `{ dark-mode = true }` | invalid: `schemaVersion` is required |
| `{ schemaVersion = 2, darkMode = true }` | invalid: `darkMode` fails the contributed `keypattern` |
| `{ schemaVersion = 2, dark-mode = 1 }` | invalid: `1` fails the contributed `itemtype` |

The fixed child escapes both dynamic-entry rules: `schemaVersion` is an
`integer` rather than a `boolean`, and its name does not match the
`keypattern`, yet it is valid because fixed children take precedence over
dynamic entries.

An `allof` component may itself contain `oneof`, `anyof`, or another `allof`
when its effective kind is unambiguous. A composed definition may be referenced
from `type`, `itemtype`, `items`, `oneof`, `anyof`, `allof`, `then`, or `else`. All composition
references MUST resolve at schema-load time, and composition/type-selection
cycles are malformed. Structural recursion that consumes a child or container
member remains valid.

### Alternative Types - `oneof` and `anyof`

Use `oneof` or `anyof` when a value may validate against alternative type references.

- `oneof`: exactly one referenced type must validate.
- `anyof`: at least one referenced type must validate.

These properties can be used anywhere a schema definition can appear, including an `[elements]` field, a reusable `[types]` definition, and a type referenced through `itemtype` for array or collection items. Which references an alternative may name is stated under
[Type Reference Restrictions](#type-reference-restrictions); use a named
reusable definition when an alternative needs a fully defined collection, an
intentionally unconstrained named branch, or any other constraint.

`type`, `oneof`, `anyof`, and the conditional triple all select the current
node's type, and a definition declares at most one of them, as
[Types table](#types-table---types) requires.

The array assigned to `oneof` or `anyof` MUST contain at least one type
reference. A union definition MAY additionally declare only `description`,
`optional`, `default`, `deprecated`, and `allof`; it MUST NOT declare another
validation property or any nested child definition. Schema loaders MUST reject
empty unions and other union siblings at schema-load time. Constraints required
by an alternative belong in a named reusable definition referenced by the
union.

The alternatives of a `oneof` or `anyof` array MUST be distinct. A repeated
alternative adds no branch and, for `oneof`, cannot be the exactly-one match.
Duplication is judged on resolved identity, after the optional `types.` prefix
has been removed, so `oneof = [ "types.stringId", "stringId" ]` names the same
definition twice and is malformed. Schema loaders MUST reject a duplicate
alternative at schema-load time. This differs from
[`items`](#tuple--positional-array-validation---items), where an entry denotes a
tuple position rather than an alternative and repetition is meaningful.

```toml
[types.stringId]
type = "string"
pattern = "^[a-z]+$"

[types.integerId]
type = "integer"
min = 1

[elements.id]
anyof = [ "types.stringId", "types.integerId" ]

[elements.simpleId]
oneof = [ "string", "integer" ]
```

Use a named reusable definition whenever an alternative needs constraints such as `pattern`, `min`, `allowedvalues`, `itemtype`, or child fields.

```toml
[types.dependencyVersion]
type = "string"
pattern = "^[0-9]+\\.[0-9]+\\.[0-9]+$"

[types.inlineDependency]
type = "table"

[types.dependency]
oneof = [ "types.dependencyVersion", "types.inlineDependency" ]
```

For container items with alternative types, use a named wrapper:

```toml
[types.dnsValue]
oneof = [ "types.ipAddress", "types.hostname" ]

[elements.dns]
type = "collection"
itemtype = "types.dnsValue"
```

A named container definition can also be an alternative. This models formats
that accept either one table or an array of the same table shape:

```toml
[types.cascadeEntry]
type = "table"

    [types.cascadeEntry.params]
    type = "table"
    optional = true

[types.cascadeEntries]
type = "array"
itemtype = "types.cascadeEntry"

[elements.cascade]
oneof = [ "types.cascadeEntry", "types.cascadeEntries" ]
```

A union contributes nothing to the
[determinate fixed-child set](#determinate-fixed-child-set) of the node it
selects, because no alternative is chosen until a document value exists. It does
contribute at validation time: when an alternative is evaluated against a
document node, that alternative's fixed children join the node's
[effective closure set](#effective-closure-set) for that evaluation, so a key
the alternative declares is a known key of the node and MUST NOT be reported as
unexpected. This is what lets a union be composed into a table with `allof`
without the alternatives' own children becoming unknown keys.

When alternatives contain annotations, only successful alternatives contribute
them, and only for a value that is present. Deprecation warnings follow the
successful-alternative rule: `oneof` reports the warning of its single
successful alternative, and `anyof` reports the warnings of every successful
alternative, deduplicated as [Diagnostics](#diagnostics) requires. Consequently,
a deprecated successful alternative contributes a warning even when another
successful `anyof` alternative is not deprecated; this preserves all annotations
attached to definitions that accepted the value. Alternative `default`
annotations are governed by [Default](#default---default): they are never
combined into the slot's effective default and never cause a schema-load
conflict. For a present value, an implementation MAY surface the default of each
successful alternative as a hint, deduplicated by
[Parsed Value Equality](#parsed-value-equality). An alternative that fails
validation contributes neither defaults nor deprecation warnings; what happens to
its diagnostics is defined under
[Alternative and Branch Commit and Discard](#alternative-and-branch-commit-and-discard).

### Conditional Selection - `if`, `then`, and `else`

The `if`, `then`, and `else` properties form one exhaustive selector for a
table-like node. The condition inspects one direct child of the current parsed
table and selects one of two named reusable definitions:

```toml
[types.sqliteDatabase]
type = "table"

    [types.sqliteDatabase.engine]
    type = "string"
    allowedvalues = [ "sqlite" ]

    [types.sqliteDatabase.path]
    type = "string"

[types.serverDatabase]
type = "table"

    [types.serverDatabase.engine]
    type = "string"
    allowedvalues = [ "postgresql", "mysql" ]

    [types.serverDatabase.host]
    type = "string"

[types.database]
if = { key = "engine", equals = "sqlite" }
then = "types.sqliteDatabase"
else = "types.serverDatabase"
```

Both branches declare `engine`, the key the condition reads. That is required
rather than stylistic: see
[The discriminator key and closed branches](#the-discriminator-key-and-closed-branches)
below.

`if` MUST be an inline table containing `key` and exactly one of `equals` or
`in`. It MUST contain no other members.

Because `if` is also a legal child key, an `if = { ... }` key/value entry is
always the conditional selector, while a table header such as
`[types.example.if]` is always a child definition named `if`. Consequently the
condition MUST use inline-table syntax and can never be written as
`[types.example.if]`. A definition that needs a target child named `if` writes
that child through the `children` namespace, as described under
[Quoted and Special Keys](#quoted-and-special-keys). A conditional definition
has no nested child definitions of its own, so the two spellings never compete
within one conditional definition, but a loader still MUST NOT infer the
selector from a table-form `if`.

- `key` MUST be a string naming one direct child key of the parsed table being
  validated. It is a decoded TOML key, not a dotted document path, and it does
  not have to name a schema-declared child, because a conditional definition has
  no nested child definitions of its own. An empty or literal dotted key is
  permitted.
- `equals` accepts one TOML value. The condition succeeds when the child exists
  and is equal to that value according to [Parsed Value Equality](#parsed-value-equality).
- `in` MUST be a non-empty array. The condition succeeds when the child exists
  and is equal to at least one array entry according to Parsed Value Equality.

If the named child is absent, the condition is false. A validator MUST apply
only the selected branch: `then` when the condition is true and `else` when it
is false. The condition itself emits no document-validation diagnostic.
Validation diagnostics and deprecation annotations come only from the selected
branch. A branch default does not become the conditional slot's effective
default; for a present value, an implementation MAY surface the selected
branch's default as a hint.

The condition reads a direct child of a parsed table. When the document value at
a conditional node is not a table — a scalar, an array, or an array of tables —
no direct child can be read, so the condition cannot be satisfied and is false,
exactly as it is for an absent child. `else` is therefore the selected branch.
Because both branches MUST resolve to the same table-like effective kind, that
value cannot validate against either branch, and the node is invalid. A
validator MUST report this as a kind mismatch against the common branch kind at
the node's location, using the `type-mismatch` code defined under
[Validation codes](#validation-codes), and MUST NOT report the branch's internal
`missing-required` or `unknown-key` diagnostics for a value that is not a table
at all. It MUST NOT report a diagnostic describing the condition, which never
fails on its own.

Consequently, a `default` on a conditional definition MUST be a table. A
non-table default cannot satisfy either branch, so a schema loader MUST reject
it at schema-load time under the default-validation rule stated below.

Like a union, the conditional triple contributes nothing to the
[determinate fixed-child set](#determinate-fixed-child-set) of the node it
selects. The selected branch's fixed children join the node's
[effective closure set](#effective-closure-set) at validation time, so the keys
the matched branch declares are known keys of that node, while keys declared
only by the branch that was not selected are not.

`then` and `else` MUST each be a string naming a reusable definition in
`[types]`, and both definitions MUST resolve
to the same effective kind, which MUST be `table` or `collection`, as
[Type Reference Restrictions](#type-reference-restrictions) states.
Schema loaders MUST reject unresolved branches, different branch kinds,
branches that do not resolve to a table-like kind, and cycles through
conditional branches.

The conditional triple is one of the four selectors a definition declares at
most one of, as [Types table](#types-table---types) requires. A conditional
definition MAY additionally declare only `allof`,
`description`, `optional`, `default`, and `deprecated`; it MUST NOT contain
kind-specific validation properties or nested child definitions. An `allof`
component MUST be compatible with the common branch kind and is applied
conjunctively with whichever branch is selected.

Optionality belongs to the conditional definition, as
[Optionality](#optionality---optional) defines. A default on the conditional
definition MUST validate against the branch selected by that default at
schema-load time.

Example with a multi-value condition:

```toml
[types.database]
if = { key = "engine", in = [ "postgresql", "mysql" ] }
then = "types.serverDatabase"
else = "types.embeddedDatabase"
```

Additional alternatives can be expressed by referencing another conditional
definition from `then` or `else`.

#### The discriminator key and closed branches

The key named by `if.key` is ordinary application data. It is read to select a
branch, and it is then validated by the selected branch like any other key. A
conditional definition contributes no fixed children of its own, so nothing
declares the discriminator on the node's behalf.

A branch that declares fixed children is closed against exactly those children,
as [Effective Closure Set](#effective-closure-set) defines. If such a branch
omits the discriminator, the key the condition just read is not in the node's
effective closure set and a validator MUST report it as an unknown key, so the
conditional can never accept a document. Every closed branch MUST therefore
declare the discriminator itself.

Schema loaders MUST reject a conditional definition when a branch has a
non-empty [determinate fixed-child set](#determinate-fixed-child-set) that does
not contain the key named by `if.key`. That set is computed at schema-load time,
so this check catches the common authoring mistake without resolving
document-dependent shapes. A branch whose fixed children are contributed only by
a nested union or conditional has an empty determinate set, and a loader cannot
decide the question for it; the same unknown-key rule still applies at
validation time, and authors remain responsible for declaring the discriminator
in every shape a branch can take.

Two branch shapes need no declaration and are not rejected: a branch that is an
open table, whose effective closure set is empty and which therefore accepts the
discriminator as arbitrary data, and a branch that is a `collection`, whose
dynamic-entry rules accept the discriminator when its `keypattern` and
`itemtype` permit it.

The `else` branch is subject to the same rule as `then`. An `else` branch is
selected both when the discriminator holds a different value and when it is
absent, so a closed `else` branch typically declares the discriminator with
`optional = true`, with `allowedvalues` excluding the value that selects `then`,
or with both. In the example above, `types.serverDatabase` declares `engine`
with `allowedvalues = [ "postgresql", "mysql" ]`, which both admits the key and
rejects a value that should have selected the other branch.

### Sibling Presence Rules

Version 1.0 defines three presence-only rules for direct fixed children of an
effective `table` or `collection`. They inspect parsed key presence, never a
child's value, and never follow a dotted string as a document path.

#### Dependencies - `dependentrequired`

`dependentrequired` is a non-empty inline table. Each member maps one trigger
child name to a non-empty array of unique child names. When the trigger is
present, every listed child MUST also be present.

Because `dependentrequired` is also a legal child key, a
`dependentrequired = { ... }` key/value entry is always the sibling rule, while
a table header such as `[types.example.dependentrequired]` is always a child
definition named `dependentrequired`. A definition that needs both the rule and
a child of that name writes the child through the `children` namespace, as
described under [Quoted and Special Keys](#quoted-and-special-keys).

```toml
[types.dependency]
type = "table"
dependentrequired = { branch = [ "git" ], tag = [ "git" ], rev = [ "git" ] }

    [types.dependency.git]
    type = "string"
    optional = true

    [types.dependency.branch]
    type = "string"
    optional = true

    [types.dependency.tag]
    type = "string"
    optional = true

    [types.dependency.rev]
    type = "string"
    optional = true
```

Dependencies are directional. If `a` requires `b`, the presence of `b` does not
require `a` unless a reverse mapping is declared. Every triggered mapping is
evaluated, so dependencies may apply transitively.

#### Mutual Exclusion - `mutuallyexclusive`

`mutuallyexclusive` is a non-empty array of groups. Each group is an array of
at least two unique child-name strings. At most one member of each group MAY be
present.

```toml
[types.source]
type = "table"
mutuallyexclusive = [ [ "git", "path" ], [ "branch", "tag", "rev" ] ]

    [types.source.git]
    type = "string"
    optional = true

    [types.source.path]
    type = "string"
    optional = true

    [types.source.branch]
    type = "string"
    optional = true

    [types.source.tag]
    type = "string"
    optional = true

    [types.source.rev]
    type = "string"
    optional = true
```

Zero or one present member satisfies a group.

#### Exactly One - `exactlyone`

`exactlyone` has the same shape as `mutuallyexclusive`, but exactly one member
of every group MUST be present.

```toml
[types.readmeTable]
type = "table"
exactlyone = [ [ "file", "text" ] ]

    [types.readmeTable.file]
    type = "string"
    optional = true

    [types.readmeTable.text]
    type = "string"
    optional = true
```

This allows every group member to remain individually `optional = true` while
the group still requires one choice.

Every name in these three properties MUST identify a direct fixed child in the
[determinate fixed-child set](#determinate-fixed-child-set) of the definition
after `allof` composition. Operand resolution and the `table`-or-`collection`
applicability of these rules are therefore effective rather than local checks,
as [Local and Effective Checks](#local-and-effective-checks) records. Operands
are resolved when the schema is loaded, so
they MUST NOT be resolved against the validation-time
[effective closure set](#effective-closure-set); only the presence check itself
happens while a document is validated. A quoted string containing a
dot identifies a literal dotted child key, and a child written through the
`children` namespace is named by its target key rather than by the literal
string `children`. Dynamic collection keys are not fixed children and cannot be
operands, while a collection's explicitly defined children participate normally.

Because a `oneof` or `anyof` selector and a conditional selector contribute
nothing to the determinate set, an operand that only such an alternative or
branch could supply names no fixed child and MUST be rejected at schema-load
time. Declare those operands as local fixed children instead — `optional = true`
ones when the document may omit them — or move the rule into the alternatives or
branches that define the children.

Schema loaders MUST reject a rule with the wrong TOML value type, an empty
mapping or group list, a group with fewer than two members, a duplicate name
within one dependency array or group, an unknown fixed-child name, or use on an
incompatible effective kind. Loaders are not required to prove general logical
satisfiability between multiple valid rules.

Ordinary requiredness is evaluated together with these rules. An absent
optional trigger has no effect. A non-optional child remains required even if a
presence group would otherwise permit its absence.

### Annotations

`description`, `default`, and `deprecated` are **annotations**. Unlike the
assertions defined above, an annotation never decides validity: it cannot make a
document valid or invalid, and removing every annotation from a schema leaves
the set of documents that schema accepts unchanged. The sections below define
each annotation; this section defines what they attach to and how one effective
value is obtained when a definition is reached indirectly.

**Attachment.** An annotation attaches to the document node being validated —
identified by its [instance path](#instance-path) — not to the schema definition
that carries it. The same definition applied at several nodes annotates each node
separately, and a definition applied to no node annotates nothing. Consequences:

- A definition used as an array `itemtype` annotates every present item node, not
  the array. A deprecated `itemtype` applied to an array of one hundred items
  therefore produces one hundred warnings, one per item node, and never a single
  warning for the array.
- A definition used as a `collection` `itemtype` annotates every present
  dynamically keyed entry, once per entry.
- A definition reached through `items` annotates the one indexed node it
  validates.
- An absent optional slot holds no node, so it carries no annotation and produces
  no deprecation warning.

Every annotation-derived diagnostic therefore carries the instance path of the
node it annotates. The severity and code of such a diagnostic are assigned by
[Diagnostics](#diagnostics); this section defines only what annotations attach
to.

**Effective annotation.** For one document location, the participants that may
carry an annotation are the use site, each definition along that use site's
`type` reference chain, each `allof` component of the effective definition, the
`oneof` or `anyof` alternative that succeeded, and the conditional branch that
was selected. The general precedence is:

1. an annotation declared at the use site takes precedence over the same
   annotation obtained through that use site's `type` reference chain, and
   within the chain the nearest declaration takes precedence over a more distant
   one;
2. `allof` components, union alternatives, and conditional branches contribute
   annotations for the location they help validate, but never override an
   annotation the use site or its reference chain already supplies.

`deprecated` is an exception to point 2 and does not follow the general
precedence: it combines disjunctively rather than resolving to a single
declaration, so a contributing `deprecated = true` deprecates the location even
when the use site declares `deprecated = false`. [Deprecation](#deprecation---deprecated) is
authoritative for it. The general precedence governs `description` and any
future annotation that resolves to at most one value.

Each annotation then resolves its own contributions as follows.

`description` follows the general precedence and resolves to at most one value.
A use-site `description` overrides the one carried by the definition it
references, and the nearest description along a reference chain overrides a more
distant one; the use site is the more specific statement about that location, so
it wins. Descriptions carried by `allof` components, by the successful union
alternative, and by the selected conditional branch never replace that value.
Where a single description is required — an editor hover, for instance — the
effective description is the use-site or reference-chain value if one exists,
and otherwise nothing. An implementation MAY additionally expose the
contributed descriptions as documentation, in a stable order: `allof`
components in declaration order, then the successful alternative or selected
branch. It MUST NOT merge or concatenate contributions into a value it presents
as a single authored description, and it MUST NOT reject a schema because two
participants carry different descriptions.

`default` does not follow this general precedence alone, because it is
machine-readable and must resolve to exactly one value. Its precedence and
conflict rules, including the `allof` and union rules, are defined under
[Default](#default---default) and are authoritative.

`deprecated` is a per-node warning. It fires once for each present document node
whose effective definition is deprecated, and duplicate warnings contributed by
more than one successful path are deduplicated as
[Diagnostics](#diagnostics) requires. It fires per node and never per definition,
so the count follows the attachment rules above. Deprecation is not inherited
downward: a deprecated parent produces one warning at the parent's instance path,
and a descendant produces a warning only when its own effective definition is
deprecated. When a union or conditional definition is itself deprecated, that
warning is reported at the node's own instance path in addition to any warning
contributed by the successful alternative or selected branch, and the two are
distinct instance paths only when the alternative or branch annotates a
descendant.

### Description - `description`

`description` is an optional human-readable string that documents a schema definition. It may be used on reusable types, elements, and nested definitions. Implementations and tooling MAY use it for documentation, suggestions, and autocompletion; it does not affect validation. Its precedence when a definition is reached through a reference, composition, an alternative, or a conditional branch is defined under [Annotations](#annotations).

```toml
[types.game]
type = "table"
description = "A game object."

    [types.game.id]
    type = "string"
    description = "Unique identifier for the game."

[elements.game]
type = "array"
description = "A list of games."
itemtype = "types.game"
```

### Default - `default`

`default` is a machine-readable annotation containing any TOML value. Like the
other annotations, it attaches to the document node a definition validates, and
to the slot that node occupies, as described under [Annotations](#annotations);
unlike them, it MUST resolve to exactly one value, and the rules below are
authoritative for that resolution.

```toml
[elements.retries]
type = "integer"
optional = true
default = 3
```

Because `default` is also a legal child key, a `default = <value>` key/value
entry is always the annotation, while a table header such as
`[elements.options.default]` is always a child definition named `default`.
Consequently, a table-valued default MUST use inline-table syntax, for example
`default = { min = 1, max = 10 }`. A definition that needs both the annotation
and a child named `default` writes the child through the `children` namespace,
as described under [Quoted and Special Keys](#quoted-and-special-keys).

A default is not a validation assertion and never changes the document being
validated. It does not insert a missing value, satisfy a required definition,
or change the parsed TOML data returned by an implementation. Tools MAY expose
it as a suggestion or effective-configuration hint through schema metadata.
Version 1.0 does not define an operation that materializes defaults.

Despite being an annotation, a declared default MUST validate as a present
value against the full effective definition at schema-load time. Default
validation applies all references, composition, alternatives, fixed children,
sibling rules, and ordinary constraints, but does not emit a deprecation
warning. A loader MUST reject an incompatible default. This is one of the
schema-load checks that read the effective rather than the local view, as
[Local and Effective Checks](#local-and-effective-checks) records.

A default declared directly at a use site takes precedence over one inherited
through its `type` reference. Without a use-site default, the referenced
default is inherited. Defaults contributed by `allof` components are compared using
[Parsed Value Equality](#parsed-value-equality). Equal defaults are
deduplicated. If components contribute unequal defaults and the local
definition has no default, the schema is malformed because it has no single
effective default. A valid local default resolves that annotation conflict and
must still satisfy every component.

Alternative selectors do not contribute to a slot's effective default. The
effective default of a slot whose selector resolves to `oneof` or `anyof` is
determined only by a use-site `default`, a default inherited through the named
`type` reference chain that resolves to the union, and defaults composed
through `allof`, using the precedence and conflict rules above. A `default`
declared on an individual alternative is never aggregated into the union's
effective default and never causes a schema-load conflict, even when several
`anyof` alternatives declare unequal defaults. A loader MUST NOT reject a
schema solely because two alternatives declare defaults, equal or unequal.
Resolving effective defaults therefore never requires deciding whether two
alternatives can match the same value.

When a union slot is absent, only this effective default applies; if none
exists, the slot has no default. When the slot value is present, `default` does
not change it, so alternative defaults surfaced under the successful-branch
rule are informational hints. An implementation MAY expose the default of each
successful alternative, deduplicated by
[Parsed Value Equality](#parsed-value-equality), but MUST NOT treat multiple
present-value alternative defaults as an error.

### Deprecation - `deprecated`

`deprecated` is a boolean annotation. When `true`, it advises that the present
value at that schema location should no longer be used and may be removed in a
future version.

```toml
[elements.legacy-timeout]
type = "integer"
deprecated = true
description = "Use request-timeout instead."
optional = true
```

Deprecation never makes a document invalid. A successfully validated present
value produces a warning diagnostic with the code `deprecated`; an absent
optional value produces no warning. A deprecated parent produces one warning at
the parent's instance path rather than one warning for every descendant. The
instance path a deprecation warning is reported at, and how many warnings a
deprecated array `itemtype` or collection `itemtype` produces, follow the
attachment rules under [Annotations](#annotations). Whether a node counts as
successfully validated for this purpose is decided by the annotation step of
[Keyword Evaluation Order](#keyword-evaluation-order).

Deprecation propagates through named references. Across `allof`, any
contributing `deprecated = true` deprecates the location, and a local
`deprecated = false` cannot cancel it. Alternative branches follow the
successful-branch annotation rules defined above. A non-boolean `deprecated`
value is a schema-load error. Authors SHOULD use `description` for migration or
replacement guidance.

### Optionality - `optional`

Properties may be defined as optional in the schema. By default, optional equals false, and the structure is required.

Validators MUST skip a definition only when it is optional and the corresponding
value does not exist in the TOML document. In every other case, the validator
MUST validate the value against the definition.

This section is the single authority for how `optional` interacts with
references, composition, alternatives, and conditional branches.

For a named `type` reference, optionality is inherited: the referencing slot is
optional if either the use site or any definition in the reference chain
declares `optional = true`. An explicit `optional = false` cannot cancel an
inherited `true`. In contrast, `optional` on the local definition determines
whether a composed node may be absent, and `optional` values contributed only
through `allof` components do not affect presence; such a value has meaning only
when that component is referenced normally with `type`. The presence of a
`oneof` or `anyof` slot is governed only by `optional` on the union definition
or inherited through a named `type` reference to that union. `optional`
declared inside an alternative does not make the union slot optional because
no alternative is selected when the slot is absent. Optionality likewise belongs
to a conditional definition rather than to its branches: an `optional`
annotation inside a `then` or `else` branch does not make the conditional slot
optional, because no branch is selected when the slot is absent.

### Pattern - `pattern`

This property is valid on a definition whose selected type is the built-in
`string`, and, as a [per-member constraint](#per-member-value-constraints), on a
non-tuple `array` or `collection` whose effective member type is the built-in
`string`. It cannot be attached to another built-in type, an alternative
selector, or a named type reference, as
[Schema Definition Properties](#schema-definition-properties) requires. Schema
loaders MUST reject an incompatible
`pattern` at schema-load time rather than silently ignoring it. On a
`collection`, `pattern` constrains dynamic entry values while
[`keypattern`](#key-pattern---keypattern) constrains their keys.

The portable TOML Schema regular-expression profile consists of literals,
escaped metacharacters, the character escapes `\t`, `\n`, `\r`, `\f`, `\v`, and
`\a`, `.`, character classes and ranges, negated character
classes, concatenation, alternation, capturing and non-capturing groups, the
anchors `^` and `$`, and the greedy quantifiers `?`, `*`, `+`, `{n}`, `{n,}`,
and `{n,m}`. These constructs use the syntax documented by the
[RE2 syntax reference](https://github.com/google/re2/wiki/Syntax). Implementations MUST
support this profile.

The listed character escapes are portable because each denotes one fixed control
character, so no engine can disagree about what it matches. They are portable
both standalone and inside a character class, so `[ \t]` is a portable pattern.

Character-class shorthands such as `\d`, `\s`, and `\w` are outside the
portable profile because regular-expression engines disagree about whether
they use ASCII or Unicode membership. Write the intended set explicitly instead:
`[0-9]` rather than `\d`. Unicode property classes such as
`\p{L}`, inline flag groups such as `(?i)`, backreferences, look-around
assertions, atomic groups, conditionals, recursion, and the non-greedy and
possessive quantifier forms such as `*?` and `*+` are also outside the
portable profile.

**Patterns are compiled at schema-load time.** A schema loader MUST compile
every `pattern` value when it loads the schema, whether or not any document
exercises it. A pattern that does not compile — `"["`, `"{2,1}"`, or a trailing
backslash, for example — makes the schema malformed, and the loader MUST reject
it at schema-load time with the `invalid-pattern` code. An implementation MUST
NOT defer a compilation failure to match time, MUST NOT treat an uncompilable
pattern as a failed match, and MUST NOT treat it as a satisfied constraint.

A construct outside the portable profile is likewise a schema-load error,
reported with the `unsupported-pattern` code. A loader operating in its
conformant TOML Schema 1.0 mode MUST reject a `pattern`
that uses one, even when the underlying engine could compile it. An
implementation MAY offer an additional, explicitly named and documented extended
pattern profile that accepts further constructs, but that profile MUST NOT be
the default, and a schema accepted only under it is not a TOML Schema 1.0
schema. Portability is the whole purpose of naming a profile: if a
non-portable construct were merely discouraged, the same schema would be a
load error on one implementation, an ASCII-only match on a second, and a
Unicode match on a third, which is precisely the interoperability split the
profile exists to prevent. Conformance suites MUST use only the portable
profile. The engine an implementation matches these expressions with, and the
resource limits it applies to compilation and matching, are additionally
constrained by
[Regular-Expression Safety](#regular-expression-safety).

**Unicode semantics.** A pattern is compiled from, and matched against, the
decoded parsed string: a sequence of Unicode scalar values. The TOML parser has
already applied string escapes such as `\u00E9`, so a loader never sees TOML
escape syntax in a pattern. Matching operates on Unicode scalar values, never on
UTF-8 bytes, UTF-16 code units, or grapheme clusters, and the count semantics of
`{n,m}` follow that same unit. `.` matches exactly one scalar value other than
a line feed. A character class matches one scalar value from its members, and a
range such as `[a-z]` or `[À-Ö]` is an inclusive range over Unicode code
points; a range whose start code point is greater than its end code point does
not compile and is therefore a schema-load error. A negated class matches any
scalar value not listed, including a line feed.

Matching is case-sensitive and applies no case folding. No Unicode
normalization is applied to the pattern or to the subject before matching:
both are compared as the exact decoded scalar sequences the TOML parser
produced, consistent with the string rule under
[Parsed Value Equality](#parsed-value-equality). Two strings that are
canonically equivalent but differently composed are therefore distinct
subjects, and an implementation MUST NOT normalize either operand.

The pattern is not implicitly anchored. A value validates if the regular
expression matches anywhere in the string. Authors who require a full-string
match MUST anchor the expression with `^` and `$`.

Patterns are evaluated without multiline or dot-all modes. `^` matches only
the start of the complete parsed string, `$` matches only its end (not a
position before a final line feed), and `.` does not match a line feed. These
rules also apply when an implementation uses a regular-expression engine with
different defaults.

### Key Pattern - `keypattern`

This property may only be used on a `collection`. It constrains the **keys** (entry names) of the
collection's dynamic children: every dynamically keyed entry must match the provided regular
expression. It does not validate entry *values* — that is the role of `itemtype`. It is
therefore orthogonal to `itemtype` and may be combined with it.

`keypattern` is invalid on any non-`collection` type (scalars, `array`, plain
`table`), and a schema loader MUST reject a schema that uses it elsewhere.

Keys that are explicitly declared as fixed child definitions of the collection (schema-restricted
key-value pairs) are validated by their own definitions and are not subject to `keypattern`. Only
dynamic, user-provided keys are matched against the pattern.

Implementations MUST support the same portable RE2 regular-expression profile as
[`pattern`](#pattern---pattern), and every rule that section states about
regular expressions applies unchanged to `keypattern`: schema-load compilation,
rejection of uncompilable patterns and of constructs outside the portable
profile, Unicode scalar-value matching, character-class and range behavior,
case sensitivity, and the absence of Unicode normalization. The subject is the
decoded TOML key rather than a string value; keys are matched as the exact
decoded scalar sequences the TOML parser produced, so a quoted key and a bare
key that decode to the same characters are the same subject. Like `pattern`,
`keypattern` is not implicitly
anchored: a key validates if the regular expression matches anywhere in the key
string. Authors who require a full-key match MUST anchor the expression with
`^` and `$`.

**Example:**

```toml
[types.listOfServersType]
type       = "collection"
itemtype   = "types.serverType"
minlength  = 1
keypattern = "^server_[0-9]+$"
```

Against a TOML document:

```toml
[servers.server_01]   # accepted
[servers.server_02]   # accepted
[servers.alpha]       # rejected: key does not match ^server_[0-9]+$
```

This mirrors JSON Schema's `propertyNames: { pattern: ... }`, applied to TOML maps.

## Validation and Data Model

TOML Schema validation does not modify the parsed TOML data model.

A validator MUST NOT mutate, replace, or augment the TOML data object produced
by the underlying parser. An API that returns that object MUST return the same
parsed keys and values that would exist without schema validation.

Schema loading additionally requires source-shape information for inline-table
properties whose names may also name child definitions. In particular,
`default = { ... }`, `dependentrequired = { ... }`, and `if = { ... }` cannot be
distinguished
from same-named child tables by their logical TOML values alone. A schema loader
MUST use a parser that preserves key/value-versus-table syntax or exposes enough
source-position information to recover it; a logical-value-only TOML API is
insufficient for this distinction. Loaders MUST NOT guess from inline-table
member names.

### Parsed Value Equality

TOML Schema uses one equality relation for `allowedvalues` membership,
`uniqueitems`, and comparison of defaults contributed by composition. Equality
is defined over parsed TOML values:

- strings and booleans compare by value, without Unicode normalization;
- numeric values compare by mathematical value, so integer `1` equals float
  `1.0`, positive and negative zero are equal, and NaN equals NaN only for this
  equality relation;
- integer comparison remains exact across the full TOML signed 64-bit range,
  including comparison with a float, and implementations MUST NOT first round
  the integer to the float's binary format;
- temporal values require the same TOML temporal type and the same parsed
  fields, including the numeric UTC offset for an offset date-time; equivalent
  spellings such as `.1` and `.100` or `Z` and `+00:00` are equal, but offset
  date-times with different retained local fields or offsets are unequal even
  when they identify the same instant;
- arrays compare by length and equal values at every index; and
- tables compare by their unordered parsed key sets and recursively equal
  values. Source key order, table syntax, and lexical spelling do not
  participate.

This equality relation is distinct from the ordering used by `min` and `max`.
In particular, offset date-times that identify the same instant compare equal
for a range boundary but remain unequal here when their retained local fields
or offsets differ. Implementations MUST NOT reuse instant ordering as
`allowedvalues`, `uniqueitems`, or default-comparison equality.

### Expressiveness and Validation Scope

TOML Schema describes the parsed TOML value tree. It can model the structural
patterns used by major configuration formats, including:

- fixed keys and closed tables;
- open tables for extension-owned data;
- dynamic-key maps with uniform values by using `collection`;
- open namespaces with specially typed well-known keys by combining a
  `collection` with fixed child definitions;
- arrays of tables and arrays of inline tables by using a named table as an
  array's `itemtype`;
- scalar-or-table and other alternative representations with `oneof` or
  `anyof`;
- table shapes selected from a direct child's value with `if`, `then`, and
  `else`;
- standardized email, UUID, URI, host-name, and IP-address strings with
  `format`;
- single-table-or-array-of-table representations through named container
  alternatives;
- fixed-length heterogeneous arrays with `items`; and
- quoted, empty, or literal dotted keys through normal TOML key syntax.

The checked-in schemas under [`examples/`](examples/) exercise these patterns
against formats including [Cargo manifests](https://doc.rust-lang.org/cargo/reference/manifest.html),
Python [`pyproject.toml`](https://packaging.python.org/en/latest/specifications/pyproject-toml/),
Hugo, Netlify, GitLab Runner, and Cloudflare Wrangler.

Version 1.0 includes direct-sibling value conditionals, direct-sibling presence
dependencies, at-most-one and exactly-one groups, conjunctive reusable
composition, whole-item array uniqueness, defaults, and deprecation
annotations. These features remain deliberately bounded. Version 1.0 does not
define keywords for:

- following arbitrary document paths or comparing values at different paths;
- making a field absent precisely when its name appears in another array;
- selecting array uniqueness by one field rather than the complete item value;
- materializing defaults into parsed TOML data;
- overriding a constraint or modeling an application's runtime inheritance and
  merge precedence;
- importing, including, or otherwise referencing a definition in another schema
  document;
- closing a `collection` against unknown dynamic keys; or
- opening or dynamically keying the document root.

The last three are capabilities a reader may reasonably expect, so they are
stated explicitly rather than left to inference.

**No cross-file composition.** Version 1.0 defines no import, include, or
cross-document reference mechanism. Every named reference resolves within the
`[types]` table of the same schema document, as
[Types table](#types-table---types) requires, and the `location` metadata
described under
[TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema) binds one
TOML document to one schema document rather than assembling several. A shared
vocabulary must therefore be copied into each schema that needs it. This is a
deliberate boundary for 1.0: a cross-document reference mechanism also requires
retrieval, identity, caching, and trust rules for the referenced documents, and
those are out of scope for this version.

**No closed collection.** A `collection` is open to dynamic keys by
construction, as [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys)
states. `keypattern` constrains the shape of a dynamic key and `itemtype`
constrains its value, but no keyword fixes a collection's key set the way a
`table` with fixed children is closed. A schema that needs both dynamic entries
and a bounded key set must either enumerate the keys as fixed children of a
`table`, which gives up dynamic keying, or make the dynamic-entry rule
unsatisfiable so that only the fixed children remain acceptable. The companion
[`toml-schema.tosd`](toml-schema.tosd) uses the second technique, referencing a
`types.never` definition as an `itemtype` to emulate a closed collection. That
idiom works, but it is a workaround for a missing capability rather than a
language feature, and schema authors SHOULD prefer a closed `table` when the key
set really is fixed.

**No open or dynamically keyed root.** The `[elements]` table is a closed,
fixed-key table, as [Elements table](#elements-table---elements) requires. No
schema property applies to `[elements]` itself, so the root cannot be declared a
`collection`, cannot carry a `keypattern` or an `itemtype`, and cannot be left
open to arbitrary top-level keys. A document format whose top-level keys are
user-chosen cannot be described at the root in version 1.0; it can only be
described one level down, by declaring a top-level key whose definition is a
`collection`.

For example, a schema can choose a database configuration shape from a sibling
`engine` value. It still cannot compare values in different tables or follow an
arbitrary path from one location to another. A `pyproject.toml` schema can
require `project.dynamic` entries to be unique, but cannot require a field to
be absent precisely when its name appears in that array. Those cross-path
application policies require an additional semantic-validation pass.

Some configuration sections intentionally combine known fields with arbitrary
future or extension-owned fields. A `collection` with fixed child definitions
and `itemtype = "any"` models that forward-compatible shape, but unknown keys
cannot then be distinguished from misspellings. Schema authors SHOULD prefer a
closed `table` when the upstream format defines a stable, exhaustive key set.

Version 1.0 defines `default` and `deprecated`; examples and editor-specific
presentation hints remain outside the standard vocabulary.

Validation applies to parsed keys and values, not to their lexical spelling.
A schema cannot require dotted-key notation instead of table headers, an inline
table instead of a regular table, or a particular quoting, whitespace, or
comment style when those forms produce the same TOML value tree.

## Evaluation

This section defines the normative evaluation model: when each decision is made,
how a type reference resolves to a definition, which reference cycles are legal,
what validating one node against one definition produces, and how those results
combine. It uses the vocabulary fixed under [Terminology](#terminology) and the
diagnostic shape and codes fixed under [Diagnostics](#diagnostics).

The model is descriptive of required outcomes, not of implementation structure.
An implementation MAY use any strategy — eager, lazy, memoized, compiled —
provided it produces the results this section requires.

### Evaluation Phases

TOML Schema evaluation has exactly two phases. Every rule in this specification
belongs to one of them, and the phase a rule belongs to is normative because it
determines what information that rule is permitted to read. Schema discovery, the
optional step that locates a schema from a document's `[toml-schema]` table,
precedes both and is described under
[TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema).

#### Schema-Load Phase

The schema-load phase reads one TOML Schema document and nothing else. No
document being validated exists, and no rule in this phase may assume one. The
phase either produces a **loaded schema** or fails.

A schema loader MUST perform the following, and each step MUST be complete before
the steps that depend on it begin:

1. **Parse.** Parse the schema document as TOML, preserving
   key/value-versus-table source shape as required under
   [Validation and Data Model](#validation-and-data-model).
2. **Document shape.** Verify the top-level structure and reject any other
   top-level table or key/value pair, as required under
   [Top-level Structure Conditions](#top-level-structure-conditions).
3. **Language version.** Verify `[toml-schema].version` as required under
   [Schema Versioning](#schema-versioning). A schema whose version is unsupported
   MUST fail to load before any keyword is interpreted, because later steps depend
   on the recognized keyword set for that version.
4. **Keyword closure and applicability.** Reject any key/value pair inside a
   schema definition whose name is not a defined schema property, reject a
   recognized property applied to a definition that does not permit it, and reject
   combinations excluded by
   [Schema Definition Properties](#schema-definition-properties). This includes
   selector exclusivity: at most one of `type`, `oneof`, `anyof`, and the
   conditional triple, and at least one unless the definition is an implicit
   table or a [pure mixin](#composition-supplying-the-local-skeleton), both
   described under [Types table](#types-table---types). It also includes the
   exclusion between `items` and the
   [per-member value-constraint subset](#per-member-value-constraints) and the
   rejection of a per-member constraint that is also declared on the definition
   its `itemtype` resolves to. Every check in this step is local unless
   [Local and Effective Checks](#local-and-effective-checks) lists it as
   effective.
5. **Reference resolution.** Resolve every type reference in the document, as
   defined under [Reference Resolution](#reference-resolution). Every reference
   MUST resolve, including references inside definitions that are optional or that
   no document will exercise.
6. **Cycle classification.** Build the reference graph and reject illegal cycles,
   as defined under [The Reference Graph](#the-reference-graph). This step MUST
   precede every step that traverses references, so that those traversals
   terminate.
7. **Determinate analysis.** Compute the
   [determinate fixed-child set](#determinate-fixed-child-set) of every
   definition, and apply every rule that reads it: sibling-rule operand resolution
   and `exactlyone` applicability under
   [Sibling Presence Rules](#sibling-presence-rules), and the collection
   `itemtype` requirement under
   [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys).
8. **Composition determinacy.** Verify that every `allof` composition agrees on
   effective type, that no component is named twice, that no local union or
   conditional selector combined with `allof` is indeterminate, and that every
   pure mixin resolves to exactly one TOML kind, as required under
   [Conjunctive Composition](#conjunctive-composition---allof) and
   [Composition Supplying the Local Skeleton](#composition-supplying-the-local-skeleton).
9. **Single-definition consistency.** Apply the remaining schema-load consistency
   checks: `allowedvalues` entry kinds and their agreement with sibling
   constraints, `min` not greater than `max`, `minlength` not greater than
   `maxlength`, valid `format` names, compilable in-profile `pattern` and
   `keypattern` values as required under [Pattern](#pattern---pattern), and the
   validity of every declared `default` against its full effective definition as
   required under [Default](#default---default).

A schema-load failure is not a document diagnostic. When loading fails, a
validator MUST NOT validate any document against that schema and MUST NOT report
the failure as a document diagnostic; the phase distinction is normative under
[Diagnostics](#diagnostics).

A loaded schema is independent of any document. An implementation MAY cache and
reuse it, and validating a document MUST NOT change it.

#### Document-Validation Phase

The document-validation phase applies one loaded schema to one parsed TOML
document. Only this phase may read document values.

Validation MUST be deterministic: the same loaded schema and the same parsed
document MUST produce the same validity and the same set of errors, independent
of document key order, of the order in which alternatives are evaluated, and of
evaluation strategy. Validation MUST NOT modify the parsed document, as required
under [Validation and Data Model](#validation-and-data-model).

Validation begins with the document root. The root node is the parsed document's
root table, and its definition is `[elements]`, applied as a closed table under
the rules in [Elements table](#elements-table---elements). The reserved root
`[toml-schema]` table is excluded from application-data validation unless
`[elements.toml-schema]` is declared, as described under
[TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema).

A validator MUST NOT report a schema-load error during this phase. If a condition
that the schema-load phase is required to reject is discovered while validating,
the implementation's loader is non-conforming; a validator MUST NOT convert such
a condition into a document error.

### Reference Resolution

A type reference is a string. Resolution maps it either to a built-in type or to
one reusable definition in `[types]`, and it is performed entirely in the
schema-load phase.

#### Resolution Algorithm

Given a reference string `R` appearing in `type`, `itemtype`, `items`, `oneof`,
`anyof`, `allof`, `then`, or `else`, a schema loader MUST resolve it by the
following ordered steps. The first step that produces a result or an error
decides the outcome.

1. **Normalize.** If `R` begins with the literal characters `types.`, remove that
   prefix exactly once. Call the result `N`. Otherwise `N` is `R`. The prefix is
   never removed twice: the reference `"types.types.x"` normalizes to `types.x`,
   which no reusable type may be named, so it fails at step 4.
2. **Built-in names.** If `N` is one of the built-in type names `any`, `string`,
   `integer`, `float`, `boolean`, `offset-date-time`, `local-date-time`,
   `local-date`, `local-time`, `array`, `table`, or `collection`, then `R` denotes
   that built-in type. Built-in names take precedence over any other
   interpretation.
3. **Context restrictions on built-ins.** If step 2 selected `any` or
   `collection`, apply the context restrictions defined under
   [Type Reference Restrictions](#type-reference-restrictions). These
   restrictions are applied to the
   normalized name, so `"types.any"` and `"types.collection"` are restricted
   exactly as the bare spellings are. `then` and `else` accept no built-in at all,
   so any reference reaching step 2 from those properties is an error.
4. **Named definitions.** Otherwise `N` MUST name a direct child of `[types]`,
   compared against the exact decoded TOML key of that child. `N` is a whole name,
   never a path: a dot in `N` is an ordinary character, so
   `"types.network.endpoint"` and `"network.endpoint"` both name the single
   definition `[types."network.endpoint"]`.
5. **Unresolved.** If no such direct child exists, the reference is unresolved and
   the schema loader MUST reject the schema with `unresolved-reference`.

Two references are the **same reference** when they normalize to the same `N`.
This is the identity used by the duplicate-component rule under
[Conjunctive Composition](#conjunctive-composition---allof) and the
distinct-alternative rule under
[Alternative Types](#alternative-types---oneof-and-anyof).

#### Built-in Names Are Reserved

Because normalization happens before lookup and built-in names are tested first,
`type = "types.string"` denotes the built-in `string`. It is a redundant but valid
spelling of `type = "string"`, and a schema loader MUST NOT reject it. This is the
only defensible resolution: [Types table](#types-table---types) already forbids a
reusable definition from being named `string`, so the competing reading — treat
`types.string` as a lookup for a user-defined type named `string` — could never
resolve to anything and would make a valid schema fail for no expressible reason.
Because the resolved reference is a built-in and not a named reference, the
sibling-property restriction that
[Type Reference](#type-reference) places on named references does not apply to it.

Authors SHOULD spell a built-in bare. The `types.` prefix exists to make a
reference to a reusable definition visually unambiguous; it grants no separate
namespace and cannot be used to reach a user-defined type whose name collides with
a built-in, because no such type can be declared.

```toml
[types.port]
type = "integer"
min = 1
max = 65535

[elements.retries]
type = "types.integer"   # valid; identical to type = "integer"

[elements.port]
type = "types.port"
```

The following is invalid, because a reusable definition MUST NOT take a reserved
built-in name:

```toml
[types.string]           # invalid: reserved built-in name
type = "string"
```

### The Reference Graph

The **reference graph** of a loaded schema has one vertex per definition — every
direct or nested child of `[types]` and of `[elements]` — and one edge per
reference from a definition to the definition or built-in it names. Built-in
types are terminal vertices with no outgoing edges.

#### Consuming and Non-Consuming Edges

Every edge is exactly one of two kinds. The distinction is whether following the
edge requires descending into a nested document value.

A **non-consuming edge** is traversed immediately, against the same document node.
Determining the node's effective definition requires following it. Non-consuming
edges are:

- `type`, when it names a reusable definition (aliasing);
- each entry of `oneof` and of `anyof`;
- `then` and `else`;
- each component of `allof`.

A **consuming edge** is traversed only after descending to a nested document node,
and that node may or may not exist. Traversal is therefore deferred until a
document value is present. Consuming edges are:

- a nested child definition of a `table` or `collection`, including one written
  through the reserved `children` namespace;
- `itemtype` on an `array`, applied to each item;
- `itemtype` on a `collection`, applied to each dynamic entry;
- each entry of `items`, applied to one array position.

#### Cycle Legality

A cycle in the reference graph is legal or illegal according to the edges it
contains, and a schema loader MUST decide this at schema-load time.

- A cycle composed **entirely of non-consuming edges** is unsatisfiable: computing
  the effective definition of any vertex on it requires computing its own
  effective definition first, and no document value is consumed to make progress.
  Schema loaders MUST reject it with `cyclic-reference`.
- A cycle that passes through **at least one consuming edge** is legal. It
  describes a recursive document structure: each traversal of the cycle requires
  one more level of nesting in the document, and a finite document terminates the
  recursion.

The rule for non-consuming cycles is deliberately conservative for `oneof` and
`anyof`: a cycle through a union alternative is rejected even when a sibling
alternative is terminal. Selecting the alternative to try is a schema-structural
decision, and a self-referential alternative offers no document value to consume
when it is tried.

A legal recursive structure. The cycle from `types.node` back to `types.node`
passes through the consuming edge `itemtype`, so each level of recursion consumes
one more array item:

```toml
[types.node]
type = "table"

    [types.node.name]
    type = "string"

    [types.node.subnodes]
    type = "array"
    itemtype = "types.node"
    optional = true

[elements.tree]
type = "types.node"
```

An illegal cycle. Both edges are `type` aliases, so neither definition can ever be
reduced to a concrete one, and a schema loader MUST reject this schema:

```toml
[types.a]
type = "types.b"   # invalid

[types.b]
type = "types.a"   # invalid
```

The same rejection applies to a cycle through `oneof`, `anyof`, `then`, `else`,
`allof`, or any mixture of them, and to a self-edge such as `[types.a]` with
`type = "types.a"`.

### The Validation Contract

#### Results

Validating one node against one definition produces a **result** with four parts:

- a validity verdict, valid or invalid;
- **errors**, zero or more diagnostics that determine invalidity;
- **warnings**, zero or more diagnostics that do not affect validity; and
- **annotations**, zero or more non-diagnostic values that an implementation MAY
  surface, such as the effective `default` of a slot.

A result is valid when its error list is empty and invalid otherwise. Diagnostics
carry the phase, severity, code, instance path, and schema path required by
[Diagnostics](#diagnostics).

Results **combine** associatively: the combination is valid when every combined
result is valid, and its errors, warnings, and annotations are the concatenation
of the combined ones, deduplicated under the identity
[Diagnostics](#diagnostics) defines. Every rule below that says results combine
means this operation.

#### The Unit of Validation

The unit of validation is one **node** — one parsed TOML value at one instance
path — paired with one effective definition. It is written
`validate(node, definition)`.

`validate` is defined only for a node that exists. Whether a node has to exist is
a property of its **slot**, not of the node, and is decided by the parent as
described next. Keys are never validated by `validate`: a key is validated by the
node that contains it, through unknown-key classification for a `table` and
through `keypattern` for a `collection`'s dynamic entries.

`validate` MUST be a pure function of the loaded schema and the node's parsed
value. It MUST NOT depend on the node's position among its siblings, on the order
in which nodes are visited, or on results computed for unrelated nodes.

#### Slot Evaluation

Before descending into a fixed child, a validator evaluates the slot:

1. Determine the slot's effective optionality, inheriting through the named `type`
   reference chain as required under [Optionality](#optionality---optional).
2. If the corresponding key is absent from the parsed parent and the slot is
   optional, the slot produces an empty valid result. No assertion, annotation, or
   deprecation warning is produced for an absent optional slot.
3. If the key is absent and the slot is required, the slot produces one
   `missing-required` error at the child's instance path and no descent occurs.
4. If the key is present, the slot's result is
   `validate(child node, child definition)`.

#### Keyword Evaluation Order

For a present node `N` and definition `D`, a validator MUST evaluate in the
following order. The order is normative because each group either depends on the
groups before it or governs which diagnostics the groups after it may produce.

1. **Effective definition.** Follow `D`'s `type` reference chain and merge `D`
   with every `allof` component into the effective definition, as required under
   [The Effective Definition](#the-effective-definition). A validator MUST NOT
   validate `N` separately against `D` and against each component.
2. **Kind check.** Determine the effective type. When the selector is `type` or
   the conditional triple, `N`'s TOML kind MUST match the coarse category of that
   effective type; `any` selects no category and imposes no restriction. A
   mismatch produces exactly one `type-mismatch` error, and the validator MUST NOT
   evaluate any group below, MUST NOT descend into `N`, and MUST NOT apply sibling
   rules. When the selector is `oneof` or `anyof`, the kind check belongs to each
   alternative and is performed in group 3.
3. **Alternative and branch selection.** For the conditional triple, evaluate `if`
   against `N` — the condition is false when the named direct child is absent, and
   otherwise compares by [Parsed Value Equality](#parsed-value-equality) — and
   evaluate only the selected branch, as required under
   [Conditional Selection](#conditional-selection---if-then-and-else). For `oneof`
   and `anyof`, evaluate each alternative. In both cases the alternative or branch
   is evaluated as the effective definition formed from it together with the local
   definition's `allof` components, and its fixed children join `N`'s
   [effective closure set](#effective-closure-set) for that evaluation. Results are
   combined as required under
   [Alternative and Branch Commit and Discard](#alternative-and-branch-commit-and-discard).
4. **Value assertions.** Evaluate every assertion that applies to `N`'s own value:
   `format`, `pattern`, `minlength`, `maxlength`, `uniqueitems`, and, for a scalar
   or temporal node, `min` and `max`. Every such assertion is evaluated; none gates
   another, and a failure of one does not suppress another. On an `array` or a
   `collection`, `format`, `pattern`, `min`, and `max` are
   [per-member assertions](#per-member-value-constraints) and belong to group 6,
   while `minlength` and `maxlength` remain assertions on the container itself
   and are evaluated here.
5. **Allowed values.** Evaluate `allowedvalues` membership. Groups 2, 4, and 5 of
   this list are the general-case statement of the ordering that
   [Allowed Values](#allowed-values---allowedvalues) fixes for enumerations, and
   that section is authoritative: membership is evaluated after the kind check and
   after every other applicable assertion, and never instead of either.
6. **Structural application.** Apply the node's structure and descend:
   - **table** — form the [effective closure set](#effective-closure-set), then
     evaluate every fixed-child slot as described under
     [Slot Evaluation](#slot-evaluation) and report every document key outside that
     set as an `unknown-key` error, as required under [Tables](#tables);
   - **collection** — classify every document key against the effective closure
     set; fixed children take precedence and are evaluated as slots; every
     remaining key is a dynamic entry whose key MUST satisfy every applicable
     `keypattern` and whose value MUST validate against every applicable
     `itemtype`, as required under
     [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys).
     Every per-member `allowedvalues`, `min`, `max`, `pattern`, and `format`
     declared on the collection applies to each dynamic entry's value.
     A collection never produces an `unknown-key` error;
   - **array** — with `items`, check arity first and then validate each position;
     with `itemtype`, validate every item; with neither, items are unconstrained.
     Per-member `allowedvalues`, `min`, `max`, `pattern`, and `format` apply to
     each item.

   Each descent is itself a `validate` call and MUST apply groups 1 through 8 to
   the nested node. Results from descent combine into `N`'s result.
7. **Sibling presence rules.** Evaluate `dependentrequired`, `mutuallyexclusive`,
   and `exactlyone` against the parsed key presence of `N`, as required under
   [Sibling Presence Rules](#sibling-presence-rules). They inspect presence only,
   so a validator MUST evaluate them regardless of whether the corresponding child
   values validated, and MUST resolve their operands against the
   [determinate fixed-child set](#determinate-fixed-child-set) computed at
   schema-load time.
8. **Annotations.** If groups 2 through 7 produced no error for `N`, emit the
   `deprecated` warning when the effective definition is deprecated, and expose the
   effective `default` as an annotation. When `N`'s result is invalid, a validator
   MUST NOT emit its deprecation warning; the warning describes a value that
   validated, as required under [Deprecation](#deprecation---deprecated). A
   deprecated parent emits one warning at the parent's instance path and never one
   per descendant.

#### Error Reporting Completeness

Validity MUST NOT depend on a validator's reporting strategy. A validator MAY stop
at the first error, and it SHOULD report every independent error it can determine,
as [Aggregation, Ordering, and Branch Diagnostics](#aggregation-ordering-and-branch-diagnostics)
describes.

Whatever the strategy:

- an invalid document MUST produce at least one error;
- every reported error MUST be an error that complete evaluation would also
  produce, so a short-circuiting validator reports a subset and never an additional
  or different error; and
- the **mandatory suppressions** below are not a reporting strategy. They are
  normative, and a validator that reports all errors MUST still suppress them, so
  that two complete implementations report the same errors.

The mandatory suppressions are:

1. a kind mismatch suppresses every group below the kind check for that node, as
   required in group 2 above;
2. an absent optional slot produces nothing;
3. a missing required slot produces one `missing-required` error and no descent;
4. an `unknown-key` error produces no value validation for that key, because no
   definition applies to it;
5. a tuple arity mismatch produces one `tuple-length` error; positions present in
   both the document array and `items` are still validated, and no diagnostic is
   produced for a position that exists in only one of them; and
6. diagnostics produced inside a discarded alternative or branch are suppressed
   entirely, as required under
   [Alternative and Branch Commit and Discard](#alternative-and-branch-commit-and-discard).

#### Combining Results

- **`allof`** does not combine results. Components are merged into one effective
  definition before validation, and the node is validated once against that
  definition. Errors therefore describe the composed shape, never a per-component
  evaluation. See [The Effective Definition](#the-effective-definition).
- **`oneof`** is valid when exactly one alternative's result is valid. **`anyof`**
  is valid when at least one alternative's result is valid. See
  [Alternative and Branch Commit and Discard](#alternative-and-branch-commit-and-discard)
  for what happens to their diagnostics.
- **`if`/`then`/`else`** evaluates exactly one branch, and that branch's result is
  the node's result for the branch. The branch that was not selected is never
  evaluated, and the condition itself produces no diagnostic.
- **`itemtype`** combines the results of every item or dynamic entry. The container
  is valid only when every member is valid, and member errors carry the member's
  instance path.
- **`items`** combines the arity check with the result of every validated position.
- **`collection`** combines the results of its fixed-child slots with the results
  of its dynamic entries, including `keypattern` failures on keys.

In every case the container's own assertions and its members' results combine: a
node is valid only when its own assertions hold and every node below it is valid.

### Alternative and Branch Commit and Discard

One rule governs both a `oneof` or `anyof` **alternative** and a `then` or `else`
**branch** of the conditional triple, so this subsection states it once for both.

An alternative or branch is evaluated **speculatively**. It is **committed** when
its diagnostics and annotations become part of the node's result, and
**discarded** when they do not.

Speculative evaluation MUST be free of side effects. A discarded alternative or
branch MUST NOT contribute to the node's
[effective closure set](#effective-closure-set), MUST NOT influence how the node's
keys are classified for the committed one, and MUST NOT leave any diagnostic in
the node's result. A validator that accumulates diagnostics into a shared buffer
MUST scope that buffer to the alternative or branch being evaluated.

The rules are:

1. **`oneof`, exactly one successful alternative.** The node is valid. That
   alternative is committed: its warnings and annotations surface, including its
   `deprecated` warning. Every other alternative is discarded.
2. **`anyof`, at least one successful alternative.** The node is valid. Every
   successful alternative is committed, and their warnings and annotations are
   deduplicated under the identity [Diagnostics](#diagnostics) defines. A
   deprecated successful alternative therefore contributes a warning even when
   another successful alternative is not deprecated. Failed alternatives are
   discarded. This is the successful-alternative rule stated under
   [Alternative Types](#alternative-types---oneof-and-anyof), which is
   authoritative for which annotations an alternative contributes.
3. **No successful alternative.** The node is invalid. Every alternative is
   discarded, and the validator MUST report the failure on the union node itself:
   `oneof` for a `oneof` definition and `anyof` for an `anyof` definition. A
   validator MAY attach the discarded alternatives' errors as subordinate
   explanatory detail of that node-level error — this is often the most useful
   diagnostic a user can get — but MUST NOT surface them as independent top-level
   errors, and MUST NOT report any warning or annotation from a failed
   alternative.
4. **`oneof`, more than one successful alternative.** The node is invalid, because
   `oneof` requires exactly one match. The validator MUST report the failure on the
   union node itself with the code `oneof`, and every alternative is discarded, so
   no successful alternative's warning or annotation surfaces.
5. **Conditional triple.** No discard occurs. The condition selects one branch,
   only that branch is evaluated, and its result is committed unconditionally —
   including its errors when it fails. The unselected branch is never evaluated, so
   it can produce nothing to discard.

One exception to rule 3 is already defined by this specification and is the only
diagnostic permitted to escape a discarded alternative: when no alternative
matches, a document key that belongs to the effective closure set of no candidate
could not have been accepted by any of them, and an implementation MAY report it
as an `unknown-key` error on the node in addition to, or instead of, the union's
failure, as permitted under [Effective Closure Set](#effective-closure-set). No
other alternative-local or branch-local diagnostic may be promoted this way in
version 1.0.

Because selection also selects the selected definition's fixed children,
discarding is what keeps composition sound. In the following schema, `types.named`
and `types.labelled` each declare a key the other rejects:

```toml
[types.base]
type = "table"

    [types.base.id]
    type = "integer"

[types.named]
type = "table"

    [types.named.name]
    type = "string"

[types.labelled]
type = "table"

    [types.labelled.label]
    type = "string"

[types.identity]
oneof = [ "types.named", "types.labelled" ]

[elements.item]
type = "table"
allof = [ "types.base", "types.identity" ]
```

For the document node `{ id = 1, name = "a" }`, the `types.labelled` alternative
produces an `unknown-key` error for `name` and a `missing-required` error for
`label`. Both are discarded, because `types.named` succeeded and committed.
Reporting the discarded alternative's errors would make every valid variant table
look invalid.

For the document node `{ id = 1, other = true }` no alternative succeeds, so the
node is invalid. `other` belongs to no candidate's effective closure set, so a
validator MAY report it as an `unknown-key` error under the exception above, in
addition to or instead of the union's failure.

## Diagnostics

An implementation produces **diagnostics** while discovering a schema, while
loading a schema, and while validating a document. This section defines the
diagnostic record, the two severities, the instance-path and schema-path
encodings, aggregation and branch-reporting rules, and the stable code registry.
It is authoritative for every diagnostic code, severity, and path this
specification names.

Human-readable messages, output formatting, locale, and additional
implementation fields are **presentation**. They are not a conformance target.
Implementations MUST NOT be compared, and MUST NOT compare themselves, by message
text. Conformance is judged on phase, severity, code, instance path, schema path,
and the validity result.

### Phases

Every diagnostic belongs to exactly one phase:

- **discovery** — resolving a schema from a document's `[toml-schema]` table,
  including URI policy and retrieval;
- **schema-load** — parsing a schema document and applying every schema-load rule
  in this specification, including self-schema validation and reference-aware
  checks, as enumerated under [Schema-Load Phase](#schema-load-phase);
- **validation** — applying a successfully loaded schema to a TOML document, as
  described under [Document-Validation Phase](#document-validation-phase).

Implementations MUST distinguish the three phases. A discovery or schema-load
**error** prevents validation from starting: there is no validity result for the
document. A discovery **warning** does not prevent validation.
`resource-limit-exceeded` may be produced in any phase; if it is produced during
validation, the document MUST be reported as not successfully validated even when
no constraint had yet failed, as required by
[Security Considerations](#security-considerations).

TOML parse failures of the document or of the schema source are parser errors, not
TOML Schema diagnostics. An implementation SHOULD surface them as such and MUST
NOT assign them a registry code.

### Diagnostic Record

A diagnostic has these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `phase` | MUST | `discovery`, `schema-load`, or `validation` |
| `severity` | MUST | `error` or `warning` |
| `code` | MUST | a registry code or a namespaced extension code |
| `instance_path` | MUST for validation; MUST NOT for discovery and schema-load, except `resource-limit-exceeded` produced during validation | where in the **document** the condition was observed |
| `schema_path` | MUST when the condition is attributable to a location in a schema document | where in the **schema** the failing rule is declared |
| `message` | MUST | human-readable text; content is implementation-defined |

An implementation MAY add fields such as source line and column, a keyword name,
or nested `causes`. Nested causes are presentation. They MUST NOT affect validity
and MUST NOT be counted as additional result diagnostics unless they would
independently satisfy this section as committed diagnostics.

A **validation result** contains zero or more diagnostics. The document is
**valid** if and only if the result contains no diagnostic of severity `error`.
Warnings do not affect validity. Implementations MUST provide separate access to
errors and warnings. A command-line validator MUST exit successfully when the
document is valid, including when the only diagnostics are warnings.

### Severity

This version defines two severities.

**error.** The condition makes the input unusable for the phase that detected it.
A discovery or schema-load error means no schema is loaded. A validation error
means the document is invalid.

**warning.** The condition is reported and the phase continues. The only
validation warning defined by this version is `deprecated`. The only discovery
warning defined by this version is `version-mismatch`. Schema-load produces no
warnings in this version: a malformed schema is an error.

Normative assignment:

- A present node whose effective definition is deprecated MUST produce a
  `deprecated` warning and MUST NOT, by deprecation alone, produce an error. An
  absent optional slot MUST produce no deprecation warning. A deprecated parent
  produces one warning at the parent's instance path, not one warning per
  descendant. These rules are those of
  [Deprecation](#deprecation---deprecated) and [Annotations](#annotations); this
  section only names the diagnostic.
- A referencing document whose `[toml-schema].version` differs from the loaded
  schema's language version without a major-version incompatibility MUST produce a
  `version-mismatch` warning and MUST NOT, by that mismatch alone, fail discovery
  or validation, as required by
  [TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema).
- Every other condition in the registry is an error.
- `resource-limit-exceeded` is always an error.

### Instance Path

An **instance path** identifies a node in the parsed TOML document. The grammar is
a restricted JSONPath-like dotted form. It is not JSONPath: there are no filters,
slices, wildcards, or descendant segments.

- The root document table is `$`.
- A table or collection child whose decoded key *K* is appended as `.` followed by
  `EncodeKey(K)`.
- An array element at zero-based index *i* is appended as `[`, the decimal digits
  of *i* with no sign and no leading zeros except for `0` itself, and `]`. There is
  no dot before `[`.

`EncodeKey(K)`:

- If *K* is non-empty and every Unicode scalar value in *K* is an ASCII letter,
  digit, `_`, or `-`, *K* is written literally.
- Otherwise *K* is written as a JSON string per RFC 8259: surrounded by `"`, with
  `"` and `\` escaped, with `U+0008`, `U+0009`, `U+000A`, `U+000C`, and `U+000D`
  escaped as `\b`, `\t`, `\n`, `\f`, and `\r`, and with every other
  `U+0000`-`U+001F` scalar escaped as `\u00XX`.

Examples:

| Document node | Instance path |
| --- | --- |
| the document root | `$` |
| top-level key `host` | `$.host` |
| `composed.host` | `$.composed.host` |
| index `0` of `direct` | `$.direct[0]` |
| key `google.com` under `site` | `$.site."google.com"` |
| the empty key at the root | `$.""` |
| key `children` under `parent` | `$.parent.children` |

The reserved `children` escape namespace is a schema-document spelling. It is
never a segment of an instance path. A child declared as
`[elements.plugin.children.type]` is instance path `$.plugin.type`.

The reserved root `[toml-schema]` table of a target document is not an
application-data node unless `[elements.toml-schema]` is present. When it is
ignored during application-data validation, implementations MUST NOT emit instance
paths under `$.toml-schema` for ordinary unknown-key or requiredness rules.

Instance paths use decoded TOML keys, not lexical spellings. Dotted keys, quoted
keys, table headers, and inline tables that produce the same parsed node have the
same path, consistent with [Parsed Value Equality](#parsed-value-equality).

### Schema Path

A **schema path** identifies a node in the parsed schema document with the same
encoding algorithm as an instance path, applied to the schema's value tree, also
starting at `$`.

Typical prefixes are `$.toml-schema`, `$.elements`, and `$.types`. A schema
property written as a key/value pair on a definition is a final path segment named
after that property. A child definition's path is that child's table. When a child
is written through the reserved `children` namespace, the schema path includes the
`children` segment and the instance path does not.

Examples:

| Schema location | Schema path |
| --- | --- |
| unrecognized property `patttern` on `elements.port` | `$.elements.port.patttern` |
| reversed bounds on `elements.port` | `$.elements.port` |
| `min` on reusable `types.boundedInteger` | `$.types.boundedInteger.min` |
| escaped child `type` under `elements.plugin` | `$.elements.plugin.children.type` |
| `oneof` array on `elements.id` | `$.elements.id.oneof` |

When a named type reference is applied, the schema path of a failed assertion is
the location at which that assertion is declared, which is the referenced
definition when the constraint lives there, not the use site. The use site appears
in the schema path of failures of use-site annotations such as a local
`deprecated` or `optional`.

Discovery diagnostics whose condition is in the target document's `[toml-schema]`
table use that document as the schema-path tree for this purpose, so a missing
`location` is `$.toml-schema.location`. They still MUST NOT set `instance_path`;
discovery is not document validation.

### Aggregation, Ordering, and Branch Diagnostics

**Completeness.** A validator MAY stop after the first validation error
(fail-fast) or collect further errors. Stopping is a presentation and performance
choice. If it stops, it MUST have emitted at least one error that justifies
invalidity. A validator SHOULD, when it continues, report independent errors at
the same node — every unknown key, every missing required fixed child, and every
failed sibling-presence group — rather than only the first. The mandatory
suppressions under
[Error Reporting Completeness](#error-reporting-completeness) still apply.
Resource limits in [Security Considerations](#security-considerations) MAY
truncate the result; truncation MUST itself be reported as
`resource-limit-exceeded` and MUST NOT be presented as a complete successful
validation.

Schema-load and discovery MAY likewise stop at the first error. They SHOULD report
independent property errors on the same definition when doing so is cheap, for
example both an unrecognized property and an inapplicable one, but a single
schema-load error is sufficient to reject the schema.

**Order.** Diagnostic order is not significant for conformance. Two
implementations that emit the same set of
`(phase, severity, code, instance_path, schema_path)` tuples conform even if they
sort differently. Implementations SHOULD emit a stable order: pre-order of the
instance tree, and at a table, document source order when the parser preserves it.

**Validity.** Presence of any validation error makes the document invalid. Absence
of validation errors makes it valid, even when warnings are present.

**Unions (`oneof`, `anyof`).**
[Alternative and Branch Commit and Discard](#alternative-and-branch-commit-and-discard)
defines which alternatives are committed and which are discarded. This section
requires:

- Diagnostics produced while evaluating a **discarded** alternative MUST NOT
  appear in the validation result. This includes both errors and warnings. A naive
  validator that surfaces every alternative's inner failures floods the user with
  constraints that were never meant to apply and is not conforming.
- When `oneof` matches no alternative, or matches more than one, the validator
  MUST emit one error at the node's instance path with code `oneof`. When `anyof`
  matches no alternative, it MUST emit one error at the node's instance path with
  code `anyof`. Inner diagnostics of the unsuccessful alternatives stay discarded.
- When `oneof` matches exactly one alternative, that alternative is committed: its
  warnings are result diagnostics. A successful match has no errors.
- When `anyof` matches one or more alternatives, every successful alternative is
  committed for annotation purposes, and the warnings of every successful
  alternative are result diagnostics.
- An implementation MAY attach discarded diagnostics as nested `causes` on the
  union-level error. Nested causes are presentation.
- As already permitted under
  [Effective Closure Set](#effective-closure-set), when no alternative matches, an
  implementation MAY also emit `unknown-key` for a document key that belongs to no
  candidate's effective closure set, in addition to the union-level error. It MUST
  NOT emit `unknown-key` for a key that some candidate would have accepted.

**Conditionals (`if` / `then` / `else`).** The condition itself emits no validation
diagnostic. Only the selected branch is committed. Diagnostics of the unselected
branch MUST NOT appear in the result. There is no wrapper `conditional` validation
code: a selected branch that rejects the node produces that branch's ordinary
codes (`type-mismatch`, `unknown-key`, `missing-required`, constraint codes, and
so on) as if the branch were the node's definition.

**`allof`.** Validation is against the effective definition, not against each
component in isolation. Mixin composition MUST NOT produce `unknown-key` errors
for fixed children contributed by other participants. When several participants
contribute assertions that independently reject the same value, each assertion MAY
produce a diagnostic at its own schema path. Diagnostics that share code, instance
path, and schema path MUST be emitted once.

**Deduplication.** The identity of a diagnostic for deduplication is
`(code, instance_path, schema_path)`. Message text does not participate.
Implementations MUST drop duplicates under this identity, including duplicate
`deprecated` warnings contributed by multiple successful `anyof` alternatives or
multiple `allof` participants. An absent path field compares equal to another
absent path field.

### Extensibility

Codes in the registry are lowercase ASCII letters, digits, and hyphens, and they
do not contain `.`. This version's set is closed.

A future MINOR or PATCH revision of this specification MAY add codes in that
unprefixed namespace. Implementations MUST treat an unrecognized unprefixed code
emitted by a newer validator as an unknown standard code, not as an error in the
diagnostic itself.

Implementations MAY emit additional codes for implementation-specific checks.
Every such code MUST begin with `x-`, followed by an implementation token of
`[a-z][a-z0-9]*`, a hyphen, and a name, for example `x-tosd-internal`. Extension
codes MUST NOT collide with the unprefixed registry. Consumers that do not
recognize an extension code MUST still honor its severity for validity and exit
status.

Implementations MUST NOT emit an unprefixed code that is not in this registry.

### Command-Line Exit Status

A command-line validator MUST use distinct exit statuses for the three outcomes
that callers need to tell apart:

- **0** — a schema was loaded and the document is valid (warnings permitted);
- **1** — a schema was loaded and the document is invalid;
- **2** — discovery or schema-load failed, or the invocation itself was unusable
  (usage, missing files, TOML parse failure of the schema).

The canonical `tosd` CLI uses this mapping. Other command-line validators SHOULD
match it. Library APIs have no exit status; they MUST still distinguish the
phases.

### Code Registry

Each code denotes one condition. Several document nodes may produce several
diagnostics with the same code. The message an implementation prints is not
specified here; the condition is.

Constraint failures are **subdivided by schema property**, not collapsed into a
single generic constraint code. One catch-all would be cheaper to implement and
useless to consume: an editor cannot highlight `min` versus `pattern`, and a CI
filter cannot ignore one family of failures. Per-property codes match the schema
property names and keep the registry small. `min` and `max` remain distinct
because "too small" and "too large" are different user actions; likewise
`minlength` and `maxlength`. There is no additional umbrella code, and an
implementation MUST NOT substitute one.

There is no `itemtype` validation code. A collection or array entry that fails its
item definition produces that definition's ordinary codes at the entry's instance
path. Collections never produce `unknown-key`; an unacceptable dynamic entry is a
`keypattern` failure or an item-definition failure, as required under
[Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys).

There is no `conditional` validation code and no `allof` validation code, for the
reasons given under
[Aggregation, Ordering, and Branch Diagnostics](#aggregation-ordering-and-branch-diagnostics).
Composition failures that make a schema malformed are schema-load codes; document
failures against the effective definition use the ordinary validation codes.

#### Discovery codes

| Code | Severity | Condition |
| --- | --- | --- |
| `discovery-missing-location` | error | Discovery was requested and the document has no usable `[toml-schema].location`. |
| `discovery-invalid-metadata` | error | `[toml-schema]` in the target document violates the scalar-only restriction, carries a malformed `version` or `location`, or is otherwise not schema-reference metadata. |
| `discovery-unresolved-location` | error | A relative `location` cannot be resolved because the document has no base URI, or the resolved reference is not a usable URI. |
| `schema-retrieval-refused` | error | Retrieval is disabled, or policy rejects the scheme, target, redirect, credentials, or filesystem path. Defined under [Schema Discovery and Retrieval](#schema-discovery-and-retrieval). |
| `schema-retrieval-failed` | error | An authorized retrieval does not yield a usable schema, including transport failure, redirect exhaustion, or an unusable response. Defined under [Schema Discovery and Retrieval](#schema-discovery-and-retrieval). |
| `version-mismatch` | warning | The document's `[toml-schema].version` and the loaded schema's language version differ without a major-version incompatibility. |
| `unsupported-version` | error | The document requests, or the schema declares, a language version the implementation must reject (unsupported major, greater minor, or `0.y.z`). Also a schema-load code when no discovery is involved. |

#### Schema-load codes

| Code | Severity | Condition |
| --- | --- | --- |
| `unrecognized-property` | error | A key/value pair written directly inside a schema definition is not one of the closed property set for this language version, for example `patttern`. |
| `inapplicable-property` | error | A recognized property appears on a definition to which this specification does not permit it, for example `pattern` on `integer`, `keypattern` on `table`, `minlength` on `boolean`, or a kind-specific constraint beside a named `type` reference. |
| `exclusive-properties` | error | Two properties that this specification makes mutually exclusive appear together: the selectors `type`, `oneof`, `anyof`, and `if`; `items` with `itemtype`, `minlength`, `maxlength`, or a member of the [per-member value-constraint subset](#per-member-value-constraints); the same per-member value constraint declared both inline on an `array` or `collection` and on the definition its `itemtype` resolves to; `if.equals` with `if.in`; or an incomplete `if`/`then`/`else` triple. |
| `unresolved-reference` | error | A type reference in `type`, `itemtype`, `items`, `oneof`, `anyof`, `allof`, `then`, or `else` does not name a built-in type or a definition in `[types]`, as defined under [Reference Resolution](#reference-resolution). |
| `duplicate-reference` | error | Two entries of `oneof`, `anyof`, or `allof` have the same resolved identity after the optional `types.` prefix is stripped, for example `"types.foo"` and `"foo"`. |
| `inverted-range` | error | `min` is greater than `max`, or `minlength` is greater than `maxlength`, under the ordering this specification defines for that pair. |
| `invalid-boundary` | error | A `min` or `max` value is not a valid boundary for the comparable kind: NaN, a temporal value of the wrong TOML temporal type, a non-numeric boundary on a numeric kind, or an infinite bound on an integer kind. |
| `indeterminate-operand` | error | A `dependentrequired`, `mutuallyexclusive`, or `exactlyone` operand does not name a member of the definition's [determinate fixed-child set](#determinate-fixed-child-set). |
| `invalid-pattern` | error | A `pattern` or `keypattern` cannot be compiled under the active profile, as required under [Pattern](#pattern---pattern). |
| `unsupported-pattern` | error | A `pattern` or `keypattern` uses syntax outside the portable profile without an explicitly enabled extension profile, as required under [Pattern](#pattern---pattern). |
| `cyclic-reference` | error | The reference graph contains a cycle classified as illegal under [Cycle Legality](#cycle-legality). Structural recursion through a consuming edge is not this code. |
| `incompatible-composition` | error | `allof` participants do not agree on effective type, a multi-kind local union is combined with `allof`, a `table` is composed with a `collection`, or a [pure mixin](#composition-supplying-the-local-skeleton) has no single determinate effective type. |
| `invalid-default` | error | A declared `default` does not validate against the full effective definition at schema-load time, or `allof` participants contribute unequal defaults with no local default. |
| `unsupported-version` | error | `[toml-schema].version` is missing, is not a SemVer string, is not a TOML Schema language version, or is not supported by the implementation. |
| `schema-malformed` | error | Any other schema-load failure required by this specification: missing `[toml-schema]` or `[elements]`, an empty `oneof`, `anyof`, `allof`, `allowedvalues`, or `items` array, a reserved type name, an invalid `children` escape entry, a non-boolean `deprecated`, and similar. Implementations SHOULD prefer a more specific code from this table when one applies. |
| `resource-limit-exceeded` | error | A configured limit was reached while loading. Also a discovery and validation code. |

#### Validation codes

| Code | Severity | Condition |
| --- | --- | --- |
| `unknown-key` | error | A document key of a closed table, including the document root, is not in the node's [effective closure set](#effective-closure-set). Never produced for a `collection` dynamic entry. |
| `missing-required` | error | A fixed child that is not optional is absent. The instance path is the missing child's path even though no node is there. |
| `type-mismatch` | error | The node's TOML kind does not match the coarse category of the effective type, including an array or collection entry whose value is not the item definition's kind. |
| `allowedvalues` | error | The node's parsed value is not a member of `allowedvalues` under [Parsed Value Equality](#parsed-value-equality). For a [per-member](#per-member-value-constraints) enumeration the instance path is the member that failed, `$.arr[i]` or `$.coll.key`. |
| `pattern` | error | A string does not match `pattern`. For a [per-member](#per-member-value-constraints) `pattern` the instance path is the member that failed, `$.arr[i]` or `$.coll.key`. |
| `format` | error | A string does not match the required `format`. For a [per-member](#per-member-value-constraints) `format` the instance path is the member that failed, `$.arr[i]` or `$.coll.key`. |
| `min` | error | A comparable value, or a comparable array item or collection entry, is less than `min`, or is NaN. The instance path is the value that failed, so an array item is `$.arr[i]` and a collection entry is `$.coll.key`. |
| `max` | error | A comparable value, or a comparable array item or collection entry, is greater than `max`, or is NaN. |
| `minlength` | error | A string, array, or collection is shorter than `minlength`. For a collection, length counts dynamic entries only. |
| `maxlength` | error | A string, array, or collection is longer than `maxlength`. |
| `uniqueitems` | error | An array with `uniqueitems = true` contains two items equal under [Parsed Value Equality](#parsed-value-equality). The instance path is the later duplicate, `$.arr[i]`. |
| `tuple-length` | error | An array validated by `items` does not have exactly that arity. The instance path is the array, not an index. Positions present in both the array and `items` are still validated and report their own codes at `$.arr[i]`; a position present in only one of them produces no additional diagnostic. |
| `keypattern` | error | A collection's dynamic entry key does not match `keypattern`. The instance path is the entry, `$.collection.key`. Fixed children are not subject to `keypattern`. |
| `oneof` | error | The number of matching `oneof` alternatives is not exactly one, that is zero matches or more than one. The instance path is the node whose type is being selected. |
| `anyof` | error | No `anyof` alternative matches. |
| `dependentrequired` | error | A trigger child is present and a listed dependent child is absent. The instance path is the missing dependent. |
| `mutuallyexclusive` | error | More than one member of a `mutuallyexclusive` group is present. The instance path is the parent table or collection. |
| `exactlyone` | error | An `exactlyone` group does not have exactly one present member. The instance path is the parent table or collection. |
| `deprecated` | warning | A present node is deprecated. An absent optional slot does not produce this code. |
| `resource-limit-exceeded` | error | A configured limit was reached during validation. The document is not successfully validated. |

### Informative examples

Unrecognized schema property, schema-load:

```text
phase:        schema-load
severity:     error
code:         unrecognized-property
schema_path:  $.elements.port.patttern
message:      (implementation-defined)
```

Closed-table misspelling, validation:

```text
phase:          validation
severity:       error
code:           unknown-key
instance_path:  $.item.bogus
schema_path:    $.elements.item
```

Deprecated present value, validation:

```text
phase:          validation
severity:       warning
code:           deprecated
instance_path:  $.legacy-timeout
schema_path:    $.elements.legacy-timeout.deprecated
```

These examples are not a serialization format. Implementations MAY print
diagnostics as text, JSON, or API objects, provided the normative fields are
available.

## Schema Self-Validation

The companion [`toml-schema.tosd`](toml-schema.tosd) is a TOML Schema document
that recursively validates schema-definition tables, including the schema
document itself. It models schema properties as fixed children and ordinary
target child definitions as dynamic collection entries. The
[`children`](#quoted-and-special-keys) namespace resolves the remaining TOML key
collision when one definition needs both a schema property and a target child
with the same name.

The self-schema validates property value shapes, selector mutual exclusivity —
that no more than one selector is declared, though not that at least one selector
is present — conditional completeness, tuple-versus-homogeneous array structure,
nested child applicability, string formats, sibling-rule structures, annotations,
and the selective `children` namespace.

Rules that require resolving the schema's reference graph cannot be expressed
that way and remain schema-load semantics:

 - reference existence and cycles;
 - effective `allof` compatibility;
 - conditional branch kinds;
 - the presence of the `if.key` discriminator in a branch's determinate
   fixed-child set;
 - collection `itemtype` inherited through composition;
 - defaults against effective types;
 - duplicate `oneof`, `anyof`, and `allof` entries after type-reference resolution;
 - allowed values against resolved constraints; and
 - sibling-rule operands against the determinate fixed-child set.

A second group of rules needs no reference graph but is still beyond what a
schema document can assert about a value, and so also remains schema-load
semantics:

 - `version` rejecting a major-version-zero value, which the Semantic Versioning
   `pattern` in the self-schema necessarily accepts;
 - rejecting a definition that declares no selector, no nested child definition,
   and no `allof`, which the self-schema accepts today because it cannot require
   that at least one of a selector, a nested child, or an `allof` be present;
 - `min` being less than or equal to `max`, `minlength` being less than or equal
   to `maxlength`, and a boundary's TOML kind agreeing with the type it
   constrains; and
 - `pattern` and `keypattern` values compiling at schema-load time and staying
   inside the portable regular-expression profile, as
   [Pattern](#pattern---pattern) requires.

Schema loading also depends on the source-form information required under
[Validation and Data Model](#validation-and-data-model). That information is what
lets a loader distinguish the inline-table properties `default`,
`dependentrequired`, and `if` from direct child tables with those names, and
validate the latter recursively.

A conforming implementation MUST apply both the self-schema validation and these
reference-aware and source-aware schema-load checks.

## Security Considerations

TOML documents and TOML Schema documents are both potentially untrusted inputs,
but they present different threats. The common case is a trusted, locally
selected schema validating an untrusted TOML document. In that case,
implementations MUST bound parsing, recursive structural validation,
collection-key matching, alternative evaluation, and diagnostics. An untrusted
schema additionally controls the reference graph, regular expressions,
annotations, defaults, and the work performed by schema loading. Implementations
accepting an untrusted schema MUST apply the self-schema and all reference-aware
and source-aware schema-load checks required under
[Schema Self-Validation](#schema-self-validation) before validation, and MUST
apply resource limits during those checks as well as during validation.

Schema values are data. An implementation MUST NOT execute or interpolate
`description`, `default`, `[toml-schema.meta]`, pattern text, type names, or any
other schema content as program code, shell input, a template, or a filesystem or
network operation. Loading an untrusted schema MUST NOT grant access to files,
environment variables, processes, plugins, or network resources beyond the access
separately authorized to retrieve the schema itself. Version 1.0 type references
are local references into the loaded schema's `[types]` table, as
[Reference Resolution](#reference-resolution) requires; resolving them MUST NOT
perform additional retrieval, and nothing in this section may be read as defining
a cross-file schema import.

### Schema Discovery and Retrieval

A `[toml-schema].location` is controlled by the TOML document being validated, as
described under
[TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema). Merely
parsing a document or observing that property MUST NOT cause retrieval.
Implementations SHOULD disable document-directed schema retrieval by default and
require the caller to opt in. Callers SHOULD be able to supply a trusted schema
directly instead of enabling discovery. Enabling discovery MUST NOT disable the
checks in this section.

An implementation that retrieves schemas MUST use an explicit URI-scheme
allowlist. The default allowlist SHOULD contain only `file` for explicitly
authorized local discovery and `https` for explicitly authorized remote
discovery. Other schemes, including `http`, MUST NOT be enabled without a caller
decision that names the scheme and accepts its security properties. A URI with a
scheme that is not allowlisted MUST produce a `schema-retrieval-refused` error. A
relative reference inherits the scheme and authority of its base after resolution
and is subject to the same policy. HTTPS retrieval MUST perform normal certificate
and host-name verification; certificate errors MUST NOT be ignored.

Remote discovery MUST enforce a target policy before connecting. Unless the caller
explicitly authorizes a specific internal target, implementations MUST reject
loopback, link-local, private-use, multicast, unspecified, and other non-public
network destinations. This check MUST cover literal addresses, every address
returned by name resolution, and the address of the connected peer, and MUST be
repeated for each redirect. Implementations SHOULD prevent DNS rebinding by
binding authorization to the addresses checked for the connection. These
requirements prevent an untrusted document from using schema discovery as
server-side request forgery to reach local services or cloud metadata endpoints.

Retrieval MUST NOT attach cookies, HTTP authentication, client certificates, proxy
credentials, ambient cloud identity, or other caller authority by default. A
caller MAY explicitly provide credentials for a specific origin. Credentials
authorized for one origin MUST NOT be forwarded to another origin, including
across a redirect, without separate explicit authorization. Implementations SHOULD
reject URI user-information unless the caller has explicitly permitted that
credential source, and MUST avoid including credentials in diagnostics.

Redirect following MUST be configurable and bounded. An implementation MUST either
reject redirects or enforce a finite redirect limit; the default limit SHOULD be
no greater than five. Before following each redirect, the implementation MUST
resolve the target and reapply the scheme, network-target, credential, and
resource policies in this section. A redirect to a disallowed target MUST produce
`schema-retrieval-refused`; exhausting the redirect limit MUST produce
`schema-retrieval-failed`. A redirect is a retrieval response and does not rewrite
the declared `location`.

Local schema discovery MUST be confined to a caller-authorized base directory. For
a relative `location`, resolution still begins at the referencing TOML document's
parent directory, but access MUST be refused unless the resulting schema is within
the authorized base. An absolute `file` URI is likewise subject to that base.
Implementations MUST reject encoded or decoded parent-traversal segments and MUST
normalize the path, resolve symbolic links or equivalent filesystem indirections,
and verify containment before opening the file. They SHOULD use filesystem
operations that prevent a link or path component from being replaced between
authorization and opening. A path that cannot be proven to remain within the base
MUST produce `schema-retrieval-refused`.

### Resource Limits

Implementations MUST enforce finite, configurable limits appropriate to their
environment. At minimum, limits MUST cover:

- the encoded and decoded size of a retrieved schema, including decompressed
  response data;
- the size, parse depth, and parsed-node count of the target TOML document;
- retrieval duration, including name resolution, connection establishment,
  redirects, and response reading;
- schema parse depth and size, the number of definitions and references,
  reference-resolution work, and regular-expression length and compilation
  resources;
- recursion depth and total work while resolving the reference graph and applying
  the required [`toml-schema.tosd`](toml-schema.tosd) self-schema;
- recursion depth and total work while validating nested tables, collections,
  arrays, structural recursion, `allof`, `oneof`, `anyof`, and conditional
  branches; and
- the number and aggregate size of validation diagnostics retained or emitted.

Limits MUST be active before work begins and MUST apply cumulatively to a single
schema-load or validation operation; dividing input among nested definitions or
speculatively evaluated alternatives MUST NOT reset them. Implementations SHOULD
expose limits to callers and SHOULD choose conservative defaults for
network-facing and editor integrations. They MAY stop evaluating after the
diagnostic limit is reached, but MUST indicate that diagnostics were truncated and
that validation did not complete.

Reaching any limit MUST terminate the affected operation with a
`resource-limit-exceeded` error. A schema whose loading or self-validation exceeds
a limit MUST remain unloaded. A document whose validation exceeds a limit MUST be
reported as not successfully validated, even if no constraint violation had been
found before the limit was reached.

### Regular-Expression Safety

[Pattern](#pattern---pattern) defines the portable regular-expression profile for
`pattern` and `keypattern`, requires every expression to be compiled at
schema-load time, and confines out-of-profile constructs to an explicitly enabled
extension profile. That profile is based on RE2 syntax so that matching can be
implemented without backtracking and with time linear in the parsed string or key
length. This section adds the engine and failure requirements that make that
property real.

Restricting syntax alone is insufficient if the host engine applies a backtracking
algorithm to otherwise portable expressions. Implementations MUST evaluate
portable patterns with an RE2-equivalent non-backtracking engine or mode that
provides the same worst-case linear-time matching property. An implementation
whose host engine cannot provide that property MUST use a separate safe engine; it
MUST NOT pass untrusted patterns and values directly to a potentially exponential
backtracking matcher.

An expression that cannot be compiled MUST fail schema loading with
`invalid-pattern`, and an out-of-profile expression accepted by no enabled
extension profile MUST fail schema loading with `unsupported-pattern`. An enabled
extension profile MUST still provide a documented worst-case execution bound and
MUST remain subject to pattern-length, compilation-time, memory, and match-time
limits. Pattern compilation or profile errors MUST NOT be deferred until a
document value or dynamic key happens to exercise the pattern.

### Safe Failure

Security policy is part of the validation outcome, not an advisory. Any refusal or
incomplete operation required by this section MUST be surfaced as an explicit
error through the diagnostic model defined under [Diagnostics](#diagnostics). An
implementation MUST NOT substitute an empty schema, skip the refused check,
suppress a limit error, fall back from a rejected URI to a local path, or report
successful validation when schema discovery, schema loading, self-validation,
reference resolution, or document validation did not complete.

## Filename Extension

TOML Schema files MUST use the extension `.tosd`.

## MIME Type

TOML Schema documents are valid TOML documents. When transferring them over
the internet, implementations SHOULD use the registered TOML media type:

 - `application/toml`

## TOML Reference of a TOML Schema

A TOML file can include this indication to reference which schema file to use for validation:

```toml
[toml-schema]
location = "<uri>"
version = "1.0.0" # optional
```

`location` identifies the schema document. It is REQUIRED when a validator is asked to discover a schema from the TOML document. Its value MUST be a non-empty string containing either an absolute URI, such as an HTTPS URL, or a relative URI reference, such as a local schema filename.

An absolute `location` MUST be used unchanged. That requirement governs URI
resolution and identity only: the declared absolute URI is the schema's identity
and MUST NOT be rewritten, re-based, or reinterpreted before use. It is not an
authorization to retrieve. Whether the resolved URI may be retrieved at all is
decided by the retrieval policy required under
[Schema Discovery and Retrieval](#schema-discovery-and-retrieval), which MAY
refuse it. A relative `location` MUST be resolved against the referencing TOML document's location, not against the validator's current working directory or the resolved schema's location. For a TOML document stored in a local file, this means resolving a relative location from the document's parent directory.

A validator that receives a TOML document without a base location, for example through standard input, cannot resolve a relative `location`. It MUST either obtain an explicit base URI from the caller or report that schema discovery failed. An absolute `location` does not require a document base. Implementations MAY limit the URI schemes they can retrieve, but MUST report an unsupported scheme rather than reinterpret its value as a relative local path.

An implementation that supports the `file` scheme MUST require a hierarchical
file URI that can be converted to a local path, such as
`file:///schemas/config.tosd`. It MUST reject an opaque URI such as
`file:schema.tosd` rather than reinterpret it as a path relative to the TOML
document. A file URI with a query or fragment MUST also be rejected because
those components are not part of the local filesystem path.

`version` is OPTIONAL. When present, it denotes the expected TOML Schema
**language version** in the resolved schema document's
`[toml-schema].version`; it is not an application version or an author-defined
revision of that schema. Its value MUST be a string containing a complete
Semantic Versioning 2.0.0 value: the `MAJOR.MINOR.PATCH` core is required, and
valid pre-release and build suffixes are optional, as defined by
[Schema Versioning](#schema-versioning).

After resolving and loading the schema, a validator MUST compare these two language versions when the referencing document provides `version`. A different major version is incompatible and schema discovery MUST fail with `unsupported-version`. Any other unequal version, including a minor, patch, pre-release, or build metadata difference, MUST produce a `version-mismatch` warning but MUST NOT by itself cause validation to fail. Compatibility between the resolved schema and the validator remains governed by [Schema Versioning](#schema-versioning).

In a target TOML document, the root `[toml-schema]` table is reserved for
schema-reference metadata. This is a different context from the metadata table
inside a schema document, which may contain `[toml-schema.meta]` as described
under [Metadata Table - `[toml-schema]`](#metadata-table---toml-schema).
`location` and `version` are the only keys interpreted by this specification.
Implementations MAY permit additional extension keys, but every direct value in
this table MUST be a TOML scalar: string, integer, float, boolean, offset
date-time, local date-time, local date, or local time. Arrays, inline tables,
subtables, and arrays of tables are not schema-reference metadata and MUST be
rejected during schema discovery with `discovery-invalid-metadata`.
Implementations MUST ignore extension keys they do not recognize.

When `[elements.toml-schema]` is omitted, validators MUST ignore the reserved
metadata table during application-data validation. When
`[elements.toml-schema]` is present, validators MUST additionally validate the
metadata table like any other application table. Schema discovery rules,
including the scalar-only restriction, still apply when discovery is requested.
