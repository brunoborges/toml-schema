// Self-contained TOML parser + serializer focused on the TOML Schema
// definition (.tosd) subset. .tosd documents are valid TOML 1.0 documents
// composed of table headers and scalar/array/inline-table values.
//
// Design notes:
//   * Table headers ([a.b.c]) produce nested plain objects. A plain object in
//     the resulting tree therefore always represents a sub-table — i.e. a child
//     schema definition.
//   * Inline tables ({ a = 1 }) are tagged as { __inline: true, value: {...} }
//     so they are never confused with sub-tables.
//   * Date/time values are tagged as { __datetime: kind, value: "..." } so the
//     serializer emits them bare instead of quoting them.
//
// This is intentionally pragmatic, not a 100% conformant TOML implementation,
// but it round-trips every construct used by TOML Schema documents.

export class TomlError extends Error {}

const DATETIME_RE =
    /^(\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(\.\d+)?)$/;

function classifyDatetime(raw) {
    // raw is the already-trimmed token text.
    if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) return "local-time";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "local-date";
    if (/[Zz]|[+-]\d{2}:\d{2}$/.test(raw) && /[Tt ]/.test(raw)) return "offset-date-time";
    if (/[Tt ]/.test(raw)) return "local-date-time";
    return null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseToml(text) {
    const root = {};
    let current = root;

    const lines = splitLogicalLines(text);
    for (const line of lines) {
        const trimmed = stripComment(line).trim();
        if (trimmed === "") continue;

        if (trimmed.startsWith("[")) {
            if (trimmed.startsWith("[[")) {
                const name = trimmed.slice(2, trimmed.lastIndexOf("]]")).trim();
                const path = parseKeyPath(name);
                current = enterArrayTable(root, path);
            } else {
                const name = trimmed.slice(1, trimmed.lastIndexOf("]")).trim();
                const path = parseKeyPath(name);
                current = enterTable(root, path);
            }
            continue;
        }

        const eq = findTopLevelEquals(trimmed);
        if (eq < 0) throw new TomlError(`Invalid line (no '='): ${line}`);
        const keyText = trimmed.slice(0, eq).trim();
        const valueText = trimmed.slice(eq + 1).trim();
        const keyPath = parseKeyPath(keyText);
        const value = parseValue(valueText);
        assignKey(current, keyPath, value);
    }

    return root;
}

// Joins physical lines so that multi-line arrays / inline structures / multi-line
// strings are treated as a single logical line for the simple line scanner above.
function splitLogicalLines(text) {
    const out = [];
    const raw = text.split(/\r?\n/);
    let buf = null;
    let depth = 0;
    let inMultiline = null; // '"""' or "'''"

    for (let i = 0; i < raw.length; i++) {
        let line = raw[i];

        if (inMultiline) {
            buf += "\n" + line;
            if (line.includes(inMultiline)) {
                inMultiline = null;
                if (depth === 0) {
                    out.push(buf);
                    buf = null;
                }
            }
            continue;
        }

        const open = openMultiline(line);
        if (open) {
            inMultiline = open;
            buf = (buf === null ? "" : buf + "\n") + line;
            continue;
        }

        if (buf !== null) {
            buf += "\n" + line;
            depth += bracketDelta(line);
            if (depth <= 0) {
                out.push(buf);
                buf = null;
                depth = 0;
            }
            continue;
        }

        const delta = bracketDelta(line);
        if (delta > 0 && !line.trim().startsWith("[")) {
            buf = line;
            depth = delta;
            continue;
        }
        out.push(line);
    }
    if (buf !== null) out.push(buf);
    return out;
}

// Detect an unterminated multi-line string opener on a line (outside comments).
function openMultiline(line) {
    const code = stripComment(line);
    for (const delim of ['"""', "'''"]) {
        const first = code.indexOf(delim);
        if (first >= 0) {
            const rest = code.slice(first + 3);
            if (!rest.includes(delim)) return delim;
        }
    }
    return null;
}

// Net change of [ and { brackets on a line, ignoring those inside strings/comments.
function bracketDelta(line) {
    const code = removeStrings(stripComment(line));
    let d = 0;
    for (const ch of code) {
        if (ch === "[" || ch === "{") d++;
        else if (ch === "]" || ch === "}") d--;
    }
    return d;
}

function removeStrings(s) {
    return s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'[^']*'/g, "''");
}

function stripComment(line) {
    let inBasic = false;
    let inLiteral = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inBasic) {
            if (ch === "\\") i++;
            else if (ch === '"') inBasic = false;
        } else if (inLiteral) {
            if (ch === "'") inLiteral = false;
        } else if (ch === '"') inBasic = true;
        else if (ch === "'") inLiteral = true;
        else if (ch === "#") return line.slice(0, i);
    }
    return line;
}

