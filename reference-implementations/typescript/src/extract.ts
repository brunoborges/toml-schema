import { writeFile, readFile } from "node:fs/promises";
import { TomlDate } from "smol-toml";
import { CURRENT_TOML_SCHEMA_VERSION, type SchemaType } from "./builtins.js";
import { parseToml } from "./document.js";
import { encodeTomlKey } from "./paths.js";
import { isTomlArray, isTomlTable, type TomlTable, type TomlValue } from "./values.js";

/** Infers the built-in TOML Schema type name that best describes a parsed TOML value. */
function schemaTypeOf(value: TomlValue): SchemaType {
  if (typeof value === "string") return "string";
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") return "float";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof TomlDate) {
    if (value.isDateTime()) return value.isLocal() ? "local-date-time" : "offset-date-time";
    if (value.isDate()) return "local-date";
    if (value.isTime()) return "local-time";
    return "any";
  }
  if (isTomlArray(value)) return "array";
  if (isTomlTable(value)) return "table";
  return "any";
}

/** Infers a homogeneous `itemtype` for an array, falling back to `"any"` when mixed or empty. */
function inferItemType(items: readonly TomlValue[]): SchemaType {
  if (items.length === 0) return "any";
  const first = schemaTypeOf(items[0] as TomlValue);
  for (const item of items.slice(1)) {
    if (schemaTypeOf(item) !== first) return "any";
  }
  return first;
}

function appendDefinition(lines: string[], path: readonly string[], value: TomlValue): void {
  lines.push("");
  lines.push(`[${path.map(encodeTomlKey).join(".")}]`);
  const typeName = schemaTypeOf(value);
  lines.push(`type = ${JSON.stringify(typeName)}`);
  if (typeName === "array" && isTomlArray(value)) {
    lines.push(`itemtype = ${JSON.stringify(inferItemType(value))}`);
  }
  if (isTomlTable(value)) {
    for (const childKey of Object.keys(value).sort()) {
      appendDefinition(lines, [...path, childKey], value[childKey] as TomlValue);
    }
  }
}

/**
 * Generates draft TOML Schema source text describing the structural shape of
 * a parsed TOML document. Every element is typed by inferring its TOML kind;
 * arrays additionally receive an inferred `itemtype` when homogeneous. The
 * root `[toml-schema]` table (if present in the document) is not itself
 * described, per the reserved-metadata convention.
 */
export function generateSchema(document: TomlTable): string {
  const lines: string[] = ["[toml-schema]", `version = ${JSON.stringify(CURRENT_TOML_SCHEMA_VERSION)}`, "", "[elements]"];
  for (const key of Object.keys(document).sort()) {
    if (key === "toml-schema") continue;
    appendDefinition(lines, ["elements", key], document[key] as TomlValue);
  }
  return lines.join("\n") + "\n";
}

/** Reads a TOML document, infers a draft schema for it, and writes the schema to `schemaPath`. */
export async function extractSchemaFile(documentPath: string, schemaPath: string): Promise<void> {
  const document = parseToml(await readFile(documentPath, "utf-8"));
  await writeFile(schemaPath, generateSchema(document), "utf-8");
}
