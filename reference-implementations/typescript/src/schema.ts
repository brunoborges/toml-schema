import { readFile } from "node:fs/promises";
import { AnnotationResolver, validateAllowedValueTypes, validateArrayRanges, validateDefaults, validateReferences, validateSelectorCycles, validateSemantics, type SchemaData } from "./semantics.js";
import { parseDefinitions } from "./schemaParser.js";
import { Definition, type RawDefinition } from "./definition.js";
import { SchemaSource } from "./tomlSource.js";
import { parseToml } from "./document.js";
import { SchemaError, DocumentError, DocumentParseError } from "./errors.js";
import { DiagnosticCodes } from "./diagnostics.js";
import { validateSchemaVersion } from "./semver.js";
import { DocumentValidator, ValidationResult } from "./validator.js";
import { isTomlTable, type TomlTable, type TomlValue } from "./values.js";
import { appendPath } from "./paths.js";

const TOP_LEVEL_KEYS = new Set(["toml-schema", "types", "elements"]);
const TOML_SCHEMA_KEYS = new Set(["version", "meta"]);

/**
 * A loaded, fully schema-load-time-validated TOML Schema document. Construct
 * instances with {@link loadSchema} or {@link schemaFromDocument}; validate
 * TOML documents against one with {@link Schema.validate} or
 * {@link Schema.validateFile}.
 */
export class Schema {
  readonly #data: SchemaData;
  readonly #version: string;
  readonly #warnings: string[];

  /** @internal */
  constructor(data: SchemaData, version: string, warnings: string[] = []) {
    this.#data = data;
    this.#version = version;
    this.#warnings = warnings;
  }

  /** @internal */
  get data(): SchemaData {
    return this.#data;
  }

  /** The `[toml-schema].version` this schema declares. */
  get version(): string {
    return this.#version;
  }

  /** Non-fatal warnings produced while discovering this schema (e.g. a version mismatch). */
  get warnings(): readonly string[] {
    return this.#warnings;
  }

  /** @internal */
  addWarning(warning: string): void {
    this.#warnings.push(warning);
  }

  /** Looks up a top-level element definition, with inherited annotations resolved. */
  element(name: string): Definition | undefined {
    const definition = this.#data.elements[name];
    if (!definition) return undefined;
    return new Definition(this.withEffectiveAnnotations(definition));
  }

  /** Looks up a named reusable type definition, with inherited annotations resolved. */
  type(name: string): Definition | undefined {
    const normalized = name.startsWith("types.") ? name.slice("types.".length) : name;
    const definition = this.#data.types[normalized];
    if (!definition) return undefined;
    return new Definition(this.withEffectiveAnnotations(definition));
  }

  private withEffectiveAnnotations(definition: RawDefinition): RawDefinition {
    const resolver = new AnnotationResolver(this.#data, (candidate) =>
      new DocumentValidator(this.#data).resolve(candidate, new Set()),
    );
    return resolver.resolve(definition);
  }

  /** Validates an already-parsed TOML document table against this schema's `[elements]`. */
  validate(document: TomlTable): ValidationResult {
    const validator = new DocumentValidator(this.#data);
    validator.validateTable("$", document, this.#data.elements);
    for (const key of Object.keys(document)) {
      if (!Object.hasOwn(this.#data.elements, key) && key !== "toml-schema") {
        validator.add(DiagnosticCodes.UNKNOWN_KEY, appendPath("$", key), "$.elements", "unexpected key");
      }
    }
    return validator.toResult();
  }

  /**
   * Reads, parses, and validates a TOML document file against this schema.
   *
   * @throws {DocumentParseError} if the file is not well-formed TOML. Per SPEC.md
   * such a parse failure is not a validation diagnostic: it never reaches the
   * validator and MUST NOT be reported as a diagnostic or as an invalid document.
   */
  async validateFile(path: string): Promise<ValidationResult> {
    let document: TomlTable;
    try {
      document = parseToml(await readFile(path, "utf-8"));
    } catch (cause) {
      throw new DocumentParseError(cause instanceof Error ? cause.message : String(cause));
    }
    return this.validate(document);
  }
}

/** Loads and fully schema-load-time-validates a TOML Schema (`.tosd`) document from disk. */
export async function loadSchema(path: string): Promise<Schema> {
  let source: string;
  try {
    source = await readFile(path, "utf-8");
  } catch (cause) {
    throw new DocumentError(
      `unable to read schema ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return loadSchemaFromSource(path, source);
}

/** Parses and fully schema-load-time-validates TOML Schema source text already read from `path`. */
export function loadSchemaFromSource(path: string, source: string): Schema {
  let parsed: TomlTable;
  try {
    parsed = parseToml(source);
  } catch (cause) {
    throw new SchemaError(
      `unable to parse schema ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const schemaSource = new SchemaSource(source);

  const metadataValue = parsed["toml-schema"];
  if (!isTomlTable(metadataValue)) {
    throw new SchemaError("schema must contain a [toml-schema] table");
  }
  const elementsValue = parsed["elements"];
  if (!isTomlTable(elementsValue)) {
    throw new SchemaError("schema must contain an [elements] table");
  }
  for (const key of Object.keys(parsed)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new SchemaError(`unsupported top-level schema key: ${key}`);
    }
  }
  const version = metadataValue["version"];
  if (version === undefined) {
    throw new SchemaError("[toml-schema] must contain version");
  }
  validateSchemaVersion(version);
  for (const key of Object.keys(metadataValue)) {
    if (!TOML_SCHEMA_KEYS.has(key)) {
      throw new SchemaError(`unsupported [toml-schema] key: ${key}`);
    }
  }

  const typesValue = parsed["types"];
  const types = parseDefinitions(
    "types",
    isTomlTable(typesValue) ? typesValue : undefined,
    false,
    schemaSource,
  );
  const elements = parseDefinitions("elements", elementsValue, true, schemaSource);

  const data: SchemaData = { types, elements };
  validateReferences(data, types);
  validateReferences(data, elements);
  validateSelectorCycles(data);
  validateAllowedValueTypes(data);
  validateSemantics(data);
  validateArrayRanges(data);
  validateDefaults(data, (definition, value: TomlValue) => {
    const candidate = new DocumentValidator(data, true);
    candidate.validateValue(definition.name, value, definition);
    return candidate.errors[0]?.message;
  });

  return new Schema(data, version, []);
}