function findTopLevelEquals(s) {
    let inBasic = false;
    let inLiteral = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inBasic) {
            if (ch === "\\") i++;
            else if (ch === '"') inBasic = false;
        } else if (inLiteral) {
            if (ch === "'") inLiteral = false;
        } else if (ch === '"') inBasic = true;
        else if (ch === "'") inLiteral = true;
        else if (ch === "=") return i;
    }
    return -1;
}

export function parseKeyPath(text) {
    const parts = [];
    let i = 0;
    const s = text.trim();
    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] === '"' || s[i] === "'") {
            const quote = s[i];
            i++;
            let buf = "";
            while (i < s.length && s[i] !== quote) {
                if (quote === '"' && s[i] === "\\") {
                    buf += unescapeChar(s, i);
                    i += escapeLen(s, i);
                } else {
                    buf += s[i];
                    i++;
                }
            }
            i++; // closing quote
            parts.push(buf);
        } else {
            let buf = "";
            while (i < s.length && s[i] !== "." && !/\s/.test(s[i])) {
                buf += s[i];
                i++;
            }
            if (buf !== "") parts.push(buf);
        }
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] === ".") i++;
    }
    return parts;
}

function enterTable(root, path) {
    let node = root;
    for (const key of path) {
        if (node[key] === undefined) node[key] = {};
        node = node[key];
    }
    return node;
}

function enterArrayTable(root, path) {
    let node = root;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (node[key] === undefined) node[key] = {};
        node = node[key];
    }
    const last = path[path.length - 1];
    if (!Array.isArray(node[last])) node[last] = [];
    const entry = {};
    node[last].push(entry);
    return entry;
}

function assignKey(table, path, value) {
    let node = table;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (node[key] === undefined) node[key] = {};
        node = node[key];
    }
    node[path[path.length - 1]] = value;
}

export function parseValue(text) {
    const s = text.trim();
    if (s === "") throw new TomlError("Empty value");

    if (s.startsWith('"""') || s.startsWith("'''")) return parseMultilineString(s);
    if (s[0] === '"') return parseBasicString(s);
    if (s[0] === "'") return parseLiteralString(s);
    if (s[0] === "[") return parseArray(s);
    if (s[0] === "{") return parseInlineTable(s);

    if (s === "true") return true;
    if (s === "false") return false;

    if (DATETIME_RE.test(s)) {
        const kind = classifyDatetime(s);
        if (kind) return { __datetime: kind, value: s };
    }

    const num = parseNumber(s);
    if (num !== undefined) return num;

    throw new TomlError(`Cannot parse value: ${text}`);
}

function parseNumber(s) {
    if (/^[+-]?(inf|nan)$/.test(s)) {
        if (s.endsWith("nan")) return NaN;
        return s[0] === "-" ? -Infinity : Infinity;
    }
    const cleaned = s.replace(/_/g, "");
    if (/^[+-]?0x[0-9a-fA-F]+$/.test(cleaned)) return parseInt(cleaned, 16);
    if (/^[+-]?0o[0-7]+$/.test(cleaned)) return parseInt(cleaned.replace(/0o/, ""), 8);
    if (/^[+-]?0b[01]+$/.test(cleaned)) return parseInt(cleaned.replace(/0b/, ""), 2);
    if (/^[+-]?\d+$/.test(cleaned)) return parseInt(cleaned, 10);
    if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?)$/.test(cleaned)) return parseFloat(cleaned);
    return undefined;
}

function parseBasicString(s) {
    const { value } = readBasicString(s, 0);
    return value;
}

function readBasicString(s, start) {
    let i = start + 1;
    let buf = "";
    while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") {
            buf += unescapeChar(s, i);
            i += escapeLen(s, i);
        } else {
            buf += s[i];
            i++;
        }
    }
    return { value: buf, end: i + 1 };
}

function parseLiteralString(s) {
    const { value } = readLiteralString(s, 0);
    return value;
}

function readLiteralString(s, start) {
    let i = start + 1;
    let buf = "";
    while (i < s.length && s[i] !== "'") {
        buf += s[i];
        i++;
    }
    return { value: buf, end: i + 1 };
}

function parseMultilineString(s) {
    const delim = s.slice(0, 3);
    const closeIdx = s.indexOf(delim, 3);
    let inner = s.slice(3, closeIdx);
    if (inner.startsWith("\n")) inner = inner.slice(1);
    else if (inner.startsWith("\r\n")) inner = inner.slice(2);
    if (delim === "'''") return inner;
    // Basic multiline: process escapes and line-ending backslash trimming.
    inner = inner.replace(/\\\s*\n\s*/g, "");
    let buf = "";
    for (let i = 0; i < inner.length; i++) {
        if (inner[i] === "\\") {
            buf += unescapeChar(inner, i);
            i += escapeLen(inner, i) - 1;
        } else buf += inner[i];
    }
    return buf;
}

