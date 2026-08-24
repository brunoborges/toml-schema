import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { TomlDate } from "smol-toml";
import { DocumentError, SchemaError } from "./errors.js";
import { DiagnosticCodes } from "./diagnostics.js";
import { loadSchemaFromSource, Schema } from "./schema.js";
import { parseSemVer } from "./semver.js";
import { parseToml } from "./document.js";
import { isTomlTable, type TomlTable } from "./values.js";
import { ValidationResult, type Diagnostic, type ValidationError } from "./validator.js";

/** The result of resolving a schema from a document's `[toml-schema]` metadata. */
export interface DiscoveryResult {
  readonly schema: Schema;
  readonly document: TomlTable;
}

function isSchemaReferenceScalar(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "bigint" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof TomlDate
  );
}

const INVALID_URI_REFERENCE_CHARACTERS = new Set(['\\', '"', "<", ">", "^", "`", "{", "|", "}"]);

function hasInvalidURIReferenceCharacter(reference: string): boolean {
  for (const character of reference) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
    if (INVALID_URI_REFERENCE_CHARACTERS.has(character)) return true;
  }
  return false;
}

const LOCATION_SCHEMA_PATH = "$.toml-schema.location";
const VERSION_SCHEMA_PATH = "$.toml-schema.version";
const discoveryOptions = (code: string, schemaPath = LOCATION_SCHEMA_PATH) => ({
  phase: "discovery" as const,
  code,
  schemaPath,
});

function localPathFromFileURL(url: URL): string {
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    throw new SchemaError("file URI contains unsupported components", discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION));
  }
  if (url.hostname !== "" && url.hostname.toLowerCase() !== "localhost") {
    throw new SchemaError("file URI has a non-local host", discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION));
  }
  const escapedPath = url.pathname.toLowerCase();
  if (escapedPath.includes("%2f") || escapedPath.includes("%5c")) {
    throw new SchemaError("file URI contains an encoded path separator", discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION));
  }
  if (url.pathname === "" || url.pathname.includes("\0")) {
    throw new SchemaError("file URI does not contain a safe path", discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION));
  }
  let localPath: string;
  try {
    localPath = fileURLToPath(url);
  } catch (cause) {
    throw new SchemaError(
      `invalid file schema location: ${cause instanceof Error ? cause.message : String(cause)}`,
      discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION),
    );
  }
  if (!path.isAbsolute(localPath)) {
    throw new SchemaError("file URI path is not absolute", discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION));
  }
  return localPath;
}

/**
 * Resolves a `[toml-schema].location` value (an absolute path or a relative
 * `file:` URI reference against the document's own location) to a local
 * filesystem path.
 */
export function resolveSchemaLocation(documentPath: string, location: string): string {
  if (path.isAbsolute(location)) {
    return path.normalize(location);
  }
  if (hasInvalidURIReferenceCharacter(location)) {
    throw new SchemaError(`invalid [toml-schema].location URI: ${location}`, discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION));
  }
  // WHATWG URL resolution treats `file:schema.tosd` as relative to a file base,
  // but RFC 3986 classifies it as an opaque absolute URI, which is not retrievable.
  if (/^file:[^/]/i.test(location)) {
    throw new SchemaError(
      `invalid file schema location: ${location}: file URI contains unsupported components`,
      discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION),
    );
  }
  const absoluteDocumentPath = path.resolve(documentPath);
  const base = pathToFileURL(absoluteDocumentPath);
  let resolved: URL;
  try {
    resolved = new URL(location, base);
  } catch (cause) {
    throw new SchemaError(
      `invalid [toml-schema].location URI: ${location}: ${cause instanceof Error ? cause.message : String(cause)}`,
      discoveryOptions(DiagnosticCodes.DISCOVERY_UNRESOLVED_LOCATION),
    );
  }
  if (resolved.protocol.toLowerCase() !== "file:") {
    throw new SchemaError(
      `schema retrieval is not permitted for URI scheme: ${resolved.protocol.replace(/:$/, "")}`,
      discoveryOptions(DiagnosticCodes.SCHEMA_RETRIEVAL_REFUSED),
    );
  }
  const localPath = localPathFromFileURL(resolved);
  return path.normalize(localPath);
}

