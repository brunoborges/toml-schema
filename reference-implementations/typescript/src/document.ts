import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import type { TomlTable } from "./values.js";

/** Parses TOML source text, preserving integer/float distinction via BigInt integers. */
export function parseToml(source: string): TomlTable {
  return parse(source, { integersAsBigInt: true }) as TomlTable;
}

/**
 * Loads and parses a TOML document from disk, returning its root table.
 * Integers are represented as `bigint` and floats as `number` (see
 * {@link parseToml}); pass the result directly to {@link Schema.validate}.
 */
export async function loadDocument(path: string): Promise<TomlTable> {
  const source = await readFile(path, "utf-8");
  return parseToml(source);
}
