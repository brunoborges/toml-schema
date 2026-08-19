/**
 * @tomlschema/toml-schema — a Node.js/TypeScript reference implementation of
 * the [TOML Schema](https://github.com/brunoborges/toml-schema) 1.0 specification.
 *
 * @packageDocumentation
 */

export { BUILTIN_TYPES, DEFINITION_KEYS, CURRENT_TOML_SCHEMA_VERSION } from "./builtins.js";
export type { SchemaType, DefinitionKey } from "./builtins.js";

export type {
  TomlScalar,
  TomlTable,
  TomlValue,
} from "./values.js";

export { Definition } from "./definition.js";
export type { Condition } from "./definition.js";

export { SchemaError, DocumentError } from "./errors.js";

export { parseToml, loadDocument } from "./document.js";

export { Schema, loadSchema, loadSchemaFromSource } from "./schema.js";

export {
  schemaFromDocument,
  validateDocument,
  resolveSchemaLocation,
  compareDocumentSchemaVersion,
} from "./discovery.js";
export type { DiscoveryResult } from "./discovery.js";

export { generateSchema, extractSchemaFile } from "./extract.js";

export { ValidationResult } from "./validator.js";
export type { Severity, ValidationError, Diagnostic } from "./validator.js";

export { parseSemVer, validateSchemaVersion } from "./semver.js";
export type { SemVerParts } from "./semver.js";
