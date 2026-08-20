# TOML Schema Specification

TOML Schema is a set of TOML-based constructs that define the structure, the names, and the types of configuration data in a TOML file.

TOML Schema validates the parsed input of a TOML file to:

1. Eliminate or reduce misconfiguration that could cause damage if it were only detected when the configuration is evaluated in production,
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
  - [Schema Definition Properties](#schema-definition-properties)
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
  - [Type Reference](#type-reference)
  - [Conjunctive Composition - `allof`](#conjunctive-composition---allof)
    - [The Effective Definition](#the-effective-definition)
    - [Merging by TOML Kind](#merging-by-toml-kind)
    - [Determinate Fixed-Child Set](#determinate-fixed-child-set)
    - [Effective Closure Set](#effective-closure-set)
    - [Composition Examples](#composition-examples)
  - [Alternative Types - `oneof` and `anyof`](#alternative-types---oneof-and-anyof)
  - [Conditional Selection - `if`, `then`, and `else`](#conditional-selection---if-then-and-else)
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
- [Schema Self-Validation](#schema-self-validation)
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
   - **Required**.
 - `meta`: subtable reserved for any custom user-provided metadata. **Type:** table.
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
  used as a bare reference in `itemtype`, `items`, `oneof`, `anyof`, `allof`,
  `then`, or `else`, because those locations cannot supply the collection's dynamic-value
  rule. Schema loaders MUST reject such references at schema-load time.
- `any` is valid for `type`, `itemtype`, and `items`, but it MUST NOT appear
  directly in `oneof`, `anyof`, `allof`, `then`, or `else`. Schema loaders MUST
  reject a direct `any` component at schema-load time.

These restrictions apply to bare built-in references, not to named reusable
definitions. A named definition that declares a complete collection or selects
`type = "any"` remains a valid reference.

`type`, `oneof`, `anyof`, and the `if`/`then`/`else` triple are alternative
ways to select the type of the current schema node. Every definition MUST
declare exactly one selector, except that a definition with nested child
definitions MAY omit all selectors and is then treated as `type = "table"`.
Schema loaders MUST reject a definition that combines selectors, contains only
part of a conditional triple, or declares no selector and has no nested child
definitions. `type` accepts either a built-in type name or a named reusable
definition from `[types]`. Container member types are selected separately with
`itemtype`: it validates each member of an `array` or each dynamically keyed
value of a `collection`. `itemtype` requires the same definition to declare the
built-in `type = "array"` or `type = "collection"`; it cannot be attached to
another built-in or to a named type reference.

Nested child definitions are valid only when the current node selects the
built-in `table` or `collection` type, or when the node omits a selector and is
therefore an implicit table. Schema loaders MUST reject child definitions attached to
a scalar, `array`, named type reference, `oneof`, `anyof`, or conditional node rather than
silently ignoring them.

Every named reference used by `type`, `itemtype`, `items`, `oneof`, `anyof`,
`allof`, `then`, or `else`
MUST resolve to a definition in `[types]`. Schema loaders MUST reject unresolved
references at schema-load time, including references in definitions that are
optional or not exercised by the document being validated.

Type-selection and composition references MUST be acyclic. A cycle composed of
named `type` aliases, `oneof` alternatives, `anyof` alternatives, conditional
branches, or `allof` components cannot resolve to a concrete definition and
schema loaders MUST reject it at schema-load time. Structural recursion through
table or collection children, array `itemtype`, or tuple `items` remains valid
because each recursive step consumes a nested document value.

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

### Schema Definition Properties

The following matrix summarizes where definition properties apply. The
detailed sections below remain authoritative.

| Property | Applicable definition |
| --- | --- |
| `type` | Selects one built-in or named type; mutually exclusive with other selectors |
| `oneof`, `anyof` | Select the current node from one or more alternatives; mutually exclusive with other selectors |
| `if`, `then`, `else` | Exhaustively select one of two named table-like definitions from a direct child's parsed value |
| `allof` | Conjunctively applies one or more compatible type references in addition to the local definition |
| `description`, `optional`, `default`, `deprecated` | Any definition, including a named reference or alternative selector |
| `format` | A definition with built-in `type = "string"` |
| `itemtype` | A definition with built-in `type = "array"` or `type = "collection"` |
| `items` | A definition with built-in `type = "array"`; mutually exclusive with `itemtype`, `allowedvalues`, `min`, `max`, `minlength`, and `maxlength` |
| `allowedvalues` | A scalar or unconstrained built-in type, or the items of a non-tuple `array` |
| `pattern` | A definition with built-in `type = "string"` |
| `keypattern` | A definition with built-in `type = "collection"` |
| `min`, `max` | A numeric or temporal built-in type, or an `array` whose `itemtype` resolves to one comparable kind |
| `minlength`, `maxlength` | A definition with built-in `type = "string"`, `type = "array"`, or `type = "collection"` |
| `uniqueitems` | A definition with built-in `type = "array"` |
| `dependentrequired`, `mutuallyexclusive`, `exactlyone` | A definition with effective type `table` or `collection` and a non-empty [determinate fixed-child set](#determinate-fixed-child-set) |

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

### Quoted and Special Keys

Schema child definitions use TOML tables. When a target TOML key is empty or contains characters that TOML requires to be quoted, such as a literal dot, quote that key in the schema table path.

Target keys may have the same names as TOML Schema properties, such as `type`,
`itemtype`, `optional`, or `pattern`. A key/value pair directly inside a schema
definition is a schema property, while a table-header path segment below that
definition is normally a target child definition.

A schema definition with nested child definitions and no explicit selector is
treated as `type = "table"`. This lets schemas describe target keys that would
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
type. On an
`array`, it instead enumerates the values permitted for each item, as described
under [Observations on Conditions to Arrays](#observations-on-conditions-to-arrays).
It is invalid on a `table` or `collection`.

The `allowedvalues` array MUST contain at least one entry. Every entry on a
non-array definition MUST have the TOML kind selected by that definition;
`type = "any"` is the exception and permits entries of any TOML kind. Numeric
equality between integers and floats does not make their TOML kinds
interchangeable for this schema-load check. A malformed enumeration MUST be
rejected at schema-load time.

For a non-array definition, when `allowedvalues` is combined with `pattern`, `format`,
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
value governed by that definition — each item value, for an `array` definition —
is evaluated in the following order:

1. The value's parsed TOML kind MUST be the kind the definition selects for it,
   through `type` or, for array items, through `itemtype`. A kind mismatch is a
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
  It is ASCII; non-ASCII components must be percent-encoded. Every percent
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

`format` is valid only on a definition whose selected type is the built-in
`string`. It cannot be attached to another built-in type, an alternative
selector, or a named type reference. A schema loader MUST reject an unsupported
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

These properties define inclusive value ranges. They may only be used for:

 - `float`
 - `integer`
 - date and/or time types: `offset-date-time`, `local-date-time`, `local-date`, and `local-time`
 - `array`, when `itemtype` resolves to `integer`, `float`, or one of the temporal types above

For arrays, `min` and `max` apply to each item. `itemtype` MUST resolve to one
comparable built-in kind: `integer`, `float`, `offset-date-time`,
`local-date-time`, `local-date`, or `local-time`. Named references and aliases
are resolved before this rule is checked, and all alternatives of a referenced
`oneof` or `anyof` definition MUST resolve to that same kind.
Schema loaders MUST reject array range constraints when the item schema can resolve to
different kinds or to a non-comparable kind. The interaction between array range
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
another built-in type, an alternative selector, or a named type reference.
Schema loaders MUST reject an incompatible length constraint at schema-load time rather
than silently ignoring it.

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
selector, schema loaders MUST treat it as if it declared `type = "table"`.

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
child.

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
 - `allowedvalues`: enumeration of possible values.
 - `uniqueitems`: whether every parsed array item must be unique.

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
Their applicability rule, including how a named `itemtype` and its alternatives
are resolved, and the ordering rules used for numeric and temporal items, are
defined under
[Minimum Value / Maximum Value](#minimum-value--maximum-value---min-and-max).

When `allowedvalues` is present on an array, every array item MUST be a member
of that enumeration. The enumeration does not have to be sorted. If `min` or
`max` is also present, every enumerated value MUST satisfy the applicable
inclusive boundary, and a schema loader MUST reject an enumerated value that
violates one; an enumerated value need not equal either boundary.

When the array declares `itemtype`, every enumerated value MUST have a TOML
kind permitted by the effective item type. Named references, aliases, and
`oneof` or `anyof` alternatives are resolved before this check. An `itemtype`
that permits `any` permits enumeration entries of any TOML kind. This
schema-load check verifies the permitted TOML kind; constraints inside a named
item definition still apply normally when a document array is validated.

`minlength` and `maxlength` constrain the document array's item count, not the
number of entries in `allowedvalues`.

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
 - `items` is also mutually exclusive with `min` and `max`.
 - `items` is also mutually exclusive with `minlength` and `maxlength`.
 - `items` is mutually exclusive with `allowedvalues`; constraints for a tuple
   position belong in the reusable definition referenced at that position.
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
contributed by a compatible `allof` component. Each dynamic child must be given
a unique key in the TOML document. `itemtype` may reference a built-in type or a
named reusable definition. A schema loader MUST reject an effective collection
when neither its local definition nor any referenced or composed definition
contributes an `itemtype`. This is a schema-load check, so it reads only the
contributions that are determinate at schema-load time; which components make
one is defined under
[Determinate Fixed-Child Set](#determinate-fixed-child-set).

The built-in `collection` cannot itself be used as `itemtype` or as an entry in
`items`, `oneof`, `anyof`, or `allof`: those bare references provide no place to declare
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
never produces an unknown-key error; an undeclared key that is not acceptable is
reported as a `keypattern` or `itemtype` failure instead. Fixed children that
are not optional remain required, exactly as in a closed table.

This difference in unknown-key semantics is why `table` and `collection` are not
interchangeable for `allof` composition.

A `collection` may additionally constrain the **keys** (entry names) of its dynamic children with `keypattern`. See [Key Pattern - `keypattern`](#key-pattern---keypattern).

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
the local definition must still declare one `type`, `oneof`, `anyof`, or
conditional selector, or have fixed children that make it an implicit table.

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

A composition is well formed only when its participants agree on kind.
Every component MUST resolve to an effective TOML kind compatible with the
local definition. When the local selector is `oneof` or `anyof`, all of its
alternatives MUST resolve to the same effective kind before `allof` can be
applied; a multi-kind local union combined with `allof` is indeterminate and
MUST be rejected at schema-load time. Scalar and array components must have the
same kind as the local definition. Structured components must all be `table` or
all be `collection`; a `table` and a `collection` are not interchangeable for
composition because they have different unknown-key semantics. A component
whose alternatives resolve to different kinds is likewise indeterminate and
MUST be rejected. The bare built-ins `any` and `collection` MUST NOT appear
directly in `allof`; a complete named definition may resolve to either where it
is otherwise compatible.

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

`optional` on the local definition determines whether the composed node may be
absent. An `optional` value inside an `allof` component does not make the
composed node optional; it only has meaning when that component is referenced
normally with `type`.

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
report such a key as an unexpected key on the node in addition to, or instead
of, the union's arity failure, as permitted under
[Validation Diagnostics](#validation-diagnostics).

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

These properties can be used anywhere a schema definition can appear, including an `[elements]` field, a reusable `[types]` definition, and a type referenced through `itemtype` for array or collection items. Alternatives may reference built-in type names directly or named definitions when a branch needs constraints.

The bare built-in names `any` and `collection` MUST NOT appear directly in
`oneof` or `anyof`. Use a named reusable definition when an alternative needs a
fully defined collection or an intentionally unconstrained named branch.

`type`, `oneof`, `anyof`, and the conditional triple all select the current
node's type and are mutually exclusive. A schema loader MUST reject a
definition containing more than one selector.

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

### Conditional Selection - `if`, `then`, and `else`

The `if`, `then`, and `else` properties form one exhaustive selector for a
table-like node. The condition inspects one direct child of the current parsed
table and selects one of two named reusable definitions:

```toml
[types.database]
if = { key = "engine", equals = "sqlite" }
then = "types.sqliteDatabase"
else = "types.serverDatabase"
```

`if` MUST be an inline table containing `key` and exactly one of `equals` or
`in`. It MUST contain no other members.

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

Like a union, the conditional triple contributes nothing to the
[determinate fixed-child set](#determinate-fixed-child-set) of the node it
selects. The selected branch's fixed children join the node's
[effective closure set](#effective-closure-set) at validation time, so the keys
the matched branch declares are known keys of that node, while keys declared
only by the branch that was not selected are not.

`then` and `else` MUST each be a string naming a reusable definition in
`[types]`; bare built-in references are invalid. Both definitions MUST resolve
to the same effective kind, and that kind MUST be `table` or `collection`.
Schema loaders MUST reject unresolved branches, different branch kinds,
branches that do not resolve to a table-like kind, and cycles through
conditional branches.

The conditional triple is mutually exclusive with `type`, `oneof`, and
`anyof`. A conditional definition MAY additionally declare only `allof`,
`description`, `optional`, `default`, and `deprecated`; it MUST NOT contain
kind-specific validation properties or nested child definitions. An `allof`
component MUST be compatible with the common branch kind and is applied
conjunctively with whichever branch is selected.

Optionality belongs to the conditional definition. An `optional` annotation
inside a branch does not make the conditional slot optional, because no branch
is selected when the slot is absent. A default on the conditional definition
MUST validate against the branch selected by that default at schema-load time.

Example with a multi-value condition:

```toml
[types.database]
if = { key = "engine", in = [ "postgresql", "mysql" ] }
then = "types.serverDatabase"
else = "types.embeddedDatabase"
```

Additional alternatives can be expressed by referencing another conditional
definition from `then` or `else`.

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
at least two unique child-name strings. At most one member of each group may be
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
after `allof` composition. Operands are resolved when the schema is loaded, so
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

TOML Schema validation does not modify the parsed TOML data model.

A validator MUST NOT mutate, replace, or augment the TOML data object produced
by the underlying parser. An API that returns that object MUST return the same
parsed keys and values that would exist without schema validation.

Schema loading additionally requires source-shape information for inline-table
properties whose names may also name child definitions. In particular,
`default = { ... }` and `dependentrequired = { ... }` cannot be distinguished
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
- materializing defaults into parsed TOML data; or
- overriding a constraint or modeling an application's runtime inheritance and
  merge precedence.

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

## Schema Self-Validation

The companion [`toml-schema.tosd`](toml-schema.tosd) is a TOML Schema document
that recursively validates schema-definition tables, including the schema
document itself. It models schema properties as fixed children and ordinary
target child definitions as dynamic collection entries. The
[`children`](#quoted-and-special-keys) namespace resolves the remaining TOML key
collision when one definition needs both a schema property and a target child
with the same name.

The self-schema validates property value shapes, selector exclusivity,
conditional completeness, tuple-versus-homogeneous array structure, nested child
applicability, string formats, sibling-rule structures, annotations, and the
selective `children` namespace.

Rules that require resolving the schema's reference graph cannot be expressed
that way and remain schema-load semantics:

 - reference existence and cycles;
 - effective `allof` compatibility;
 - conditional branch kinds;
 - collection `itemtype` inherited through composition;
 - defaults against effective types;
 - duplicate `oneof`, `anyof`, and `allof` entries after type-reference resolution;
 - allowed values against resolved constraints; and
 - sibling-rule operands against the determinate fixed-child set.

Schema loading also depends on the source-form information required under
[Validation and Data Model](#validation-and-data-model). That information is what
lets a loader distinguish the inline-table properties `default` and
`dependentrequired` from direct child tables with those names, and validate the
latter recursively.

A conforming implementation MUST apply both the self-schema validation and these
reference-aware and source-aware schema-load checks.

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
