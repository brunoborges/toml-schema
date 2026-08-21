import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { TomlDate } from "smol-toml";
import { DocumentError, SchemaError } from "./errors.js";
import { DiagnosticCodes } from "./diagnostics.js";
import { loadSchema, Schema } from "./schema.js";
import { parseSemVer } from "./semver.js";
import { parseToml } from "./document.js";
import { isTomlTable, type TomlTable } from "./values.js";
import { ValidationResult } from "./validator.js";

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

function localPathFromFileURL(url: URL): string {
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    throw new SchemaError("file URI contains unsupported components");
  }
  if (url.hostname !== "" && url.hostname.toLowerCase() !== "localhost") {
    throw new SchemaError("file URI has a non-local host");
  }
  const escapedPath = url.pathname.toLowerCase();
  if (escapedPath.includes("%2f") || escapedPath.includes("%5c")) {
    throw new SchemaError("file URI contains an encoded path separator");
  }
  if (url.pathname === "" || url.pathname.includes("\0")) {
    throw new SchemaError("file URI does not contain a safe path");
  }
  let localPath: string;
  try {
    localPath = fileURLToPath(url);
  } catch (cause) {
    throw new SchemaError(
      `invalid file schema location: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!path.isAbsolute(localPath)) {
    throw new SchemaError("file URI path is not absolute");
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
    throw new SchemaError(`invalid [toml-schema].location URI: ${location}`);
  }
  const absoluteDocumentPath = path.resolve(documentPath);
  const base = pathToFileURL(absoluteDocumentPath);
  let resolved: URL;
  try {
    resolved = new URL(location, base);
  } catch (cause) {
    throw new SchemaError(
      `invalid [toml-schema].location URI: ${location}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (resolved.protocol.toLowerCase() !== "file:") {
    throw new SchemaError(`unsupported schema location URI scheme: ${resolved.protocol.replace(/:$/, "")}`);
  }
  const localPath = localPathFromFileURL(resolved);
  return path.normalize(localPath);
}

/** Compares a document's expected schema version against the resolved schema's actual version. */
export function compareDocumentSchemaVersion(expected: unknown, actual: string): string | undefined {
  const discovery = { phase: "discovery" as const, schemaPath: "$.toml-schema.version" };
  if (typeof expected !== "string") {
    throw new SchemaError("document [toml-schema].version must be a SemVer string", {
      ...discovery,
      code: DiagnosticCodes.UNSUPPORTED_VERSION,
    });
  }
  const expectedParts = parseSemVer(expected);
  if (!expectedParts) {
    throw new SchemaError("document [toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax", {
      ...discovery,
      code: DiagnosticCodes.UNSUPPORTED_VERSION,
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
    return `Warning: document expects TOML Schema version ${expected}, but resolved schema uses ${actual}`;
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
  if (!isTomlTable(metadata)) {
    throw new SchemaError("document does not contain [toml-schema].location");
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!isSchemaReferenceScalar(value)) {
      throw new SchemaError(`document [toml-schema].${key} must be a scalar value`);
    }
  }
  const location = metadata["location"];
  if (typeof location !== "string" || location.trim() === "") {
    throw new SchemaError("document does not contain [toml-schema].location");
  }
  const schemaPath = resolveSchemaLocation(documentPath, location);
  const schema = await loadSchema(schemaPath);
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
  const { schema, document } = await schemaFromDocument(documentPath);
  return schema.validate(document);
}
