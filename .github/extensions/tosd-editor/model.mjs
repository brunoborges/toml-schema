// Converts between a parsed .tosd document and the editor model that the client
// SPA consumes, and serializes the editor model back to canonical TOSD text.
//
// Editor model shape:
//   {
//     version: "1.0.0",
//     meta:   { ...rawTomlTable } | null,   // [toml-schema.meta]
//     types:    [ node, ... ],
//     elements: [ node, ... ],
//   }
// node = { name, props: { <prop>: <editorValue> }, children: [ node, ... ] }
//
// Editor value encoding per property:
//   type/itemtype/pattern/keypattern : plain string
//   optional                               : boolean
//   minlength/maxlength                    : number
//   items/oneof/anyof                      : string[]  (type references)
//   allowedvalues                          : string[]  (TOML value tokens)
//   min/max                                : string    (TOML value token)

import {
    parseToml,
    formatValue,
    formatKeyPath,
    parseValue,
    isPlainTable,
} from "./toml.mjs";

export const PROP_ORDER = [
    "type",
    "itemtype",
    "items",
    "oneof",
    "anyof",
    "allowedvalues",
    "pattern",
    "keypattern",
    "min",
    "max",
    "minlength",
    "maxlength",
    "optional",
];

const STRING_PROPS = new Set(["type", "itemtype", "pattern", "keypattern"]);
const INT_PROPS = new Set(["minlength", "maxlength"]);
const BOOL_PROPS = new Set(["optional"]);
const REFLIST_PROPS = new Set(["items", "oneof", "anyof"]);
const VALUELIST_PROPS = new Set(["allowedvalues"]);
const VALUE_PROPS = new Set(["min", "max"]);

const ALL_PROPS = new Set(PROP_ORDER);

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
];

// ---------------------------------------------------------------------------
// Parse .tosd text -> editor model
// ---------------------------------------------------------------------------

export function parseDocument(text) {
    const root = parseToml(text || "");
    const meta = root["toml-schema"] || {};
    const version = typeof meta.version === "string" ? meta.version : "1.0.0";
    const metaTable = isPlainTable(meta.meta) ? meta.meta : null;

    return {
        version,
        meta: metaTable,
        types: tableToNodes(root["types"]),
        elements: tableToNodes(root["elements"]),
    };
}

function tableToNodes(table) {
    if (!isPlainTable(table)) return [];
    const nodes = [];
    for (const [name, value] of Object.entries(table)) {
        if (isPlainTable(value)) {
            nodes.push(tableToNode(name, value));
        }
        // Non-table top-level entries under [types]/[elements] are not valid
        // schema definitions; ignore them defensively.
    }
    return nodes;
}

function tableToNode(name, table) {
    const node = { name, props: {}, children: [] };
    for (const [key, value] of Object.entries(table)) {
        if (isPlainTable(value)) {
            node.children.push(tableToNode(key, value));
        } else if (ALL_PROPS.has(key)) {
            node.props[key] = decodeProp(key, value);
        } else if (key === "arraytype" || key === "default") {
            // Preserve removed syntax long enough for validation to report it.
            node.props[key] = String(value);
        } else {
            // A target document key that collides with nothing schema-specific
            // but holds a scalar - treat it as a child definition placeholder so
            // the information is not lost. Wrap as a node with a single prop.
            node.children.push({ name: key, props: scalarToProps(value), children: [] });
        }
    }
    return node;
}

function scalarToProps(value) {
    // Best-effort: represent a stray scalar child as an implicit string-ish node.
    return { type: typeofToken(value) };
}

function typeofToken(value) {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return Number.isInteger(value) ? "integer" : "float";
    if (value && value.__datetime) return value.__datetime;
    return "string";
}

function decodeProp(key, value) {
    if (STRING_PROPS.has(key)) return typeof value === "string" ? value : String(value);
    if (BOOL_PROPS.has(key)) return Boolean(value);
    if (INT_PROPS.has(key)) return Number(value);
    if (REFLIST_PROPS.has(key)) return Array.isArray(value) ? value.map(String) : [];
    if (VALUELIST_PROPS.has(key)) return Array.isArray(value) ? value.map(formatValue) : [];
    if (VALUE_PROPS.has(key)) return formatValue(value);
    return formatValue(value);
}

// ---------------------------------------------------------------------------
// Editor model -> canonical .tosd text
// ---------------------------------------------------------------------------

