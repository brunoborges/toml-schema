# TOML Schema Specification

TOML Schema is a set of TOML-based constructs that define the structure, the names, and the types of configuration data on a TOML file.

The TOML Schema is used to validate the input of a TOML file during parsing to:

1. Eliminate or reduce misconfiguration that could potentially damage if only validated during production evaluation,
1. Be leveraged by editors and other tools to provide and enrich auto-completion and code hints for validation on the fly.

The schema format follows the TOML specification, meaning that a TOML Schema is in itself a valid TOML document.

## Table of Contents

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
  - [Simple Types - `<simple-type>`](#simple-types---simple-type)
    - [Allowed Values for Simple Types - `allowedvalues`](#allowed-values-for-simple-types---allowedvalues)
  - [Minimum Value / Maximum Value - `min` and `max`](#minimum-value--maximum-value---min-and-max)
  - [Length - `minlength` and `maxlength`](#length---minlength-and-maxlength)
  - [Conditions on `any`](#conditions-on-any)
  - [Block Types](#block-types)
    - [Tables](#tables)
    - [Arrays](#arrays)
      - [Tuple / Positional Array Validation - `items`](#tuple--positional-array-validation---items)
    - [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys)
  - [Type Reference](#type-reference)
  - [Alternative Types - `oneof` and `anyof`](#alternative-types---oneof-and-anyof)
  - [Description - `description`](#description---description)
  - [Optionality - `optional`](#optionality---optional)
  - [Pattern - `pattern`](#pattern---pattern)
  - [Key Pattern - `keypattern`](#key-pattern---keypattern)
- [Parsers](#parsers)
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
    pattern="^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$"
    [types.serverType.role]
    type="string"

[elements.title]
type="string"

[elements.owner]
type="table"
    [elements.owner.name]
    type="string"
    [elements.owner.dob]
    type="local-date"

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

**IMPORTANT**: No other top-level table or key-value pair may appear on a TOML Schema document.

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

 No custom property or table may be appended under `toml-schema`, only inside `toml-schema.meta` table.

### Schema Versioning

TOML Schema follows the same version-numbering policy as the TOML specification: schema language versions use [Semantic Versioning](https://semver.org/).

The `version` property MUST be a string containing a full SemVer version in `MAJOR.MINOR.PATCH` form. The current TOML Schema version is `1.0.0`.

```toml
[toml-schema]
version = "1.0.0"
```

Parsers MUST reject schema documents whose `version` is missing, is not a string, or is not a valid SemVer value. Shorthand values such as `"1"` and `"1.0"` are invalid.

A parser that supports TOML Schema version `MAJOR.MINOR.PATCH` MUST accept schema documents with the same major version and a minor version less than or equal to the parser's supported minor version. Patch versions, pre-release identifiers, and build metadata do not add schema-language features and do not affect parser compatibility. Parsers MUST reject schema documents with an unsupported major version or a greater minor version.

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

Type references are strings accepted by `type`, `itemtype`, `items`, `oneof`, and `anyof`. A type reference may be either:

- a built-in type name such as `"string"`, `"boolean"`, or `"integer"`;
- a named reusable definition from `[types]`, written either as `"types.<typename>"` or `"<typename>"`.

Built-in type names are reserved and MUST NOT be used as `[types]` definition names. The reserved names are `any`, `string`, `integer`, `float`, `boolean`, `offset-date-time`, `local-date-time`, `local-date`, `local-time`, `array`, `table`, and `collection`.

Two built-in names have context-specific restrictions:

- `collection` is valid for `type` only when the same definition declares
  `itemtype`. It MUST NOT be used as a bare reference in `itemtype`, `items`,
  `oneof`, or `anyof`, because those locations cannot supply the collection's
  dynamic-value rule. Parsers MUST reject such references at schema-load time.
- `any` is valid for `type`, `itemtype`, and `items`, but it MUST NOT appear
  directly in `oneof` or `anyof`. Parsers MUST reject a direct `any` alternative
  at schema-load time.

These restrictions apply to bare built-in references, not to named reusable
definitions. A named definition that declares a complete collection or selects
`type = "any"` remains a valid reference.

`type`, `oneof`, and `anyof` are alternative ways to select the type of the current schema node. Every definition MUST declare exactly one of them, except that a definition with nested child definitions MAY omit all three and is then treated as `type = "table"`. Parsers MUST reject a definition that declares more than one of these properties, or that declares none of them and has no nested child definitions. `type` accepts either a built-in type name or a named reusable definition from `[types]`. Container member types are selected separately with `itemtype`: it validates each member of an `array` or each dynamically keyed value of a `collection`. `itemtype` requires the same definition to declare the built-in `type = "array"` or `type = "collection"`; it cannot be attached to another built-in or to a named type reference.

```toml
[types]

[types.<typename>]
type = "<type-reference>"
description = "<human-readable description>"
itemtype = "<type-reference>"
items = [ "<type-reference>", ... ]
oneof = [ "<type-reference>", ... ]
anyof = [ "<type-reference>", ... ]
allowedvalues = [ <array-with-enumeration-of-allowed-values> ]
pattern = "<string-regex-for-string-validation>"
keypattern = "<string-regex-for-collection-key-validation>"
optional = true|false
min = <integer | float | offset-date-time | local-date-time | local-date | local-time>
max = <integer | float | offset-date-time | local-date-time | local-date | local-time>
minlength = <integer>
maxlength = <integer>
```

### Quoted and Special Keys

Schema child definitions use TOML tables. When a target TOML key is empty or contains characters that TOML requires to be quoted, such as a literal dot, quote that key in the schema table path.

Target keys may have the same names as TOML Schema properties, such as `type`, `itemtype`, `optional`, or `pattern`. When those names are used as child table path segments, they define target document keys rather than schema properties.

A schema definition with nested child definitions and no explicit `type`, `oneof`, or `anyof` is treated as `type = "table"`. This lets schemas describe target keys that would otherwise collide with schema properties.

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

`allowedvalues` provides a mechanism to set an enumeration of allowed values to be used in any given simple type.

For a non-array simple type, when `allowedvalues` is combined with `pattern`, `min`, `max`, `minlength`, or `maxlength`, every entry in `allowedvalues` MUST satisfy every applicable constraint. A schema containing an entry that violates one of those constraints is malformed, and parsers MUST reject it at schema-load time.

After a schema with `allowedvalues` has been loaded successfully, a document value is valid when it is a member of `allowedvalues`. Parsers do not need to re-evaluate the other constraints for that document value because every enumerated value has already been checked against them while loading the schema.

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
Parsers MUST reject array range constraints when the item schema can resolve to
different kinds or to a non-comparable kind.

A `min` or `max` boundary must be a TOML value that is comparable with the schema type: `integer` or `float` boundaries for `integer` and `float` values, and matching temporal boundaries for temporal values.

`nan`, `+nan`, and `-nan` are not valid `min` or `max` boundaries because NaN is unordered. `inf`, `+inf`, and `-inf` are valid float boundaries.

Date/time boundaries compare only against values of the same TOML temporal type. For example, an `offset-date-time` boundary applies to `offset-date-time` values, not to `local-date-time` values.

### Length - `minlength` and `maxlength`

This property may only be used when defining the allowed length of a `string`, an `array`, or a `collection`.

For `string` values, length is counted as the number of Unicode scalar values after TOML parsing and escape processing. It is not the number of UTF-8 bytes, UTF-16 code units, or user-perceived grapheme clusters. For example, `"\U0001F600"` has length 1, while `"e\u0301"` has length 2 because it is composed of two Unicode scalar values.

For `array` and `collection` values, length is counted as the number of items or dynamic entries.

Both `minlength` and `maxlength` MUST be integers `>= 0`. When both are present, `minlength` MUST be less than or equal to `maxlength`. A schema violating either rule is malformed and parsers MUST reject it at schema-load time.

### Conditions on `any`

No min/max condition may be applied to type `any`. The parser must show an error if this happens.

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

A `table` may have a set of properties, or none at all. If a table has a definition of properties, then the parser must validate the input and the input must match exactly the rules of the table and its children.

If a schema definition has nested child definitions but does not declare `type`, `oneof`, or `anyof`, parsers MUST treat it as if it declared `type = "table"`.

If a property of type `table` has no defined property and/or structure, the parser must not validate its input. This is useful for representing custom JSON data payloads.

#### Arrays

Arrays can be defined by mixing the following properties:

 - `itemtype`: a type reference used to validate every item in a homogeneous array.
 - `items`: ordered type references for tuple-style positional validation with fixed arity.
 - `minlength`: the minimum length of the array (e.g. no less than 2 elements).
 - `maxlength`: the maximum length of the array (e.g. no more than 2 elements).
 - `min`: the minimum value allowed for each comparable array item (e.g. 80).
 - `max`: the maximum value allowed for each comparable array item (e.g. 8080).
 - `allowedvalues`: enumeration of possible values.

`arraytype` is not a TOML Schema property. Parsers MUST reject schema
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
may be used only when `itemtype` resolves to one comparable built-in kind:
`integer`, `float`, or one of the four date/time types. When `itemtype`
references a named definition, aliases and alternatives are resolved before
this rule is checked.

Dates and Times are naturally sorted by past, present, future, meaning that the first element is in the past, and the furthest element is in the future.

`allowedvalues` does not have to be naturally sorted, but the lowest value must match `min` if it is available. The highest/furthest value must match `max` if it is available.

If `allowedvalues` does not match the conditions of `minlength`, `maxlength`, `min` and `max`, the parser must throw an error indicating that the TOML Schema is malformed.

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
 - When `items` is present, the array must have exactly the same number of items.
 - `items` is mutually exclusive with `itemtype`.
 - `items` is also mutually exclusive with `minlength` and `maxlength`.

#### Collection of Elements for Dynamic Keys

One can set an element of type `collection` when there is a need to have multiple children with dynamic, user-provided keys or table headers.

A `collection` is also a `table` and, therefore, it may have nested, schema-restricted key-value pairs of simple types.

A `collection` requires `itemtype` to define the type of its dynamic child values. Each dynamic child must be given a unique key in the TOML document. `itemtype` may reference a built-in type or a named reusable definition.

The built-in `collection` cannot itself be used as `itemtype` or as an entry in
`items`, `oneof`, or `anyof`: those bare references provide no place to declare
the nested collection's required `itemtype`. Define a reusable collection with
its own `itemtype` and reference that named definition instead.

When collection values may have alternative types, define those alternatives in a reusable `[types]` definition with `oneof` or `anyof`, then reference that definition with `itemtype`. This keeps `oneof` and `anyof` consistently scoped to the current node rather than changing their meaning on a container.

A `collection` may additionally constrain the **keys** (entry names) of its dynamic children with `keypattern`. See [Key Pattern - `keypattern`](#key-pattern---keypattern).


**Example:**
The below example shows a table `servers` that is a `collection`.
Each server must be given a key, and follow the defined structure of `types.serverType`.
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

When `type` selects a named reusable definition, the reference inherits that definition's validation rules as-is. The referencing definition MAY also declare `optional` and `description`, but it MUST NOT declare any other sibling property or child definition. In particular, validation constraints such as `pattern`, `keypattern`, `min`, `max`, `minlength`, `maxlength`, `allowedvalues`, `itemtype`, and `items` cannot be added or overridden at the reference site. Parsers MUST reject such schemas at schema-load time.

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

### Alternative Types - `oneof` and `anyof`

Use `oneof` or `anyof` when a value may validate against alternative type references.

- `oneof`: exactly one referenced type must validate.
- `anyof`: at least one referenced type must validate.

These properties can be used anywhere a schema definition can appear, including an `[elements]` field, a reusable `[types]` definition, and a type referenced through `itemtype` for array or collection items. Alternatives may reference built-in type names directly or named definitions when a branch needs constraints.

The bare built-in names `any` and `collection` MUST NOT appear directly in
`oneof` or `anyof`. Use a named reusable definition when an alternative needs a
fully defined collection or an intentionally unconstrained named branch.

`type`, `oneof`, and `anyof` all select the current node's type and are mutually exclusive. A parser MUST reject a definition containing more than one of them.

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
pattern = "^\\d+\\.\\d+\\.\\d+$"

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

### Description - `description`

`description` is an optional human-readable string that documents a schema definition. It may be used on reusable types, elements, and nested definitions. Parsers and tooling MAY use it for documentation, suggestions, and autocompletion; it does not affect validation.

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

### Optionality - `optional`

Properties may be defined as optional in the schema. By default, optional equals false, and the structure is required.

Parsers must only skip a structure validation if the structure is optional in the TOML Schema and does not exist in the TOML document. For any other condition, the parser must validate the input against the schema.

### Pattern - `pattern`

This property is only used for validating `string` input. Parsers must validate the input with the provided regular expression.

Parsers must support Perl/PCRE syntax. Parsers may support more extensions and other syntaxes.

The pattern is not implicitly anchored. A value validates if the regular expression matches anywhere in the string. Authors who require a full-string match must anchor the expression with `^` and `$` (or `\A` and `\z`).

### Key Pattern - `keypattern`

This property may only be used on a `collection`. It constrains the **keys** (entry names) of the
collection's dynamic children: every dynamically keyed entry must match the provided regular
expression. It does not validate entry *values* — that is the role of `itemtype`. It is
therefore orthogonal to `itemtype` and may be combined with it.

`keypattern` is invalid on any non-`collection` type (scalars, `array`, plain `table`), and a
parser must reject a schema that uses it elsewhere.

Keys that are explicitly declared as fixed child definitions of the collection (schema-restricted
key-value pairs) are validated by their own definitions and are not subject to `keypattern`. Only
dynamic, user-provided keys are matched against the pattern.

Parsers must support Perl/PCRE syntax, the same flavor as [`pattern`](#pattern---pattern). Like `pattern`, `keypattern` is not implicitly anchored: a key validates if the regular expression matches anywhere in the key string. Authors who require a full-key match must anchor the expression with `^` and `$`.

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

## Parsers

It is NOT the goal of a TOML Schema to ever modify the data output of a TOML object during parsing.

A parser that validates a TOML document against a TOML Schema must produce the exact same TOML data object as a parser that does not validate.

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

`version` is OPTIONAL. When present, it denotes the expected TOML Schema **language version** in the resolved schema document's `[toml-schema].version`; it is not an application version or an author-defined revision of that schema. Its value MUST be a string containing a full SemVer version in `MAJOR.MINOR.PATCH` form, with the same syntax defined by [Schema Versioning](#schema-versioning).

After resolving and loading the schema, a validator MUST compare these two language versions when the referencing document provides `version`. A different major version is incompatible and schema discovery MUST fail. Any other unequal version, including a minor, patch, pre-release, or build metadata difference, MUST produce a warning but MUST NOT by itself cause validation to fail. Compatibility between the resolved schema and the validator remains governed by [Schema Versioning](#schema-versioning).

The root `[toml-schema]` table is reserved for schema metadata. Validators should use it to locate schema information and should not treat it as application data unless the schema explicitly defines `[elements.toml-schema]`.

When `[elements.toml-schema]` is omitted, validators should ignore the reserved metadata table during application-data validation. When `[elements.toml-schema]` is present, validators must validate the metadata table like any other table.

Only simple *built-in types* are **allowed** in this metadata table.
