/**
 * Built-in TOML Schema vocabulary: the scalar/container type names and the
 * definition-level property names. These lists are exercised directly by the
 * ABNF conformance test to guard against vocabulary drift.
 */

/** The complete set of TOML Schema 1.0 built-in type names. */
export const BUILTIN_TYPES = [
  "any",
  "string",
  "integer",
  "float",
  "boolean",
  "offset-date-time",
  "local-date-time",
  "local-date",
  "local-time",
  "array",
  "table",
  "collection",
] as const;

/** A TOML Schema built-in type name. */
export type SchemaType = (typeof BUILTIN_TYPES)[number];

const BUILTIN_TYPE_SET: ReadonlySet<string> = new Set(BUILTIN_TYPES);

/** The complete set of TOML Schema 1.0 definition-level property keys. */
export const DEFINITION_KEYS = [
  "type",
  "description",
  "itemtype",
  "items",
  "allowedvalues",
  "pattern",
  "keypattern",
  "optional",
  "min",
  "max",
  "minlength",
  "maxlength",
  "oneof",
  "anyof",
  "dependentrequired",
  "mutuallyexclusive",
  "exactlyone",
  "allof",
  "uniqueitems",
  "default",
  "deprecated",
  "if",
  "then",
  "else",
] as const;

/** A TOML Schema 1.0 definition-level property key. */
export type DefinitionKey = (typeof DEFINITION_KEYS)[number];

const DEFINITION_KEY_SET: ReadonlySet<string> = new Set(DEFINITION_KEYS);

/** Properties a named `type` reference definition may additionally declare. */
export const NAMED_REFERENCE_KEYS: ReadonlySet<string> = new Set([
  "type",
  "description",
  "optional",
  "allof",
  "default",
  "deprecated",
]);

/** Properties a `oneof`/`anyof` union definition may additionally declare. */
export const UNION_KEYS: ReadonlySet<string> = new Set([
  "oneof",
  "anyof",
  "description",
  "optional",
  "allof",
  "default",
  "deprecated",
]);

/** Properties an `if`/`then`/`else` conditional definition may additionally declare. */
export const CONDITIONAL_KEYS: ReadonlySet<string> = new Set([
  "if",
  "then",
  "else",
  "description",
  "optional",
  "allof",
  "default",
  "deprecated",
]);

/** The TOML Schema language version this implementation targets. */
export const CURRENT_TOML_SCHEMA_VERSION = "1.0.0";

export function isDefinitionKey(key: string): key is DefinitionKey {
  return DEFINITION_KEY_SET.has(key);
}

export function parseSchemaType(value: string): SchemaType | undefined {
  return BUILTIN_TYPE_SET.has(value) ? (value as SchemaType) : undefined;
}

export function isRangeComparable(typeName: SchemaType | undefined): boolean {
  switch (typeName) {
    case "integer":
    case "float":
    case "offset-date-time":
    case "local-date-time":
    case "local-date":
    case "local-time":
      return true;
    default:
      return false;
  }
}

/**
 * Removes the optional `types.` reference prefix exactly once, so both
 * `"network.endpoint"` and `"types.network.endpoint"` resolve to the same
 * `[types."network.endpoint"]` definition.
 */
export function normalizeReference(reference: string): string {
  return reference.startsWith("types.") ? reference.slice("types.".length) : reference;
}

export function normalizeReferences(references: readonly string[]): string[] {
  return references.map(normalizeReference);
}
