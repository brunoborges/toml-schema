import type { TomlTable, TomlValue } from "./values.js";
import { isTomlTable } from "./values.js";

/**
 * Recovers which table-valued schema keys were written using inline-table
 * syntax (`key = { ... }`) versus a table header (`[a.b.key]`).
 *
 * TOML Schema disambiguates an annotation property from a child definition by
 * syntax rather than by member name: `default = { ... }`, `dependentrequired
 * = { ... }`, and `if = { ... }` are always annotations, while a table header
 * such as `[elements.options.default]` is always a child definition named
 * `default`. A parsed TOML value alone cannot recover this distinction (see
 * SPEC.md, "Validation and Data Model"), so this scanner walks the raw schema
 * source text to record every key path that was assigned via inline-table
 * syntax.
 *
 * This is a narrow, source-shape-only scanner: it assumes `content` is
 * already known to be valid TOML (the caller parses it with a real TOML
 * parser first) and only needs to recover table-header/inline-table syntax
 * choices, not TOML values themselves.
 */
export class SchemaSource {
  private readonly inlineTablePaths: ReadonlySet<string>;

  constructor(content: string) {
    let inlineTablePaths: ReadonlySet<string>;
    try {
      inlineTablePaths = scanInlineTablePaths(content);
    } catch {
      // Fail open: an implementation MUST NOT guess from inline-table member
      // names, but a scan failure on already-parsed-valid TOML should not
      // itself abort schema loading. Structural checks elsewhere still catch
      // genuine schema errors.
      inlineTablePaths = new Set();
    }
    this.inlineTablePaths = inlineTablePaths;
  }

  /**
   * Reports whether `key` on the definition table at `path` carries an
   * annotation value (a property) rather than a nested child definition. A
   * non-table value is always a property; a table value is a property only
   * when the source wrote it as an inline table.
   */
  isProperty(table: TomlTable, path: readonly string[], key: string): boolean {
    if (!(key in table)) return false;
    const value = table[key];
    if (!isTomlTable(value as TomlValue)) return true;
    return this.inlineTablePaths.has(pathKey([...path, key]));
  }
}

function pathKey(path: readonly string[]): string {
  return path.join("\u0000");
}

function scanInlineTablePaths(text: string): Set<string> {
  const inlineTablePaths = new Set<string>();
  const length = text.length;
  let i = 0;
  let prefix: string[] = [];
  while (i < length) {
    i = skipInsignificant(text, i);
    if (i >= length) break;
    if (text[i] === "[") {
      const isArrayTable = text[i + 1] === "[";
      let j = isArrayTable ? i + 2 : i + 1;
      const key = parseKeyPath(text, j);
      j = skipInlineWs(text, key.next);
      if (isArrayTable) {
        if (text[j] !== "]" || text[j + 1] !== "]") {
          throw new Error("malformed array table header");
        }
        j += 2;
      } else {
        if (text[j] !== "]") {
          throw new Error("malformed table header");
        }
        j += 1;
      }
      prefix = key.segments;
      i = j;
      continue;
    }
    const key = parseKeyPath(text, i);
    let j = skipInlineWs(text, key.next);
    if (text[j] !== "=") {
      throw new Error("expected '=' in key/value pair");
    }
    j = skipInlineWs(text, j + 1);
    const fullPath = [...prefix, ...key.segments];
    i = consumeValue(text, j, fullPath, inlineTablePaths);
  }
  return inlineTablePaths;
}

function consumeValue(
  text: string,
  i: number,
  path: readonly string[],
  inlineTablePaths: Set<string>,
): number {
  const ch = text[i];
  if (ch === "{") {
    const close = skipGroup(text, i);
    inlineTablePaths.add(pathKey(path));
    parseInlineTableBody(text, i + 1, close - 1, path, inlineTablePaths);
    return close;
  }
  if (ch === "[") {
    return skipGroup(text, i);
  }
  if (ch === '"' || ch === "'") {
    return skipString(text, i);
  }
  // Bare scalar values (integers, floats, booleans, and bare dates/times)
  // never contain '\n', '\r', '#', ',', '}', or ']'. Stopping at all of
  // these (not just newline/comment) lets this branch double as both the
  // top-level/table-header scanner and the inline-table-body scanner: a
  // bare value nested inside an inline table must stop at its enclosing
  // ',' separator or '}'/']' close, not run on to the end of the line.
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === "\n" || c === "\r" || c === "#" || c === "," || c === "}" || c === "]") {
      break;
    }
    j++;
  }
  return j;
}