export function serializeDocument(model) {
    const lines = [];
    lines.push("# Metadata");
    lines.push("[toml-schema]");
    lines.push(`version = ${formatValue(model.version || "1.0.0")}`);

    if (model.meta && Object.keys(model.meta).length > 0) {
        lines.push("");
        emitRawTable(["toml-schema", "meta"], model.meta, lines);
    }

    lines.push("");
    lines.push("# Types");
    lines.push("[types]");
    for (const node of model.types || []) {
        lines.push("");
        emitNode(node, ["types"], 1, lines);
    }

    lines.push("");
    lines.push("# Elements");
    lines.push("[elements]");
    for (const node of model.elements || []) {
        lines.push("");
        emitNode(node, ["elements"], 1, lines);
    }

    return lines.join("\n") + "\n";
}

function emitNode(node, parentPath, depth, lines) {
    const path = [...parentPath, node.name];
    const indent = "    ".repeat(depth);
    lines.push(`${indent}[${formatKeyPath(path)}]`);

    for (const key of PROP_ORDER) {
        if (!(key in node.props)) continue;
        const raw = node.props[key];
        if (raw === undefined || raw === null || raw === "") continue;
        const typed = encodeProp(key, raw);
        if (typed === undefined) continue;
        lines.push(`${indent}${key} = ${formatValue(typed)}`);
    }

    for (const child of node.children || []) {
        lines.push("");
        emitNode(child, path, depth + 1, lines);
    }
}

function encodeProp(key, raw) {
    if (STRING_PROPS.has(key)) return String(raw);
    if (BOOL_PROPS.has(key)) return Boolean(raw);
    if (INT_PROPS.has(key)) return Math.trunc(Number(raw));
    if (REFLIST_PROPS.has(key)) {
        const arr = (Array.isArray(raw) ? raw : []).map(String).filter((s) => s !== "");
        return arr.length ? arr : undefined;
    }
    if (VALUELIST_PROPS.has(key)) {
        const arr = (Array.isArray(raw) ? raw : [])
            .map((tok) => safeParseToken(tok))
            .filter((v) => v !== undefined);
        return arr.length ? arr : undefined;
    }
    if (VALUE_PROPS.has(key)) return safeParseToken(raw);
    return safeParseToken(raw);
}

function safeParseToken(token) {
    if (token === undefined || token === null) return undefined;
    const s = String(token).trim();
    if (s === "") return undefined;
    try {
        return parseValue(s);
    } catch {
        // Fall back to treating it as a bare string value.
        return s;
    }
}

// Generic emitter for the free-form [toml-schema.meta] table.
function emitRawTable(pathParts, table, lines) {
    lines.push(`[${formatKeyPath(pathParts)}]`);
    const subTables = [];
    for (const [key, value] of Object.entries(table)) {
        if (isPlainTable(value)) {
            subTables.push([key, value]);
        } else {
            lines.push(`${formatKeyMeta(key)} = ${formatValue(value)}`);
        }
    }
    for (const [key, value] of subTables) {
        lines.push("");
        emitRawTable([...pathParts, key], value, lines);
    }
}

function formatKeyMeta(key) {
    return /^[A-Za-z0-9_-]+$/.test(key) ? key : `'${key}'`;
}

// ---------------------------------------------------------------------------
// Lightweight structural validation surfaced in the editor.
// ---------------------------------------------------------------------------

const NUMERIC_OR_TEMPORAL = new Set([
    "integer",
    "float",
    "offset-date-time",
    "local-date-time",
    "local-date",
    "local-time",
]);