function escapeLen(s, i) {
    const c = s[i + 1];
    if (c === "u") return 6;
    if (c === "U") return 10;
    return 2;
}

function unescapeChar(s, i) {
    const c = s[i + 1];
    switch (c) {
        case "n": return "\n";
        case "t": return "\t";
        case "r": return "\r";
        case '"': return '"';
        case "\\": return "\\";
        case "b": return "\b";
        case "f": return "\f";
        case "/": return "/";
        case "u": return String.fromCodePoint(parseInt(s.slice(i + 2, i + 6), 16));
        case "U": return String.fromCodePoint(parseInt(s.slice(i + 2, i + 10), 16));
        default: return c;
    }
}

function parseArray(s) {
    const inner = s.slice(1, s.lastIndexOf("]"));
    const tokens = splitTopLevel(inner);
    return tokens.filter((t) => t.trim() !== "").map((t) => parseValue(t.trim()));
}

function parseInlineTable(s) {
    const inner = s.slice(1, s.lastIndexOf("}"));
    const tokens = splitTopLevel(inner);
    const obj = {};
    for (const tok of tokens) {
        const t = tok.trim();
        if (t === "") continue;
        const eq = findTopLevelEquals(t);
        const key = parseKeyPath(t.slice(0, eq).trim());
        const val = parseValue(t.slice(eq + 1).trim());
        assignKey(obj, key, val);
    }
    return { __inline: true, value: obj };
}

// Split a comma-separated list, respecting nested brackets/braces and strings.
function splitTopLevel(text) {
    const out = [];
    let depth = 0;
    let buf = "";
    let inBasic = false;
    let inLiteral = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inBasic) {
            buf += ch;
            if (ch === "\\") {
                buf += text[i + 1] ?? "";
                i++;
            } else if (ch === '"') inBasic = false;
            continue;
        }
        if (inLiteral) {
            buf += ch;
            if (ch === "'") inLiteral = false;
            continue;
        }
        if (ch === '"') { inBasic = true; buf += ch; continue; }
        if (ch === "'") { inLiteral = true; buf += ch; continue; }
        if (ch === "[" || ch === "{") { depth++; buf += ch; continue; }
        if (ch === "]" || ch === "}") { depth--; buf += ch; continue; }
        if (ch === "," && depth === 0) { out.push(buf); buf = ""; continue; }
        if (ch === "#" && depth === 0) break; // trailing comment in multiline arrays
        buf += ch;
    }
    if (buf.trim() !== "") out.push(buf);
    return out;
}

// ---------------------------------------------------------------------------
// Serializer (value-level)
// ---------------------------------------------------------------------------

const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;

export function formatKeyPath(parts) {
    return parts.map(formatKey).join(".");
}

export function formatKey(key) {
    if (BARE_KEY_RE.test(key) && key !== "") return key;
    // Prefer literal quoting unless the key contains a single quote.
    if (!key.includes("'")) return `'${key}'`;
    return `"${escapeBasic(key)}"`;
}

export function formatValue(value) {
    if (value === null || value === undefined) return '""';
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return formatNumber(value);
    if (typeof value === "string") return formatString(value);
    if (Array.isArray(value)) return "[ " + value.map(formatValue).join(", ") + " ]";
    if (value.__datetime) return value.value;
    if (value.__inline) return formatInline(value.value);
    if (typeof value === "object") return formatInline(value);
    return '""';
}

function formatInline(obj) {
    const parts = Object.entries(obj).map(([k, v]) => `${formatKey(k)} = ${formatValue(v)}`);
    return "{ " + parts.join(", ") + " }";
}

function formatNumber(n) {
    if (Number.isNaN(n)) return "nan";
    if (n === Infinity) return "inf";
    if (n === -Infinity) return "-inf";
    return String(n);
}

function formatString(s) {
    // Use a literal string when it avoids backslash noise (e.g. regex patterns)
    // and the content has no single quotes or newlines.
    if (!s.includes("'") && !s.includes("\n") && !s.includes("\r")) {
        return `'${s}'`;
    }
    return `"${escapeBasic(s)}"`;
}

function escapeBasic(s) {
    return s.replace(/[\\"\n\r\t]/g, (ch) => {
        switch (ch) {
            case "\\": return "\\\\";
            case '"': return '\\"';
            case "\n": return "\\n";
            case "\r": return "\\r";
            case "\t": return "\\t";
            default: return ch;
        }
    });
}

// Helpers exposed for the model layer.
export function isPlainTable(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !value.__datetime &&
        !value.__inline
    );
}
