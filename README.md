# The TOML Schema Definition

A [TOML](https://github.com/toml-lang/toml) schema is a set of elements that define the structure, the names, and the types of configuration data on a TOML file. The TOML Schema is used to validate the input of a TOML file during parsing to reduce or avoid misconfiguration that could potentially damage if only validated during production evaluation.

The schema format follows the TOML specification, and aims at being simple yet elegant.

## Schema Reference

A TOML file must have this indication at the top, to reference which schema file to use for validation:

```toml
[tomlsd]
version = 2
schema = "<uri>"
```

Where `<uri>` can be a remote URL or a local file.

## Element Definition

An element can be defined by constructing a table followed by a set of properties to define that element.

```toml
[<element-name>]
type=<built-in-type>
arraytype=<simple-built-in-type>
optional=<boolean>
default=<default-value>
min=<integer>
max=<integer>
```

### Element Name

Declares the name of the element.

### Type

Declares the type of the element.

### Built-in Types

The allowed types are the ones supported by the TOML Specification:

#### Simple Types

- String: `string`
- Integer: `integer`
- Float: `float`
- Boolean: `boolean`
- Offset Date-Time: `offset-date-time`
- Local Date-Time: `local-date-time`
- Local Date: `local-date`
- Local Time: `local-time`

#### Structure Types

- Array: `array`
- Inline Table: `inline-table`
- Table: `table` (*)
- Table Sequence: `table-sequence` (*)

(*) The schema also explicitly defines two new types:

1. The implicit TOML type `table` for specifying child elements associated to the parent.
1. A type for a sequence of tables, `table-sequence`.

### Array Type

Arrays by default will have unchecked value types. User may specify an `arraytype` if a specific type must be checked.

Example for schema definition:

```toml
[colors]
type=array
arraytype=string
```

Example of TOML file:

```toml
colors=[ "red", "yellow", "green" ]
```

Only simple *built-in types* are **allowed**.

### Optional

Defines whether this element is optional or not. **Defaults to false**.

### Default

The default value the parser should read when this element is not explicitly defined in the TOML file.

An element of type `boolean` will default to `false` when omitted, unless defined otherwise in the user-provided schema file.

### Min/Max

The minimal/maximum value of an element. This attribute is applicable to the following types:

- String: length
- Integer: value
- Float: value

## Discussion

If you want to share your thoughts on this proposal, please go to the [General Discussion](https://github.com/brunoborges/toml-schema/issues/1) issue.