export function validateModel(model) {
    const issues = [];
    const typeNames = new Set((model.types || []).map((t) => t.name));
    const typesByName = new Map((model.types || []).map((t) => [t.name, t]));

    const refExists = (ref) => {
        if (!ref) return true;
        const name = ref.startsWith("types.") ? ref.slice(6) : ref;
        if (BUILTIN_TYPES.includes(name)) return true;
        return typeNames.has(name);
    };

    const resolvedKinds = (ref, seen = new Set()) => {
        if (!ref) return new Set();
        const name = ref.startsWith("types.") ? ref.slice(6) : ref;
        if (BUILTIN_TYPES.includes(name)) return new Set([name]);
        if (seen.has(name)) return new Set();
        const definition = typesByName.get(name);
        if (!definition) return new Set();
        const nextSeen = new Set(seen).add(name);
        const props = definition.props || {};
        if (props.type) return resolvedKinds(props.type, nextSeen);
        const alternatives = props.oneof?.length ? props.oneof : props.anyof;
        const kinds = new Set();
        for (const alternative of alternatives || []) {
            for (const kind of resolvedKinds(alternative, nextSeen)) kinds.add(kind);
        }
        return kinds;
    };

    const walk = (node, pathLabel) => {
        const p = node.props || {};
        const label = pathLabel;

        if (p.arraytype != null) {
            issues.push({ level: "error", path: label, message: "`arraytype` is not supported; use `itemtype`." });
        }
        if (p.default != null) {
            issues.push({ level: "error", path: label, message: "`default` is not a TOML Schema property." });
        }

        const exclusivity = ["type", "oneof", "anyof"].filter((k) => p[k] != null && p[k] !== "" && !(Array.isArray(p[k]) && p[k].length === 0));
        if (exclusivity.length > 1) {
            issues.push({ level: "error", path: label, message: "`type`, `oneof`, and `anyof` are mutually exclusive." });
        }
        if (exclusivity.length === 0 && (!node.children || node.children.length === 0)) {
            issues.push({ level: "warning", path: label, message: "No type, oneof, anyof, or children - defaults to an open table." });
        }

        if (p.items && p.itemtype) {
            issues.push({ level: "error", path: label, message: "`items` is mutually exclusive with `itemtype`." });
        }
        if (p.itemtype && !["array", "collection"].includes(p.type)) {
            issues.push({ level: "error", path: label, message: "`itemtype` requires `type = \"array\"` or `type = \"collection\"`." });
        }
        if (p.type === "collection" && !p.itemtype) {
            issues.push({ level: "error", path: label, message: "A collection must define `itemtype`." });
        }
        if (p.items && (p.minlength != null || p.maxlength != null)) {
            issues.push({ level: "error", path: label, message: "`items` is mutually exclusive with `minlength`/`maxlength`." });
        }

        const hasMin = p.min != null && p.min !== "";
        const hasMax = p.max != null && p.max !== "";
        if (hasMin || hasMax) {
            const t = p.type;
            const itemKinds = t === "array" ? resolvedKinds(p.itemtype) : new Set();
            const comparableItems = itemKinds.size === 1 && NUMERIC_OR_TEMPORAL.has([...itemKinds][0]);
            const ok = NUMERIC_OR_TEMPORAL.has(t) || comparableItems;
            if (t === "any") {
                issues.push({ level: "error", path: label, message: "`min`/`max` cannot be applied to type `any`." });
            } else if (!ok) {
                issues.push({ level: "error", path: label, message: "`min`/`max` only apply to numeric/temporal types, or arrays of them." });
            }
        }

        if ((p.minlength != null || p.maxlength != null)) {
            const t = p.type;
            if (!["string", "array", "collection"].includes(t)) {
                issues.push({ level: "error", path: label, message: "`minlength`/`maxlength` require the built-in type string, array, or collection." });
            }
        }

        if (Object.prototype.hasOwnProperty.call(p, "pattern") && p.type !== "string") {
            issues.push({ level: "error", path: label, message: "`pattern` requires the built-in type `string`." });
        }

        if (Object.prototype.hasOwnProperty.call(p, "keypattern") && p.type !== "collection") {
            issues.push({ level: "error", path: label, message: "`keypattern` requires the built-in type `collection`." });
        }

        for (const ref of [p.type, p.itemtype]) {
            if (ref && !refExists(ref)) {
                issues.push({ level: "error", path: label, message: `Unknown type reference: "${ref}".` });
            }
        }
        for (const listKey of ["items", "oneof", "anyof"]) {
            for (const ref of p[listKey] || []) {
                if (ref && !refExists(ref)) {
                    issues.push({ level: "error", path: label, message: `Unknown type reference in ${listKey}: "${ref}".` });
                }
            }
        }

        for (const child of node.children || []) {
            walk(child, `${label}.${child.name}`);
        }
    };

    for (const t of model.types || []) walk(t, `types.${t.name}`);
    for (const e of model.elements || []) walk(e, `elements.${e.name}`);

    if (!/^\d+\.\d+\.\d+/.test(model.version || "")) {
        issues.push({ level: "error", path: "toml-schema.version", message: "version must be a full SemVer string (e.g. 1.0.0)." });
    }

    return issues;
}