/** Compares a document's expected schema version against the resolved schema's actual version. */
export function compareDocumentSchemaVersion(expected: unknown, actual: string): Diagnostic | undefined {
  const discovery = { phase: "discovery" as const, schemaPath: VERSION_SCHEMA_PATH };
  if (typeof expected !== "string") {
    throw new SchemaError("document [toml-schema].version must be a SemVer string", {
      ...discovery,
      code: DiagnosticCodes.DISCOVERY_INVALID_METADATA,
    });
  }
  const expectedParts = parseSemVer(expected);
  if (!expectedParts) {
    throw new SchemaError("document [toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax", {
      ...discovery,
      code: DiagnosticCodes.DISCOVERY_INVALID_METADATA,
    });
  }
  const actualParts = parseSemVer(actual);
  if (!actualParts || expectedParts.major !== actualParts.major) {
    throw new SchemaError(
      `document expects TOML Schema major version ${expected}, but resolved schema uses ${actual}`,
      { ...discovery, code: DiagnosticCodes.UNSUPPORTED_VERSION },
    );
  }
  if (expected !== actual) {
    return {
      phase: "discovery",
      severity: "warning",
      code: DiagnosticCodes.VERSION_MISMATCH,
      schemaPath: VERSION_SCHEMA_PATH,
      message: `document expects TOML Schema version ${expected}, but resolved schema uses ${actual}`,
    };
  }
  return undefined;
}

/**
 * Discovers and loads the schema referenced by a document's `[toml-schema]`
 * table (`location`, and optionally `version`), and returns both the loaded
 * schema and the parsed document. A version mismatch that shares the same
 * major version is recorded as a schema warning rather than rejected.
 */
export async function schemaFromDocument(documentPath: string): Promise<DiscoveryResult> {
  let source: string;
  try {
    source = await readFile(documentPath, "utf-8");
  } catch (cause) {
    throw new DocumentError(
      `unable to read document ${documentPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const document = parseToml(source);
  const metadata = document["toml-schema"];
  if (metadata === undefined) {
    throw new SchemaError("document does not contain [toml-schema].location", discoveryOptions(DiagnosticCodes.DISCOVERY_MISSING_LOCATION));
  }
  if (!isTomlTable(metadata)) {
    throw new SchemaError(
      "document [toml-schema] metadata must be a table",
      discoveryOptions(DiagnosticCodes.DISCOVERY_INVALID_METADATA, "$.toml-schema"),
    );
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!isSchemaReferenceScalar(value)) {
      throw new SchemaError(
        `document [toml-schema].${key} must be a scalar value`,
        discoveryOptions(DiagnosticCodes.DISCOVERY_INVALID_METADATA, `$.toml-schema.${key}`),
      );
    }
  }
  const location = metadata["location"];
  if (location === undefined || location === null || location === "") {
    throw new SchemaError("document does not contain [toml-schema].location", discoveryOptions(DiagnosticCodes.DISCOVERY_MISSING_LOCATION));
  }
  if (typeof location !== "string") {
    throw new SchemaError(
      "document [toml-schema].location must be a string",
      discoveryOptions(DiagnosticCodes.DISCOVERY_INVALID_METADATA),
    );
  }
  if (location.trim() === "") {
    throw new SchemaError("document does not contain [toml-schema].location", discoveryOptions(DiagnosticCodes.DISCOVERY_MISSING_LOCATION));
  }
  const schemaPath = resolveSchemaLocation(documentPath, location);
  let schemaSource: string;
  try {
    schemaSource = await readFile(schemaPath, "utf-8");
  } catch (cause) {
    throw new SchemaError(
      `unable to retrieve schema ${schemaPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      discoveryOptions(DiagnosticCodes.SCHEMA_RETRIEVAL_FAILED),
    );
  }
  const schema = loadSchemaFromSource(schemaPath, schemaSource);
  if ("version" in metadata) {
    const warning = compareDocumentSchemaVersion(metadata["version"], schema.version);
    if (warning !== undefined) schema.addWarning(warning);
  }
  return { schema, document };
}

/**
 * Convenience one-shot helper: discovers the schema referenced by a
 * document's `[toml-schema]` metadata and immediately validates the document
 * against it.
 */
export async function validateDocument(documentPath: string): Promise<ValidationResult> {
  try {
    const { schema, document } = await schemaFromDocument(documentPath);
    return schema.validate(document);
  } catch (cause) {
    if (!(cause instanceof SchemaError)) throw cause;
    const diagnostic: ValidationError = {
      phase: cause.phase,
      severity: "error",
      code: cause.code,
      path: "",
      schemaPath: cause.schemaPath,
      message: cause.message,
    };
    return new ValidationResult([diagnostic], []);
  }
}
