# TOML Schema Specification

TOML Schema is a set of TOML-based constructs that define the structure, the names, and the types of configuration data on a TOML file.

The TOML Schema is used to validate the input of a TOML file during parsing to:

1. Eliminate or reduce misconfiguration that could potentially damage if only validated during production evaluation,
1. Be leveraged by editors and other tools to provide and enrich auto-completion and code hints for validation on the fly.

The schema format follows the TOML specification, meaning that a TOML Schema is in itself a valid TOML document.

## Conformance Terminology

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** in this document are to be interpreted as described in
[BCP 14](https://www.rfc-editor.org/info/bcp14) when, and only when, they
appear in all capitals.

A **schema loader** parses a TOML Schema document and rejects malformed
schemas. A **validator** applies a successfully loaded schema to a TOML
document. An **implementation** may provide both components in one API or
command.

## Table of Contents

- [Conformance Terminology](#conformance-terminology)
- [First Glance](#first-glance)
  - [TOML example](#toml-example)
  - [TOML Schema example](#toml-schema-example)
- [Schema Structure Reference](#schema-structure-reference)
  - [Top-level Structure Conditions](#top-level-structure-conditions)
- [Metadata Table - `[toml-schema]`](#metadata-table---toml-schema)
  - [Supported Properties](#supported-properties)
  - [Schema Versioning](#schema-versioning)
- [Elements table - `[elements]`](#elements-table---elements)
- [Types table - `[types]`](#types-table---types)
  - [Quoted and Special Keys](#quoted-and-special-keys)
  - [Simple Types - `<simple-type>`](#simple-types---simple-type)
    - [Allowed Values for Simple Types - `allowedvalues`](#allowed-values-for-simple-types---allowedvalues)
  - [Minimum Value / Maximum Value - `min` and `max`](#minimum-value--maximum-value---min-and-max)
  - [Length - `minlength` and `maxlength`](#length---minlength-and-maxlength)
  - [Conditions on `any`](#conditions-on-any)
  - [Block Types](#block-types)
    - [Tables](#tables)
    - [Arrays](#arrays)
      - [Observations on Conditions to Arrays](#observations-on-conditions-to-arrays)
      - [Array Item Schemas and Arrays of Tables](#array-item-schemas-and-arrays-of-tables)
      - [Tuple / Positional Array Validation - `items`](#tuple--positional-array-validation---items)
      - [Array Uniqueness - `uniqueitems`](#array-uniqueness---uniqueitems)
    - [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys)
  - [Type Reference](#type-reference)
  - [Conjunctive Composition - `allof`](#conjunctive-composition---allof)
  - [Alternative Types - `oneof` and `anyof`](#alternative-types---oneof-and-anyof)
  - [Sibling Presence Rules](#sibling-presence-rules)
  - [Description - `description`](#description---description)
  - [Default - `default`](#default---default)
  - [Deprecation - `deprecated`](#deprecation---deprecated)
  - [Optionality - `optional`](#optionality---optional)
  - [Pattern - `pattern`](#pattern---pattern)
  - [Key Pattern - `keypattern`](#key-pattern---keypattern)
- [Validation and Data Model](#validation-and-data-model)
  - [Parsed Value Equality](#parsed-value-equality)
  - [Validation Diagnostics](#validation-diagnostics)
  - [Expressiveness and Validation Scope](#expressiveness-and-validation-scope)
- [Filename Extension](#filename-extension)
- [MIME Type](#mime-type)
- [TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema)

## First Glance

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
    pattern='^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$'
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
   - **Required**
 - `[types]`: table with definitions of types to be reused in elements.
   - _Optional_
 - `[elements]`: table with the overall structure of the TOML document, its tables, properties, and conditions.
   - **Required**

No other top-level table or key-value pair MAY appear in a TOML Schema document.

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
   - **Required**.
 - `toml-schema.meta`: table reserved for any custom user-provided metadata.
   - **Optional**.

Custom properties and tables MUST NOT appear directly under `toml-schema`; they
MAY appear only inside the `toml-schema.meta` table.

### Schema Versioning

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

The companion [`toml-schema.tosd`](toml-schema.tosd) validates this top-level
structure. It intentionally leaves individual schema-definition tables open:
schema property names such as `type` and `itemtype` may also be target child
keys, and TOML cannot represent both a key-value property and a child table with
the same path in one self-schema definition. Schema loaders therefore enforce
the vocabulary, property types, and conditional applicability rules specified
below.

## Types table - `[types]`

The `[types]` table is for use when there is a need for custom, reusable types of structure or properties. A type is referenced in an element or another type with a type reference.

Type references are strings accepted by `type`, `itemtype`, `items`, `oneof`,
`anyof`, and `allof`. A type reference may be either:

- a built-in type name such as `"string"`, `"boolean"`, or `"integer"`;
- a named reusable definition from `[types]`, written either as `"types.<typename>"` or `"<typename>"`.

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

Two built-in names have context-specific restrictions:

- `collection` is valid for `type` only when the effective definition obtains
  an `itemtype` locally or from a compatible `allof` component. It MUST NOT be
  used as a bare reference in `itemtype`, `items`, `oneof`, `anyof`, or
  `allof`, because those locations cannot supply the collection's dynamic-value
  rule. Schema loaders MUST reject such references at schema-load time.
- `any` is valid for `type`, `itemtype`, and `items`, but it MUST NOT appear
  directly in `oneof`, `anyof`, or `allof`. Schema loaders MUST reject a direct
  `any` component at schema-load time.

These restrictions apply to bare built-in references, not to named reusable
definitions. A named definition that declares a complete collection or selects
`type = "any"` remains a valid reference.

`type`, `oneof`, and `anyof` are alternative ways to select the type of the current schema node. Every definition MUST declare exactly one of them, except that a definition with nested child definitions MAY omit all three and is then treated as `type = "table"`. Schema loaders MUST reject a definition that declares more than one of these properties, or that declares none of them and has no nested child definitions. `type` accepts either a built-in type name or a named reusable definition from `[types]`. Container member types are selected separately with `itemtype`: it validates each member of an `array` or each dynamically keyed value of a `collection`. `itemtype` requires the same definition to declare the built-in `type = "array"` or `type = "collection"`; it cannot be attached to another built-in or to a named type reference.

Nested child definitions are valid only when the current node selects the
built-in `table` or `collection` type, or when the node omits a selector and is
therefore an implicit table. Schema loaders MUST reject child definitions attached to
a scalar, `array`, named type reference, `oneof`, or `anyof` node rather than
silently ignoring them.

Every named reference used by `type`, `itemtype`, `items`, `oneof`, `anyof`, or `allof`
MUST resolve to a definition in `[types]`. Schema loaders MUST reject unresolved
references at schema-load time, including references in definitions that are
optional or not exercised by the document being validated.

Type-selection and composition references MUST be acyclic. A cycle composed of named `type`
aliases, `oneof` alternatives, `anyof` alternatives, or `allof` components cannot resolve to a
concrete definition and schema loaders MUST reject it at schema-load time. Structural
recursion through table or collection children, array `itemtype`, or tuple
`items` remains valid because each recursive step consumes a nested document
value.

```toml
[types]

[types.<typename>]
type = "<type-reference>"
description = "<human-readable description>"
itemtype = "<type-reference>"
items = [ "<type-reference>", ... ]
oneof = [ "<type-reference>", ... ]
anyof = [ "<type-reference>", ... ]
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

The following matrix summarizes where definition properties apply. The
detailed sections below remain authoritative.

| Property | Applicable definition |
| --- | --- |
| `type` | Selects one built-in or named type; mutually exclusive with `oneof` and `anyof` |
| `oneof`, `anyof` | Select the current node from one or more alternatives; mutually exclusive with each other and `type` |
| `allof` | Conjunctively applies one or more compatible type references in addition to the local definition |
| `description`, `optional`, `default`, `deprecated` | Any definition, including a named reference or alternative selector |
| `itemtype` | A definition with built-in `type = "array"` or `type = "collection"` |
| `items` | A definition with built-in `type = "array"`; mutually exclusive with `itemtype`, `allowedvalues`, `min`, `max`, `minlength`, and `maxlength` |
| `allowedvalues` | A simple built-in type, or the items of a non-tuple `array` |
| `pattern` | A definition with built-in `type = "string"` |
| `keypattern` | A definition with built-in `type = "collection"` |
| `min`, `max` | A numeric or temporal built-in type, or an `array` whose `itemtype` resolves to one comparable kind |
| `minlength`, `maxlength` | A definition with built-in `type = "string"`, `type = "array"`, or `type = "collection"` |
| `uniqueitems` | A definition with built-in `type = "array"` |
| `dependentrequired`, `mutuallyexclusive`, `exactlyone` | A definition with effective type `table` or `collection` and fixed child definitions |

A named type reference and an alternative selector may additionally declare
only `allof`, `description`, `optional`, `default`, and `deprecated`.
Kind-specific constraints for the referenced or alternative types belong in
reusable definitions.

### Quoted and Special Keys

Schema child definitions use TOML tables. When a target TOML key is empty or contains characters that TOML requires to be quoted, such as a literal dot, quote that key in the schema table path.

Target keys may have the same names as TOML Schema properties, such as `type`,
`itemtype`, `optional`, or `pattern`. A key/value pair directly inside a schema
definition is a schema property, while a table-header path segment below that
definition is a target child definition.

A schema definition with nested child definitions and no explicit `type`, `oneof`, or `anyof` is treated as `type = "table"`. This lets schemas describe target keys that would otherwise collide with schema properties.

TOML itself forbids one table from containing both a value and a subtable with
the same key. Therefore, a definition cannot simultaneously use a schema
property and define a target child with that property's name. For example, an
implicit table can define `[elements.plugin.type]`, but the parent cannot also
declare a `type = ...` property. Likewise, a definition cannot have both a
`default = ...` annotation and a child table named `default`. Authors can
sometimes avoid a collision by factoring structure through a reusable type or
by choosing the implicit-table form. If the colliding schema property is still
required on the same definition, TOML Schema 1.0 cannot express both meanings
there. Quoting the child key does not remove this TOML data model restriction.

Example TOML document:

```toml
"" = "blank"

[site]
"google.com" = true

[plugin]
type = "npm"
```

Schema:

```toml
[elements.""]
type = "string"

[elements.site."google.com"]
type = "boolean"

[elements.plugin.type]
type = "string"
```

### Simple Types - `<simple-type>`

List of considered simple types:

- Any: `any`
- String: `string`
- Integer: `integer`
- Float: `float`
- Boolean: `boolean`
- Offset Date-Time: `offset-date-time`
- Local Date-Time: `local-date-time`
- Local Date: `local-date`
- Local Time: `local-time`

#### Allowed Values for Simple Types - `allowedvalues`

`allowedvalues` provides an enumeration for a simple built-in type. On an
`array`, it instead enumerates the values permitted for each item, as described
under [Observations on Conditions to Arrays](#observations-on-conditions-to-arrays).
It is invalid on a `table` or `collection`.

The `allowedvalues` array MUST contain at least one entry. Every entry on a
non-array definition MUST have the TOML kind selected by that definition;
`type = "any"` is the exception and permits entries of any TOML kind. Numeric
equality between integers and floats does not make their TOML kinds
interchangeable for this schema-load check. A malformed enumeration MUST be
rejected at schema-load time.

For a non-array simple type, when `allowedvalues` is combined with `pattern`,
`min`, `max`, `minlength`, or `maxlength`, every entry in `allowedvalues` MUST
satisfy every applicable constraint. A schema containing an entry that violates
one of those constraints is malformed, and schema loaders MUST reject it at
schema-load time. For offset date-times, this boundary check uses instant
ordering even though subsequent `allowedvalues` membership uses parsed-value
equality; equivalent instants with different retained local fields or offsets
therefore compare equal for a boundary but remain distinct enumeration values.

After a schema with `allowedvalues` has been loaded successfully, a document
value is valid when it is a member of `allowedvalues` according to
[Parsed Value Equality](#parsed-value-equality). Validators do not need to
re-evaluate the other constraints for that document value because every
enumerated value has already been checked against them while loading the schema.

The rules for applying `allowedvalues` to array items are defined separately under [Observations on Conditions to Arrays](#observations-on-conditions-to-arrays).

Example:
```toml
[types.colorType]
type="string"
allowedvalues=[ "red", "black", "blue" ]
```

### Minimum Value / Maximum Value - `min` and `max`

These properties define inclusive value ranges. They may only be used for:

 - `float`
 - `integer`
 - date and/or time types: `offset-date-time`, `local-date-time`, `local-date`, and `local-time`
 - `array`, when `itemtype` resolves to `integer`, `float`, or one of the temporal types above

For arrays, `min` and `max` apply to each item. `itemtype` MUST resolve to one
comparable built-in kind: `integer`, `float`, `offset-date-time`,
`local-date-time`, `local-date`, or `local-time`. All alternatives of a
referenced `oneof` or `anyof` definition MUST resolve to that same kind.
Schema loaders MUST reject array range constraints when the item schema can resolve to
different kinds or to a non-comparable kind.

A `min` or `max` boundary MUST be a TOML value that is comparable with the schema type: `integer` or `float` boundaries for `integer` and `float` values, and matching temporal boundaries for temporal values.

`nan`, `+nan`, and `-nan` are not valid `min` or `max` boundaries because NaN is unordered. `inf`, `+inf`, and `-inf` are valid float boundaries.

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
another built-in type, an alternative selector, or a named type reference.
Schema loaders MUST reject an incompatible length constraint at schema-load time rather
than silently ignoring it.

### Conditions on `any`

No `min` or `max` condition may be applied to type `any`. The schema loader
MUST reject such a schema.

An unconstrained value may declare `type = "any"`, and arrays may use `any` in
`itemtype` or `items`. A direct `any` entry in `oneof` or `anyof` is malformed
because it would add an unconstrained branch to an alternative type selector.

### Block Types

- Array: `array`
- Table: `table` (*)
- Collection: `collection` (*)

(*) The schema also explicitly defines two types:

1. The implicit TOML type `table` for specifying child elements associated to the parent.
1. A type for a collection of elements, `collection`.

For simplicity, there is no definition of `inline table` since these are just tables that can be expressed inlined in a TOML document.

#### Tables

A `table` may have a set of properties, or none at all. If a table has a
definition of properties, the validator MUST require the input to match exactly
the rules of the table and its children.

If a schema definition has nested child definitions but does not declare `type`, `oneof`, or `anyof`, schema loaders MUST treat it as if it declared `type = "table"`.

If a property of type `table` has no defined children, the validator MUST
accept any TOML table value without validating its contents. This is useful for
representing custom data payloads.

#### Arrays

Arrays can be defined by mixing the following properties:

 - `itemtype`: a type reference used to validate every item in a homogeneous array.
 - `items`: ordered type references for tuple-style positional validation with fixed arity.
 - `minlength`: the minimum length of the array (e.g. no less than 2 elements).
 - `maxlength`: the maximum length of the array (e.g. no more than 2 elements).
 - `min`: the minimum value allowed for each comparable array item (e.g. 80).
 - `max`: the maximum value allowed for each comparable array item (e.g. 8080).
 - `allowedvalues`: enumeration of possible values.
 - `uniqueitems`: whether every parsed array item must be unique.

`arraytype` is not a TOML Schema property. Schema loaders MUST reject schema
definitions that declare it. Use `itemtype` for both built-in and named member
types.

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

The `min` and `max` conditions set an inclusive range for every array item. They
MUST be used only when `itemtype` resolves to one comparable built-in kind:
`integer`, `float`, or one of the four date/time types. When `itemtype`
references a named definition, aliases and alternatives are resolved before
this rule is checked.

Temporal values use the ordering rules defined under
[Minimum Value / Maximum Value](#minimum-value--maximum-value---min-and-max).

When `allowedvalues` is present on an array, every array item MUST be a member
of that enumeration. The enumeration does not have to be sorted. If `min` or
`max` is also present, every enumerated value MUST satisfy the applicable
inclusive boundary; an enumerated value need not equal either boundary.

When the array declares `itemtype`, every enumerated value MUST have a TOML
kind permitted by the effective item type. Named references, aliases, and
`oneof` or `anyof` alternatives are resolved before this check. An `itemtype`
that permits `any` permits enumeration entries of any TOML kind. This
schema-load check verifies the permitted TOML kind; constraints inside a named
item definition still apply normally when a document array is validated.

`minlength` and `maxlength` constrain the document array's item count, not the
number of entries in `allowedvalues`. The schema loader MUST reject an
enumerated value that violates `min` or `max`.

If neither `itemtype` nor `items` is defined, array items default to `any`, so
items of different TOML types may be mixed.

If `type = "array"` and `itemtype = "array"`, every item MUST be an array. The
contents of those nested arrays are unconstrained; only omitting `itemtype`
permits non-array and array items to be mixed in the outer array.

##### Array Item Schemas and Arrays of Tables

`itemtype` accepts the same built-in or named references as `type`. Use a
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
[types.coordinateLabel]
type = "array"
items = [ "types.coordinate", "types.label" ]
```

Semantics:

 - `items` is ordered, and each index validates against the corresponding referenced type.
 - `items` MUST contain at least one type reference. A schema loader MUST reject
   `items = []`; use `maxlength = 0` to require an empty array.
 - When `items` is present, the array MUST have exactly the same number of items.
 - `items` is mutually exclusive with `itemtype`.
 - `items` is also mutually exclusive with `min` and `max`.
 - `items` is also mutually exclusive with `minlength` and `maxlength`.
 - `items` is mutually exclusive with `allowedvalues`; constraints for a tuple
   position belong in the reusable definition referenced at that position.

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
contributed by a compatible `allof` component. Each dynamic child must be given
a unique key in the TOML document. `itemtype` may reference a built-in type or a
named reusable definition. A schema loader MUST reject an effective collection
when neither its local definition nor any referenced or composed definition
contributes an `itemtype`.

The built-in `collection` cannot itself be used as `itemtype` or as an entry in
`items`, `oneof`, `anyof`, or `allof`: those bare references provide no place to declare
the nested collection's required `itemtype`. Define a reusable collection with
its own `itemtype` and reference that named definition instead.

When collection values may have alternative types, define those alternatives in a reusable `[types]` definition with `oneof` or `anyof`, then reference that definition with `itemtype`. This keeps `oneof` and `anyof` consistently scoped to the current node rather than changing their meaning on a container.

A `collection` may additionally constrain the **keys** (entry names) of its dynamic children with `keypattern`. See [Key Pattern - `keypattern`](#key-pattern---keypattern).

Fixed child definitions take precedence over the collection's dynamic-entry
rule. This permits a collection to validate known keys precisely while applying
`itemtype` only to all other keys. For example, `itemtype = "any"` makes unknown
keys forward-compatible while fixed children still receive their declared
validation. Authors choosing this pattern trade typo detection on unknown keys
for extensibility; use a plain `table` when undeclared keys must be rejected.

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

[elements]

    [elements.servers]
    type = "collection"
    itemtype = "types.serverType"

        [elements.servers.group]
        type = "string"
```

A `collection` may be represented as subtables of a common table in a TOML document.

### Type Reference

A type reference applies a built-in type or inherits the rules of a named reusable type. Both `[types]` definitions and `[elements]` definitions may use type references. The `type` property selects the current node's type; built-in and named references use the same syntax.

When `type` selects a named reusable definition, the reference inherits that
definition's validation rules as-is. This inheritance includes `optional`: the
referencing slot is optional when either the use site or the referenced
definition declares `optional = true`. A use-site `optional = false` cannot
make an optional referenced definition required. In version 1.0, the
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
addition to its local definition. It is an applicator, not a type selector:
the local definition must still declare exactly one of `type`, `oneof`, or
`anyof`, or have fixed children that make it an implicit table.

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

The document value MUST validate against the local definition and every
referenced component. Composition is conjunctive and non-overriding. If two
components constrain the same value, both constraints apply. A contradiction
may therefore describe a schema for which no document value is valid; it does
not create last-wins behavior.

Every component MUST resolve to an effective TOML kind compatible with the
local definition. Scalar and array components must have the same kind as the
local definition. Structured components must all be `table` or all be
`collection`; a `table` and a `collection` are not interchangeable for
composition because they have different unknown-key semantics. A component
whose alternatives resolve to different kinds is indeterminate and MUST be
rejected. The bare built-ins `any` and `collection` MUST NOT appear directly in
`allof`; a complete named definition may resolve to either where it is
otherwise compatible.

For composed arrays, the document array MUST independently satisfy the local
array definition and every array component. Homogeneous `itemtype` constraints
from different definitions all apply to every item. A tuple `items` constraint
applies its exact length and per-position definitions independently of any
homogeneous or tuple constraints contributed elsewhere. Array length,
uniqueness, enumeration, and item range constraints likewise remain
conjunctive. Conflicting constraints may make the definition unsatisfiable but
do not use last-wins merging and are not by themselves a schema-load error.

For composed tables and collections, validators MUST form the union of all
local and component fixed-child names before applying unknown-key rules. The
value of an overlapping fixed child MUST validate against every contributing
child definition. If any contributing child definition requires that child,
the child remains required.

A composed table is open only when neither the local definition nor any
component defines fixed children. Otherwise its union of fixed children is
closed. For a composed collection, the union of fixed children retains
precedence over dynamic entries. Every remaining dynamic entry MUST satisfy
every contributing `itemtype`, and its key MUST satisfy every contributing
`keypattern`. A collection's required dynamic-entry constraint may therefore be
supplied entirely by one or more `allof` components; it need not repeat a local
`itemtype`.

`optional` on the local definition determines whether the composed node may be
absent. An `optional` value inside an `allof` component does not make the
composed node optional; it only has meaning when that component is referenced
normally with `type`.

An `allof` component may itself contain `oneof`, `anyof`, or another `allof`
when its effective kind is unambiguous. A composed definition may be referenced
from `type`, `itemtype`, `items`, `oneof`, or `anyof`. All composition
references MUST resolve at schema-load time, and composition/type-selection
cycles are malformed. Structural recursion that consumes a child or container
member remains valid.

### Alternative Types - `oneof` and `anyof`

Use `oneof` or `anyof` when a value may validate against alternative type references.

- `oneof`: exactly one referenced type must validate.
- `anyof`: at least one referenced type must validate.

These properties can be used anywhere a schema definition can appear, including an `[elements]` field, a reusable `[types]` definition, and a type referenced through `itemtype` for array or collection items. Alternatives may reference built-in type names directly or named definitions when a branch needs constraints.

The bare built-in names `any` and `collection` MUST NOT appear directly in
`oneof` or `anyof`. Use a named reusable definition when an alternative needs a
fully defined collection or an intentionally unconstrained named branch.

`type`, `oneof`, and `anyof` all select the current node's type and are mutually exclusive. A schema loader MUST reject a definition containing more than one of them.

The array assigned to `oneof` or `anyof` MUST contain at least one type
reference. A union definition MAY additionally declare only `description`,
`optional`, `default`, `deprecated`, and `allof`; it MUST NOT declare another
validation property or any nested child definition. Schema loaders MUST reject
empty unions and other union siblings at schema-load time. Constraints required
by an alternative belong in a named reusable definition referenced by the
union.

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

When alternatives contain annotations, only successful branches contribute
them, and only for a value that is present. Deprecation warnings follow the
successful-branch rule: `oneof` reports the warning of its single successful
branch, and `anyof` reports the warnings of every successful branch,
deduplicated by code, path, and message. Consequently, a deprecated successful
branch contributes a warning even when another successful `anyof` branch is not
deprecated; this preserves all annotations attached to definitions that
accepted the value. Alternative `default` annotations are governed by
[Default](#default---default): they are never combined into the slot's
effective default and never cause a schema-load conflict. For a present value,
an implementation MAY surface the default of each successful branch as a hint,
deduplicated by [Parsed Value Equality](#parsed-value-equality). A branch that
fails validation contributes neither defaults nor deprecation warnings.

### Sibling Presence Rules

Version 1.0 defines three presence-only rules for direct fixed children of an
effective `table` or `collection`. They inspect parsed key presence, never a
child's value, and never follow a dotted string as a document path.

#### Dependencies - `dependentrequired`

`dependentrequired` is a non-empty inline table. Each member maps one trigger
child name to a non-empty array of unique child names. When the trigger is
present, every listed child MUST also be present.

```toml
[types.dependency]
type = "table"
dependentrequired = { branch = [ "git" ], tag = [ "git" ], rev = [ "git" ] }
```

Dependencies are directional. If `a` requires `b`, the presence of `b` does not
require `a` unless a reverse mapping is declared. Every triggered mapping is
evaluated, so dependencies may apply transitively.

#### Mutual Exclusion - `mutuallyexclusive`

`mutuallyexclusive` is a non-empty array of groups. Each group is an array of
at least two unique child-name strings. At most one member of each group may be
present.

```toml
mutuallyexclusive = [ [ "git", "path" ], [ "branch", "tag", "rev" ] ]
```

Zero or one present member satisfies a group.

#### Exactly One - `exactlyone`

`exactlyone` has the same shape as `mutuallyexclusive`, but exactly one member
of every group MUST be present.

```toml
[types.readmeTable]
type = "table"
exactlyone = [ [ "file", "text" ] ]
```

This allows every group member to remain individually `optional = true` while
the group still requires one choice.

Every name in these three properties MUST identify a direct fixed child in the
effective definition after `allof` composition. A quoted string containing a
dot identifies a literal dotted child key. Dynamic collection keys are not
fixed children and cannot be operands, while a collection's explicitly defined
children participate normally.

Schema loaders MUST reject a rule with the wrong TOML value type, an empty
mapping or group list, a group with fewer than two members, a duplicate name
within one dependency array or group, an unknown fixed-child name, or use on an
incompatible effective kind. Loaders are not required to prove general logical
satisfiability between multiple valid rules.

Ordinary requiredness is evaluated together with these rules. An absent
optional trigger has no effect. A non-optional child remains required even if a
presence group would otherwise permit its absence.

### Description - `description`

`description` is an optional human-readable string that documents a schema definition. It may be used on reusable types, elements, and nested definitions. Implementations and tooling MAY use it for documentation, suggestions, and autocompletion; it does not affect validation.

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

`default` is a machine-readable annotation containing any TOML value.

```toml
[elements.retries]
type = "integer"
optional = true
default = 3
```

Because `default` is also a legal child key, its TOML syntax disambiguates the
two meanings. A `default = <value>` key/value entry is always the annotation;
a table header such as `[elements.options.default]` is always a child definition
named `default`. Consequently, a table-valued default MUST use inline-table
syntax, for example `default = { min = 1, max = 10 }`. Schema loaders MUST
preserve or recover this syntactic distinction rather than guessing from the
inline table's member names.

A default is not a validation assertion and never changes the document being
validated. It does not insert a missing value, satisfy a required definition,
or change the parsed TOML data returned by an implementation. Tools MAY expose
it as a suggestion or effective-configuration hint through schema metadata.
Version 1.0 does not define an operation that materializes defaults.

Despite being an annotation, a declared default MUST validate as a present
value against the full effective definition at schema-load time. Default
validation applies all references, composition, alternatives, fixed children,
sibling rules, and ordinary constraints, but does not emit a deprecation
warning. A loader MUST reject an incompatible default.

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
value produces a warning diagnostic; an absent optional value produces no
warning. A deprecated parent produces one warning at the parent path rather
than one warning for every descendant.

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

For a named `type` reference, optionality is inherited: the referencing slot is
optional if either the use site or any definition in the reference chain
declares `optional = true`. An explicit `optional = false` cannot cancel an
inherited `true`. In contrast, `optional` values contributed only through
`allof` components do not affect presence, as defined under
[Conjunctive Composition](#conjunctive-composition---allof). The presence of a
`oneof` or `anyof` slot is governed only by `optional` on the union definition
or inherited through a named `type` reference to that union. `optional`
declared inside an alternative does not make the union slot optional because
no alternative is selected when the slot is absent.

### Pattern - `pattern`

This property is only valid on a definition whose selected type is the built-in
`string`. It cannot be attached to another built-in type, an alternative
selector, or a named type reference. Schema loaders MUST reject an incompatible
`pattern` at schema-load time rather than silently ignoring it.

The portable TOML Schema regular-expression profile consists of literals,
escaped metacharacters, `.`, character classes and ranges, negated character
classes, concatenation, alternation, capturing and non-capturing groups, the
anchors `^` and `$`, and the greedy quantifiers `?`, `*`, `+`, `{n}`, `{n,}`,
and `{n,m}`. These constructs use the syntax documented by the
[RE2 syntax reference](https://github.com/google/re2/wiki/Syntax). Implementations MUST
support this profile.

Character-class shorthands such as `\d`, `\s`, and `\w` are outside the
portable profile because regular-expression engines disagree about whether
they use ASCII or Unicode membership. Backreferences, look-around assertions,
atomic groups, conditionals, and recursion are also outside the portable
profile. Implementations MAY accept additional constructs, but schemas that use those
extensions are not portable between TOML Schema implementations.

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
[`pattern`](#pattern---pattern). Like `pattern`, `keypattern` is not implicitly
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

It is NOT the goal of a TOML Schema to ever modify the data output of a TOML object during parsing.

A validator MUST NOT mutate, replace, or augment the TOML data object produced
by the underlying parser. An API that returns that object MUST return the same
parsed keys and values that would exist without schema validation.

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

### Validation Diagnostics

Implementations MUST distinguish schema-load failures from document-validation
diagnostics. A malformed schema, unsupported language version, unresolved
reference, or invalid keyword application prevents validation from starting.

Document-validation diagnostics have a severity, stable machine-readable code,
document path, and human-readable message. Errors determine document validity.
Warnings do not. Except for the `deprecated` code assigned below and any codes
assigned by a future revision of this specification, diagnostic codes and path
serialization are implementation-defined, but they MUST remain stable across
compatible releases of that implementation.
An implementation MAY expose additional diagnostic fields, but MUST provide
separate access to errors and warnings. A command-line validator MUST exit
successfully for a document whose only diagnostics are warnings.

Deprecation produces a warning with the stable machine-readable code
`deprecated`. Implementations MUST retain branch-local diagnostics while
evaluating `oneof` and `anyof` so
warnings from failed alternatives are not reported. Duplicate warnings
contributed by multiple successful paths MUST be deduplicated by code, path,
and message.

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
- single-table-or-array-of-table representations through named container
  alternatives;
- fixed-length heterogeneous arrays with `items`; and
- quoted, empty, or literal dotted keys through normal TOML key syntax.

The checked-in schemas under [`examples/`](examples/) exercise these patterns
against formats including [Cargo manifests](https://doc.rust-lang.org/cargo/reference/manifest.html),
Python [`pyproject.toml`](https://packaging.python.org/en/latest/specifications/pyproject-toml/),
Hugo, Netlify, GitLab Runner, and Cloudflare Wrangler.

Version 1.0 includes direct-sibling presence dependencies, at-most-one and
exactly-one groups, conjunctive reusable composition, whole-item array
uniqueness, defaults, and deprecation annotations. These features remain
deliberately bounded. Version 1.0 does not define keywords for:

- requiring, forbidding, or changing a key's schema based on another key's
  value;
- following arbitrary document paths or comparing values at different paths;
- making a field absent precisely when its name appears in another array;
- selecting array uniqueness by one field rather than the complete item value;
- materializing defaults into parsed TOML data; or
- overriding a constraint or modeling an application's runtime inheritance and
  merge precedence.

For example, a schema can require Cargo `branch`, `tag`, or `rev` to accompany
`git`, and can make those selectors mutually exclusive. It still cannot make a
constraint depend on the contents of a sibling value. A `pyproject.toml` schema
can require `project.dynamic` entries to be unique, but cannot require a field
to be absent precisely when its name appears in that array. Those
value-sensitive application policies require an additional semantic-validation
pass.

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

## Filename Extension

TOML Schema files MUST use the extension `.tosd`.

## MIME Type

When transferring TOML Schema files over the internet, the MIME type MUST be:

 - application/tosd

## TOML Reference of a TOML Schema

A TOML file can include this indication to reference which schema file to use for validation:

```toml
[toml-schema]
location = "<uri>"
version = "1.0.0" # optional
```

`location` identifies the schema document. It is REQUIRED when a validator is asked to discover a schema from the TOML document. Its value MUST be a non-empty string containing either an absolute URI, such as an HTTPS URL, or a relative URI reference, such as a local schema filename.

An absolute `location` MUST be used unchanged. A relative `location` MUST be resolved against the referencing TOML document's location, not against the validator's current working directory or the resolved schema's location. For a TOML document stored in a local file, this means resolving a relative location from the document's parent directory.

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

After resolving and loading the schema, a validator MUST compare these two language versions when the referencing document provides `version`. A different major version is incompatible and schema discovery MUST fail. Any other unequal version, including a minor, patch, pre-release, or build metadata difference, MUST produce a warning but MUST NOT by itself cause validation to fail. Compatibility between the resolved schema and the validator remains governed by [Schema Versioning](#schema-versioning).

In a target TOML document, the root `[toml-schema]` table is reserved for
schema-reference metadata. This is a different context from the metadata table
inside a schema document, which may contain `[toml-schema.meta]` as described
under [Metadata Table - `[toml-schema]`](#metadata-table---toml-schema).
`location` and `version` are the only keys interpreted by this specification.
Implementations MAY permit additional extension keys, but every direct value in
this table MUST be a TOML scalar: string, integer, float, boolean, offset
date-time, local date-time, local date, or local time. Arrays, inline tables,
subtables, and arrays of tables are not schema-reference metadata and MUST be
rejected during schema discovery. Implementations MUST ignore extension keys
they do not recognize.

When `[elements.toml-schema]` is omitted, validators MUST ignore the reserved
metadata table during application-data validation. When
`[elements.toml-schema]` is present, validators MUST additionally validate the
metadata table like any other application table. Schema discovery rules,
including the scalar-only restriction, still apply when discovery is requested.
