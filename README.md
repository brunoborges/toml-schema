# The TOML Schema Definition

A [TOML Schema](https://github.com/toml-lang/tosd) is a set of TOML-based constructs that define the structure, the names, and the types of configuration data on a TOML file. 

The TOML Schema is used to validate the input of a TOML file during parsing to:

1. Eliminate or reduce misconfiguration that could potentially damage if only validated during production evaluation, 
1. Be leveraged by editors and other tools to provide and enrich auto-completion and code hints for validation on the fly.

The schema format follows the TOML specification, meaning that a TOML Schema is in itself a valid TOML document.

- [The TOML Schema Definition](#the-toml-schema-definition)
  - [First Glance](#first-glance)
  - [Schema Structure Reference](#schema-structure-reference)
    - [Top-level Structure Conditions](#top-level-structure-conditions)
  - [Metadata Table - `[toml-schema]`](#metadata-table---toml-schema)
    - [Supported Properties](#supported-properties)
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
        - [Observations on Conditions to Arrays](#observations-on-conditions-to-arrays)
      - [Sequence of Elements for Dynamic Keys](#sequence-of-elements-for-dynamic-keys)
    - [Type Reference](#type-reference)
    - [Optionality - `optional`](#optionality---optional)
    - [Pattern - `pattern`](#pattern---pattern)
- [Filename Extension](#filename-extension)
- [MIME Types](#mime-types)
- [TOML Reference of a TOML Schema](#toml-reference-of-a-toml-schema)
- [Discussion](#discussion)
  - [Existing TOML Schema Proposal](#existing-toml-schema-proposal)
- [Contributors](#contributors)

## First Glance

Example of a TOML Schema that validates the TOML document displayed on [toml.io](https://toml.io/en/) main page:

```toml
[toml-schema]
version = "1"

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
type="sequence"
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
version = "1.0"
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

## Elements table - `[elements]`

The `elements` table defines the overall structure and properties of the TOML document. Elements follow the same structure and rules of Types, specified below, except that elements cannot reference other elements. To reuse conditions and structures, `[types]` must be defined and referenced back from the `[elements]` table.

## Types table - `[types]`

The `[types]` table is for use when there is a need for custom, reusable types of structure or properties. A `type` is referenced in an `element` by the property `typeof`.

```toml
[types]

[types.<typename>]
type = "<simple-type> | array | table | sequence"
typeof = "<full-name-of-a-defined-type>"
arraytype = "<simple-type>"
allowedvalues = [ <array-with-enumeration-of-allowed-values> ]
pattern = "<string-regex-for-string-validation>"
optional = true|false
min = <any>
max = <any>
minlength = <integer>
maxlength = <integer>
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

This property may only be used when defining a value range for the following types:

 - `array`
 - `float`
 - `integer`
 - `date` and/or `time` types
 
### Length - `minlength` and `maxlength`

This property may only be used when defining the allowed length of a `string`, an `array`, or a `sequence`.

### Conditions on `any`

No min/max condition may be applied to type `any`. The parser must show an error if this happens.

### Block Types

- Array: `array`
- Table: `table` (*)
- Sequence: `sequence` (*)

(*) The schema also explicitly defines two types:

1. The implicit TOML type `table` for specifying child elements associated to the parent.
1. A type for a sequence of elements, `sequence`.

For simplicity, there is no definition of `inline table` since these are just tables that can be expressed inlined in a TOML document.

#### Tables

A `table` may have a set of properties, or none at all. If a table has a definition of properties, then the parser must validate the input and the input must match exactly the rules of the table and its childs. 

If a property of type `table` has no defined property and/or structure, the parser must not validate its input. This is useful for representing custom JSON data payloads.

#### Arrays

Arrays can be defined by mixing the following properties:

 - `arraytype`: the type of the value in the array (e.g. string).
 - `minlength`: the minimum length of the array (e.g. no less than 2 elements).
 - `maxlength`: the maximum length of the array (e.g. no more than 2 elements).
 - `minvalue`: the minimum value of the array (e.g. 80).
 - `maxvalue`: the maximum value of the array (e.g. 8080).
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

The `minvalue` and `maxvalue` conditions are used to set a valid range of values, and it may be applied only to properties where `arraytype` is one of the following: `integer`, `float`, and the four available `date` and/or `time` types. Both properties are **inclusive**.

Dates and Times are naturally sorted by past, present, future, meaning that the first element is in the past, and the furthest element is in the future.

`allowedvalues` does not have to be naturally sorted, but the lowest value must match `minvalue` if it is available. The highest/furthest value must match `maxvalue` if it is available.

If `allowedvalues` does not match the conditions of `minlength`, `maxlength`, `minvalue` and `maxvalue`, the parser must throw an error indicating that the TOML Schema is malformed.

If `arraytype` is not defined, then the type of array elements is `any`, and any data type can be used and mixed together.

If `type` is `array` and `arraytype` is of type `array`, then automatically any data type can be used and mixed together.

#### Sequence of Elements for Dynamic Keys

One can set an element of type `sequence` for when there is a need to have multiple childs with dymamic, user-provided keys or table headers.

A `sequence` is also a `table` and, therefore, it may have nested, schema-restricted key-value pairs of simple types.

A `sequence` requires a type definition of the child elements. Each child must be given a unique key in the TOML document.

The types allowed in a sequence may be defined with **only one** of the following attributes:

 - `typeof`: a single type. Parser must validate against this type.
 - `oneof`: one type of a provided array of types. Only one type must return `true` in the validation. Parser must throw an error if more than one type is valid for the input.
 - `anyof`: any type of a provided array of types. Parser stops validating at the first return of a `true` validation. Parser should throw an error if input is not valid for any type.

__Validation__: 

The below example shows a table `servers` that is a `sequence`. 
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
        type = "sequence"
        anyof = [ "types.dnsType", "types.hostnameType" ]

[elements]

    [elements.servers]
    type = "sequence"
    typeof = "types.serverType"

        [elements.servers.group]
        type = "string"
```

A `sequence` may be represented as an array of tables in a TOML document.

### Type Reference

A type may be referenced to inherit the defined rules existent in given type. Both `type` and `element` may reference a `type`.

```toml
[types]

    [types.nameType]
    type="string"
    pattern="[a-zA-Z]"

    [types.serverType.name]
    typeof = "types.nameType"

[elements]

    [elements.datacenter]
    type="table"

        [elements.datacenter.name]
        typeof="types.nameType"

        [elements.datacenter.servers]
        type = "sequence"
        typeof = "types.serverType"
```

### Optionality - `optional`

Properties may be defined as optional in the schema. By default, optional equals false, and the structure is required.

Parsers must only skip a structure validation if the structure is optinal in the TOML Schema and does not exist in the TOML document. For any other condition, the parser must validate the input against the schema.

### Pattern - `pattern`

This property is only used for validating `string` input. Parsers must validate the input with the provided regular expression.

Parsers must support Perl/PCRE syntax. Parsers may support more extensions and other syntaxes.

# Filename Extension

TOML Schema files should use the extension `.tosd`.

# MIME Types

When transferring TOML Schema files over the internet, the appropriate MIME types are:

 - application/tosd
 - application/vnd.tosd
 - application/x-tosd
 - text/tosd
 - text/vnd.tosd
 - text/x-tosd

# TOML Reference of a TOML Schema

A TOML file must have this indication at the top, to reference which schema file to use for validation:

```toml
[toml-schema]
version = "1"
location = "<uri>"
```

Where `<uri>` can be a remote URL (e.g. https) or a local file.

Only simple *built-in types* are **allowed**.

# Discussion

If you want to share your thoughts on this proposal, please go to the [General Discussion](https://github.com/brunoborges/toml-schema/discussions/2).

## Existing TOML Schema Proposal

There is an ongoing effort to bring Schema support for TOML under the [PR 116](https://github.com/toml-lang/toml/pull/116/). I found that proposal to be extensively detailed and well constructed, but I believe this simpler proposal to be more realistic.

# Contributors

Thanks to my friends!

- Andres Almiray [@aalmiray](https://twitter.com/aalmiray).
