const BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Encodes a single key for a `$.a.b` validation-diagnostic path, quoting when necessary. */
export function encodePathKey(key: string): string {
  if (key !== "" && BARE_KEY_PATTERN.test(key)) return key;
  return JSON.stringify(key);
}

/** Appends `key` to a diagnostic path, e.g. `appendPath("$.a", "b")` -> `"$.a.b"`. */
export function appendPath(path: string, key: string): string {
  return `${path}.${encodePathKey(key)}`;
}

/** Whether a TOML key can be written unquoted (used by the schema extractor). */
export function isBareKey(key: string): boolean {
  return key !== "" && BARE_KEY_PATTERN.test(key);
}

/** Quotes and escapes a TOML key using basic-string syntax. */
export function quoteTomlKey(key: string): string {
  let escaped = "";
  for (const ch of key) {
    switch (ch) {
      case "\\":
        escaped += "\\\\";
        break;
      case '"':
        escaped += '\\"';
        break;
      case "\b":
        escaped += "\\b";
        break;
      case "\t":
        escaped += "\\t";
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\f":
        escaped += "\\f";
        break;
      case "\r":
        escaped += "\\r";
        break;
      default: {
        const code = ch.codePointAt(0) ?? 0;
        if (code < 0x20) {
          escaped += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
        } else {
          escaped += ch;
        }
      }
    }
  }
  return `"${escaped}"`;
}

/** Renders a TOML key, quoting only when required. */
export function encodeTomlKey(key: string): string {
  return isBareKey(key) ? key : quoteTomlKey(key);
}