function parseInlineTableBody(
  text: string,
  start: number,
  end: number,
  basePath: readonly string[],
  inlineTablePaths: Set<string>,
): void {
  let i = start;
  while (true) {
    i = skipInlineWsCommasAndNewlines(text, i, end);
    if (i >= end) break;
    const key = parseKeyPath(text, i);
    let j = skipInlineWs(text, key.next);
    if (text[j] !== "=") {
      throw new Error("expected '=' in inline table");
    }
    j = skipInlineWs(text, j + 1);
    const fullPath = [...basePath, ...key.segments];
    i = consumeValue(text, j, fullPath, inlineTablePaths);
  }
}

function skipInsignificant(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    break;
  }
  return i;
}

function skipInlineWs(text: string, start: number): number {
  let i = start;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return i;
}

function skipInlineWsCommasAndNewlines(text: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",") {
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < end && text[i] !== "\n") i++;
      continue;
    }
    break;
  }
  return i;
}

const BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+/;

function parseKeyPath(text: string, start: number): { segments: string[]; next: number } {
  const segments: string[] = [];
  let i = skipInlineWs(text, start);
  for (;;) {
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      const end = skipString(text, i);
      const raw = text.slice(i + 1, end - 1);
      segments.push(quote === '"' ? unescapeBasicString(raw) : raw);
      i = end;
    } else {
      const match = BARE_KEY_PATTERN.exec(text.slice(i));
      if (!match) {
        throw new Error(`invalid key at offset ${i}`);
      }
      segments.push(match[0]);
      i += match[0].length;
    }
    i = skipInlineWs(text, i);
    if (text[i] === ".") {
      i = skipInlineWs(text, i + 1);
      continue;
    }
    break;
  }
  return { segments, next: i };
}

/** Skips a (possibly triple-quoted) string starting at `text[start]`, returning the index after it. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  const triple = text[start + 1] === quote && text[start + 2] === quote;
  const literal = quote === "'";
  let i = start + (triple ? 3 : 1);
  while (i < text.length) {
    if (!literal && text[i] === "\\") {
      i += 2;
      continue;
    }
    if (triple) {
      if (text[i] === quote && text[i + 1] === quote && text[i + 2] === quote) {
        return i + 3;
      }
    } else {
      if (text[i] === quote) return i + 1;
      if (!literal && text[i] === "\n") {
        throw new Error("unterminated single-line string");
      }
    }
    i++;
  }
  throw new Error("unterminated string");
}

/** Skips a balanced `{...}` or `[...]` group, returning the index after the matching close. */
function skipGroup(text: string, start: number): number {
  const closers: string[] = [text[start] === "{" ? "}" : "]"];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "{" || ch === "[") {
      closers.push(ch === "{" ? "}" : "]");
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      closers.pop();
      i++;
      if (closers.length === 0) return i;
      continue;
    }
    i++;
  }
  throw new Error("unterminated group");
}

function unescapeBasicString(raw: string): string {
  let result = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      result += ch;
      continue;
    }
    const next = raw[++i];
    switch (next) {
      case "b":
        result += "\b";
        break;
      case "t":
        result += "\t";
        break;
      case "n":
        result += "\n";
        break;
      case "f":
        result += "\f";
        break;
      case "r":
        result += "\r";
        break;
      case '"':
        result += '"';
        break;
      case "\\":
        result += "\\";
        break;
      case "u": {
        const code = raw.slice(i + 1, i + 5);
        result += String.fromCodePoint(Number.parseInt(code, 16));
        i += 4;
        break;
      }
      case "U": {
        const code = raw.slice(i + 1, i + 9);
        result += String.fromCodePoint(Number.parseInt(code, 16));
        i += 8;
        break;
      }
      default:
        result += next ?? "";
    }
  }
  return result;
}
