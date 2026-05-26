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
  - [Keys That Need Escaping](#keys-that-need-escaping)
  - [Simple Types - `<simple-type>`](#simple-types---simple-type)
    - [Allowed Values for Simple Types - `allowedvalues`](#allowed-values-for-simple-types---allowedvalues)
  - [Minimum Value / Maximum Value - `min` and `max`](#minimum-value-maximum-value---min-and-max)
  - [Length - `minlength` and `maxlength`](#length---minlength-and-maxlength)
  - [Conditions on `any`](#conditions-on-any)
  - [Block Types](#block-types)
    - [Tables](#tables)
    - [Arrays](#arrays)
      - [Tuple / Positional Array Validation - `items`](#tuple-positional-array-validation---items)
    - [Collection of Elements for Dynamic Keys](#collection-of-elements-for-dynamic-keys)
  - [Type Reference](#type-reference)
  - [Alternative Types - `oneof` and `anyof`](#alternative-types---oneof-and-anyof)
  - [Optionality - `optional`](#optionality---optional)
  - [Pattern - `pattern`](#pattern---pattern)
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
    arraytype = "integer"
    [elements.database.data]
    type = "array"
    arraytype = "array"
    [elements.database.temp_targets]
    type = "table"

[elements.servers]
type="collection"
typeof = "types.serverType"
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
 - `[types]`: table with definition of types to be reused in elements`.
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

 - `version`: the version of this schema file. **Type:** string.
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

The `elements` table defines the overall structure and properties of the TOML document. Elements follow the same structure and rules of Types, specified below, except that elements cannot reference other elements. To reuse conditions and structures, `[types]` must be defined and referenced back from the `[elements]` table.

## Types table - `[types]`

The `[types]` table is for use when there is a need for custom, reusable types of structure or properties. A type is referenced in an element or another type with a type reference.

Type references are strings accepted by `typeof`, `itemtype`, `items`, `oneof`, and `anyof`. A type reference may be either:

- a built-in type name such as `"string"`, `"boolean"`, or `"integer"`;
- a named reusable definition from `[types]`, written either as `"types.<typename>"` or `"<typename>"`.

Built-in type names are reserved and MUST NOT be used as `[types]` definition names. The reserved names are `any`, `string`, `integer`, `float`, `boolean`, `offset-date-time`, `local-date-time`, `local-date`, `local-time`, `array`, `table`, and `collection`. The legacy alias `table-collection` is also reserved when accepted by a parser.

```toml
[types]

[types.<typename>]
type = "<simple-type> | array | table | collection"
typeof = "<type-reference>"
arraytype = "<simple-type> | array | table"
itemtype = "<type-reference>"
items = [ "<type-reference>", ... ]
oneof = [ "<type-reference>", ... ]
anyof = [ "<type-reference>", ... ]
allowedvalues = [ <array-with-enumeration-of-allowed-values> ]
pattern = "<string-regex-for-string-validation>"
optional = true|false
min = <any>
max = <any>
minlength = <integer>
maxlength = <integer>
```

### Keys That Need Escaping

Schema child definitions usually use nested TOML tables, but TOML keys can be quoted, empty, contain dots, or collide with built-in schema property names such as `type`, `typeof`, and `optional`. Use a `children` table to define those keys unambiguously.

Example TOML document:

```toml
"" = "blank"

[site]
"google.com" = true
```

Schema:

```toml
[elements.children]
"" = { type = "string" }

[elements.site]
type = "table"

    [elements.site.children]
    "google.com" = { type = "boolean" }
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
 - `array`, when `arraytype` is one of the numeric or date/time types above

For arrays, `min` and `max` apply to each array item. They cannot be combined with `itemtype`; put range constraints in the referenced item type instead.

`nan`, `+nan`, and `-nan` are not valid `min` or `max` boundaries because NaN is unordered. `inf`, `+inf`, and `-inf` are valid float boundaries.

Date/time boundaries compare only against values of the same TOML temporal type. For example, an `offset-date-time` boundary applies to `offset-date-time` values, not to `local-date-time` values.

### Length - `minlength` and `maxlength`

This property may only be used when defining the allowed length of a `string`, an `array`, or a `collection`.

For `string` values, length is counted as the number of Unicode scalar values after TOML parsing and escape processing. It is not the number of UTF-8 bytes, UTF-16 code units, or user-perceived grapheme clusters. For example, `"\U0001F600"` has length 1, while `"e\u0301"` has length 2 because it is composed of two Unicode scalar values.

For `array` and `collection` values, length is counted as the number of items or dynamic entries.

### Conditions on `any`

No min/max condition may be applied to type `any`. The parser must show an error if this happens.

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

If a property of type `table` has no defined property and/or structure, the parser must not validate its input. This is useful for representing custom JSON data payloads.

#### Arrays

Arrays can be defined by mixing the following properties:

 - `arraytype`: the built-in type of each value in the array (e.g. string, array, or table).
 - `itemtype`: a type reference used to validate each item in the array.
 - `items`: ordered type references for tuple-style positional validation with fixed arity.
 - `minlength`: the minimum length of the array (e.g. no less than 2 elements).
 - `maxlength`: the maximum length of the array (e.g. no more than 2 elements).
 - `min`: the minimum value allowed for each comparable array item (e.g. 80).
 - `max`: the maximum value allowed for each comparable array item (e.g. 8080).
 - `allowedvalues`: enumeration of possible values.

Example for schema definition:

```toml
[elements.colors]
type="array"
arraytype="string"
```

Example of TOML file:

```toml
colors=[ "red", "yellow", "green" ]
```

##### Observations on Conditions to Arrays

The `min` and `max` conditions are used to set a valid range of values, and it may be applied only to properties where `arraytype` is one of the following: `integer`, `float`, and the four available `date` and/or `time` types. Both properties are **inclusive**.

Dates and Times are naturally sorted by past, present, future, meaning that the first element is in the past, and the furthest element is in the future.

`allowedvalues` does not have to be naturally sorted, but the lowest value must match `min` if it is available. The highest/furthest value must match `max` if it is available.

If `allowedvalues` does not match the conditions of `minlength`, `maxlength`, `min` and `max`, the parser must throw an error indicating that the TOML Schema is malformed.

If `arraytype` is not defined, then the type of array elements is `any`, and any data type can be used and mixed together.

If `type` is `array` and `arraytype` is of type `array`, then automatically any data type can be used and mixed together.

##### Array Item Schemas and Arrays of Tables

Use `itemtype` when each array item must be validated against a reusable schema definition. This is required for TOML arrays of tables and arrays of inline tables, because both parse as arrays whose items are table values.

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
arraytype = "table"
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
arraytype = "table"
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
 - `items` is mutually exclusive with `arraytype` and `itemtype`.
 - `items` is also mutually exclusive with `minlength` and `maxlength` (and aliases `minoccurs` / `maxoccurs`).

#### Collection of Elements for Dynamic Keys

One can set an element of type `collection` for when there is a need to have multiple children with dymamic, user-provided keys or table headers.

A `collection` is also a `table` and, therefore, it may have nested, schema-restricted key-value pairs of simple types.

A `collection` requires a type definition of the child elements. Each child must be given a unique key in the TOML document.

The types allowed in a collection may be defined with **only one** of the following attributes:

 - `typeof`: a single type. Parser must validate against this type.
 - `oneof`: one type of a provided array of types. Only one type must return `true` in the validation. Parser must throw an error if more than one type is valid for the input.
 - `anyof`: any type of a provided array of types. Parser stops validating at the first return of a `true` validation. Parser should throw an error if input is not valid for any type.


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

    [types.serverType]
    type = "table"

        [types.serverType.name]
        type = "string"

        [types.serverType.address]
        type = "string"

        [types.serverType.dnstable]
        type = "collection"
        anyof = [ "types.dnsType", "types.hostnameType" ]

[elements]

    [elements.servers]
    type = "collection"
    typeof = "types.serverType"

        [elements.servers.group]
        type = "string"
```

A `collection` may be represented as subtables of a common table in a TOML document.

### Type Reference

A type reference applies the referenced built-in type or inherits the rules of a named reusable type. Both `[types]` definitions and `[elements]` definitions may use type references.

```toml
[types]

    [types.nameType]
    type="string"
    pattern="[a-zA-Z]"

    [types.serverType.name]
    typeof = "types.nameType"

    [types.serverType.enabled]
    typeof = "boolean"

[elements]

    [elements.datacenter]
    type="table"

        [elements.datacenter.name]
        typeof="types.nameType"

        [elements.datacenter.tags]
        type = "array"
        itemtype = "string"

        [elements.datacenter.servers]
        type = "collection"
        typeof = "types.serverType"
```

### Alternative Types - `oneof` and `anyof`

Use `oneof` or `anyof` when a value may validate against alternative type references.

- `oneof`: exactly one referenced type must validate.
- `anyof`: at least one referenced type must validate.

These properties can be used anywhere a schema definition can appear, including an `[elements]` field, a reusable `[types]` definition, and a type referenced through `itemtype` for array items. Alternatives may reference built-in type names directly or named definitions when a branch needs constraints.

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

Use a named reusable definition whenever an alternative needs constraints such as `pattern`, `min`, `allowedvalues`, `arraytype`, or child fields.

```toml
[types.dependencyVersion]
type = "string"
pattern = "^\\d+\\.\\d+\\.\\d+$"

[types.inlineDependency]
type = "table"

[types.dependency]
oneof = [ "types.dependencyVersion", "types.inlineDependency" ]
```

### Optionality - `optional`

Properties may be defined as optional in the schema. By default, optional equals false, and the structure is required.

Parsers must only skip a structure validation if the structure is optional in the TOML Schema and does not exist in the TOML document. For any other condition, the parser must validate the input against the schema.

### Pattern - `pattern`

This property is only used for validating `string` input. Parsers must validate the input with the provided regular expression.

Parsers must support Perl/PCRE syntax. Parsers may support more extensions and other syntaxes.

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
version = "1.0.0"
location = "<uri>"
```

Where `<uri>` can be a remote URL (e.g. https) or a local file.

The root `[toml-schema]` table is reserved for schema metadata. Validators should use it to locate schema information and should not treat it as application data unless the schema explicitly defines `[elements.toml-schema]`.

When `[elements.toml-schema]` is omitted, validators should ignore the reserved metadata table during application-data validation. When `[elements.toml-schema]` is present, validators must validate the metadata table like any other table.

Only simple *built-in types* are **allowed** in this metadata table.
