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
//   type/itemtype/description/pattern/keypattern : plain string
//   optional/uniqueitems/deprecated              : boolean
//   minlength/maxlength                          : number
//   items/oneof/anyof/allof                      : string[]
//   allowedvalues                                : string[]  (TOML value tokens)
//   dependentrequired                            : { trigger: string[] }
//   mutuallyexclusive/exactlyone                 : string[][]
//   min/max/default                              : string    (TOML value token)

import {
    parseToml,
    formatValue,
    formatKeyPath,
    parseValue,
    isPlainTable,
} from "./toml.mjs";

export const PROP_ORDER = [
    "type",
    "description",
    "itemtype",
    "items",
    "oneof",
    "anyof",
    "allof",
    "allowedvalues",
    "pattern",
    "keypattern",
    "min",
    "max",
    "minlength",
    "maxlength",
    "uniqueitems",
    "dependentrequired",
    "mutuallyexclusive",
    "exactlyone",
    "default",
    "deprecated",
    "optional",
];

const STRING_PROPS = new Set(["type", "description", "itemtype", "pattern", "keypattern"]);
const INT_PROPS = new Set(["minlength", "maxlength"]);
const BOOL_PROPS = new Set(["optional", "uniqueitems", "deprecated"]);
const REFLIST_PROPS = new Set(["items", "oneof", "anyof", "allof"]);
const GROUPLIST_PROPS = new Set(["mutuallyexclusive", "exactlyone"]);
const MAPLIST_PROPS = new Set(["dependentrequired"]);
const VALUELIST_PROPS = new Set(["allowedvalues"]);
const VALUE_PROPS = new Set(["min", "max", "default"]);

const ALL_PROPS = new Set(PROP_ORDER);
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

const NUMERIC_OR_TEMPORAL = new Set([
    "integer",
    "float",
    "offset-date-time",
    "local-date-time",
    "local-date",
    "local-time",
]);

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
        } else if (key === "arraytype") {
            node.props[key] = String(value);
        } else {
            node.children.push({ name: key, props: scalarToProps(value), children: [] });
        }
    }
    return node;
}

function scalarToProps(value) {
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
    if (BOOL_PROPS.has(key)) return value;
    if (INT_PROPS.has(key)) return value;
    if (REFLIST_PROPS.has(key)) return Array.isArray(value) ? value.map(String) : [];
    if (GROUPLIST_PROPS.has(key)) return decodeGroupList(value);
    if (MAPLIST_PROPS.has(key)) return decodeDependentRequired(value);
    if (VALUELIST_PROPS.has(key)) return Array.isArray(value) ? value.map(formatValue) : [];
    if (VALUE_PROPS.has(key)) return formatValue(value);
    return formatValue(value);
}

function decodeGroupList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((group) => Array.isArray(group) ? group.map(String) : [String(group)]);
}

function decodeDependentRequired(value) {
    const inner = value && value.__inline ? value.value : value;
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) return {};
    const out = {};
    for (const [key, raw] of Object.entries(inner)) {
        out[key] = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    }
    return out;
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
    if (BOOL_PROPS.has(key)) return encodeBoolean(raw);
    if (INT_PROPS.has(key)) return encodeInteger(raw);
    if (REFLIST_PROPS.has(key)) {
        const arr = (Array.isArray(raw) ? raw : []).map(String).filter((s) => s.trim() !== "");
        return arr.length ? arr : undefined;
    }
    if (GROUPLIST_PROPS.has(key)) {
        const groups = normalizeGroups(raw);
        return groups.length ? groups : undefined;
    }
    if (MAPLIST_PROPS.has(key)) {
        const mapping = normalizeDependentRequired(raw);
        return Object.keys(mapping).length ? mapping : undefined;
    }
    if (VALUELIST_PROPS.has(key)) {
        const arr = (Array.isArray(raw) ? raw : [])
            .map((tok) => parseTokenForEmit(tok))
            .filter((v) => v !== undefined);
        return arr.length ? arr : undefined;
    }
    if (VALUE_PROPS.has(key)) return parseTokenForEmit(raw);
    return parseTokenForEmit(raw);
}

function encodeBoolean(raw) {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw === "boolean") return raw;
    return parseTokenForEmit(raw);
}

function encodeInteger(raw) {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
    const parsed = parseTokenForEmit(raw);
    return typeof parsed === "number" ? Math.trunc(parsed) : parsed;
}

function normalizeGroups(raw) {
    const groups = [];
    for (const group of Array.isArray(raw) ? raw : []) {
        if (!Array.isArray(group)) continue;
        const clean = group.map((name) => String(name).trim()).filter((name) => name !== "");
        if (clean.length) groups.push(clean);
    }
    return groups;
}

function normalizeDependentRequired(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [trigger, values] of Object.entries(raw)) {
        const key = String(trigger).trim();
        if (!key) continue;
        const clean = (Array.isArray(values) ? values : [values])
            .map((name) => String(name).trim())
            .filter((name) => name !== "");
        if (clean.length) out[key] = clean;
    }
    return out;
}

function parseTokenForEmit(token) {
    if (token === undefined || token === null) return undefined;
    if (typeof token === "boolean" || typeof token === "number") return token;
    if (Array.isArray(token) || (token && typeof token === "object" && (token.__datetime || token.__inline || token.__rawToml))) {
        return token;
    }
    const s = String(token).trim();
    if (s === "") return undefined;
    try {
        return parseValue(s);
    } catch {
        return { __rawToml: true, value: s };
    }
}

function parseTokenForValidation(token) {
    if (token === undefined || token === null) return { ok: false, message: "must not be empty" };
    if (typeof token === "boolean" || typeof token === "number") return { ok: true, value: token };
    const s = String(token).trim();
    if (!s) return { ok: false, message: "must not be empty" };
    try {
        return { ok: true, value: parseValue(s) };
    } catch (error) {
        return { ok: false, message: error.message };
    }
}

function isBooleanValue(value) {
    return typeof value === "boolean";
}

function isIntegerValue(value) {
    return typeof value === "number" && Number.isInteger(value);
}

function isNonArrayObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
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

export function validateModel(model) {
    const issues = [];
    const typeNames = new Set((model.types || []).map((t) => t.name));
    const typesByName = new Map((model.types || []).map((t) => [t.name, t]));
    const parsedVersion = parseSemver(model.version);
    for (const name of typeNames) {
        if (BUILTIN_TYPES.includes(name)) {
            issues.push({ level: "error", path: `types.${name}`, message: `\`${name}\` is a reserved built-in type name.` });
        }
    }

    const normalizeRef = (ref) => ref?.startsWith("types.") ? ref.slice(6) : ref;
    const isNamedRef = (ref) => {
        const name = normalizeRef(ref);
        return !!name && !BUILTIN_TYPES.includes(name);
    };
    const refExists = (ref) => {
        if (!ref) return true;
        const name = normalizeRef(ref);
        if (BUILTIN_TYPES.includes(name)) return true;
        return typeNames.has(name);
    };

    const selectorKinds = (node, seen = new Set()) => {
        const props = node.props || {};
        if (props.type) return resolvedKinds(props.type, seen);
        const alternatives = props.oneof?.length ? props.oneof : props.anyof;
        if (alternatives?.length) {
            const kinds = new Set();
            for (const alternative of alternatives) {
                for (const kind of resolvedKinds(alternative, seen)) kinds.add(kind);
            }
            return kinds;
        }
        if (node.children?.length) return new Set(["table"]);
        return new Set();
    };

    const resolvedKinds = (ref, seen = new Set()) => {
        if (!ref) return new Set();
        const name = normalizeRef(ref);
        if (!name) return new Set();
        if (BUILTIN_TYPES.includes(name)) return new Set([name]);
        if (seen.has(name)) return new Set();
        const definition = typesByName.get(name);
        if (!definition) return new Set();
        return selectorKinds(definition, new Set(seen).add(name));
    };

    const fixedChildrenForNode = (node, seen = new Set()) => {
        const fixed = new Set((node.children || []).map((child) => child.name));
        const props = node.props || {};
        if (props.type && isNamedRef(props.type)) {
            const name = normalizeRef(props.type);
            if (!seen.has(name) && typesByName.has(name)) {
                for (const childName of fixedChildrenForNode(typesByName.get(name), new Set(seen).add(name))) {
                    fixed.add(childName);
                }
            }
        }
        for (const ref of props.allof || []) {
            const name = normalizeRef(ref);
            if (!name || BUILTIN_TYPES.includes(name) || seen.has(name) || !typesByName.has(name)) continue;
            for (const childName of fixedChildrenForNode(typesByName.get(name), new Set(seen).add(name))) {
                fixed.add(childName);
            }
        }
        return fixed;
    };

    const hasCollectionItemConstraint = (node, seen = new Set()) => {
        const props = node.props || {};
        if (props.itemtype) return true;
        const references = [];
        if (props.type && isNamedRef(props.type)) references.push(props.type);
        references.push(...(props.oneof || []), ...(props.anyof || []), ...(props.allof || []));
        for (const ref of references) {
            const name = normalizeRef(ref);
            if (!name || BUILTIN_TYPES.includes(name) || seen.has(name) || !typesByName.has(name)) continue;
            if (hasCollectionItemConstraint(typesByName.get(name), new Set(seen).add(name))) return true;
        }
        return false;
    };

    const pushTokenIssue = (path, key, token) => {
        const parsed = parseTokenForValidation(token);
        if (!parsed.ok) {
            issues.push({ level: "error", path, message: `\`${key}\` must be a valid TOML value token (${parsed.message}).` });
        }
        return parsed;
    };

    const validateRef = (label, key, ref, { disallowAny = false, disallowCollection = false } = {}) => {
        if (!String(ref || "").trim()) {
            issues.push({ level: "error", path: label, message: `\`${key}\` references must not be blank.` });
            return;
        }
        if (!refExists(ref)) {
            issues.push({ level: "error", path: label, message: `Unknown type reference in ${key}: "${ref}".` });
            return;
        }
        const direct = normalizeRef(ref);
        if (disallowAny && direct === "any") {
            issues.push({ level: "error", path: label, message: `\`${key}\` must not reference the bare built-in type \`any\`.` });
        }
        if (disallowCollection && direct === "collection") {
            issues.push({ level: "error", path: label, message: `\`${key}\` must not reference the bare built-in type \`collection\`.` });
        }
    };

    const validatePresenceMapping = (label, key, mapping, fixedChildren, effectiveKinds) => {
        const kind = effectiveKinds.size === 1 ? [...effectiveKinds][0] : null;
        if (!kind || !["table", "collection"].includes(kind)) {
            issues.push({ level: "error", path: label, message: `\`${key}\` requires an effective type of \`table\` or \`collection\`.` });
            return;
        }
        if (!isNonArrayObject(mapping)) {
            issues.push({ level: "error", path: label, message: `\`${key}\` must be an inline table mapping child names to string arrays.` });
            return;
        }
        const entries = Object.entries(mapping);
        if (entries.length === 0) {
            issues.push({ level: "error", path: label, message: `\`${key}\` must not be empty.` });
            return;
        }
        for (const [trigger, rawValues] of entries) {
            if (!fixedChildren.has(trigger)) {
                issues.push({ level: "error", path: label, message: `\`${key}\` references unknown fixed child \`${trigger}\`.` });
            }
            if (!Array.isArray(rawValues) || rawValues.length === 0) {
                issues.push({ level: "error", path: label, message: `\`${key}.${trigger}\` must be a non-empty array of fixed-child names.` });
                continue;
            }
            const seen = new Set();
            for (const rawName of rawValues) {
                const name = String(rawName);
                if (!name.trim()) {
                    issues.push({ level: "error", path: label, message: `\`${key}.${trigger}\` must not contain blank child names.` });
                    continue;
                }
                if (seen.has(name)) {
                    issues.push({ level: "error", path: label, message: `\`${key}.${trigger}\` must not contain duplicate child names.` });
                }
                seen.add(name);
                if (!fixedChildren.has(name)) {
                    issues.push({ level: "error", path: label, message: `\`${key}.${trigger}\` references unknown fixed child \`${name}\`.` });
                }
            }
        }
    };

    const validatePresenceGroups = (label, key, groups, fixedChildren, effectiveKinds) => {
        const kind = effectiveKinds.size === 1 ? [...effectiveKinds][0] : null;
        if (!kind || !["table", "collection"].includes(kind)) {
            issues.push({ level: "error", path: label, message: `\`${key}\` requires an effective type of \`table\` or \`collection\`.` });
            return;
        }
        if (!Array.isArray(groups) || groups.length === 0) {
            issues.push({ level: "error", path: label, message: `\`${key}\` must be a non-empty array of string arrays.` });
            return;
        }
        groups.forEach((group, index) => {
            if (!Array.isArray(group) || group.length < 2) {
                issues.push({ level: "error", path: label, message: `\`${key}[${index}]\` must contain at least two child names.` });
                return;
            }
            const seen = new Set();
            for (const rawName of group) {
                const name = String(rawName);
                if (!name.trim()) {
                    issues.push({ level: "error", path: label, message: `\`${key}[${index}]\` must not contain blank child names.` });
                    continue;
                }
                if (seen.has(name)) {
                    issues.push({ level: "error", path: label, message: `\`${key}[${index}]\` must not contain duplicate child names.` });
                }
                seen.add(name);
                if (!fixedChildren.has(name)) {
                    issues.push({ level: "error", path: label, message: `\`${key}[${index}]\` references unknown fixed child \`${name}\`.` });
                }
            }
        });
    };

    const walk = (node, pathLabel) => {
        const p = node.props || {};
        const label = pathLabel;
        const selectorKindsForNode = selectorKinds(node);
        const fixedChildren = fixedChildrenForNode(node);

        if (p.arraytype != null) {
            issues.push({ level: "error", path: label, message: "`arraytype` is not supported; use `itemtype`." });
        }

        const exclusivity = ["type", "oneof", "anyof"].filter((key) => Object.prototype.hasOwnProperty.call(p, key));
        for (const key of ["type", "itemtype"]) {
            if (Object.prototype.hasOwnProperty.call(p, key) && !String(p[key]).trim()) {
                issues.push({ level: "error", path: label, message: `\`${key}\` must not be blank.` });
            }
        }
        if (exclusivity.length > 1) {
            issues.push({ level: "error", path: label, message: "`type`, `oneof`, and `anyof` are mutually exclusive." });
        }
        if (exclusivity.length === 0 && (!node.children || node.children.length === 0)) {
            issues.push({ level: "error", path: label, message: "A definition must select a type or contain child definitions." });
        }

        for (const unionKey of ["oneof", "anyof", "allof"]) {
            if (Object.prototype.hasOwnProperty.call(p, unionKey) && (!Array.isArray(p[unionKey]) || p[unionKey].length === 0)) {
                issues.push({ level: "error", path: label, message: `\`${unionKey}\` must contain at least one type reference.` });
            }
        }

        const isUnionSelector = Object.prototype.hasOwnProperty.call(p, "oneof") || Object.prototype.hasOwnProperty.call(p, "anyof");
        if (isUnionSelector) {
            const allowed = new Set(["oneof", "anyof", "allof", "description", "optional", "default", "deprecated"]);
            for (const key of Object.keys(p)) {
                if (!allowed.has(key)) {
                    issues.push({ level: "error", path: label, message: `A union cannot define \`${key}\`.` });
                }
            }
        }

        const isNamedTypeRef = p.type && isNamedRef(p.type);
        if (isNamedTypeRef) {
            const allowed = new Set(["type", "allof", "description", "optional", "default", "deprecated"]);
            for (const key of Object.keys(p)) {
                if (!allowed.has(key)) {
                    issues.push({ level: "error", path: label, message: `A named type reference cannot define \`${key}\`.` });
                }
            }
        }

        if ((node.children || []).length > 0 && !["table", "collection"].includes(p.type) && exclusivity.length > 0) {
            issues.push({ level: "error", path: label, message: "Child definitions require the built-in type `table` or `collection`." });
        }

        if (p.items && p.itemtype) {
            issues.push({ level: "error", path: label, message: "`items` is mutually exclusive with `itemtype`." });
        }
        if (p.items && p.allowedvalues) {
            issues.push({ level: "error", path: label, message: "`items` is mutually exclusive with `allowedvalues`." });
        }
        if (p.itemtype && !["array", "collection"].includes(p.type)) {
            issues.push({ level: "error", path: label, message: "`itemtype` requires `type = \"array\"` or `type = \"collection\"`." });
        }
        if (p.type === "collection" && !hasCollectionItemConstraint(node)) {
            issues.push({ level: "error", path: label, message: "A collection must define an effective `itemtype` locally or through composition." });
        }
        if (p.items && (p.minlength != null || p.maxlength != null)) {
            issues.push({ level: "error", path: label, message: "`items` is mutually exclusive with `minlength`/`maxlength`." });
        }

        const hasMin = p.min != null && p.min !== "";
        const hasMax = p.max != null && p.max !== "";
        if (hasMin) pushTokenIssue(label, "min", p.min);
        if (hasMax) pushTokenIssue(label, "max", p.max);
        if (p.default != null) pushTokenIssue(label, "default", p.default);
        for (const [index, token] of (p.allowedvalues || []).entries()) {
            const parsed = parseTokenForValidation(token);
            if (!parsed.ok) {
                issues.push({ level: "error", path: label, message: `\`allowedvalues[${index}]\` must be a valid TOML value token (${parsed.message}).` });
            }
        }
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
            if (p.minlength != null && !isIntegerValue(p.minlength)) {
                issues.push({ level: "error", path: label, message: "`minlength` must be an integer." });
            }
            if (p.maxlength != null && !isIntegerValue(p.maxlength)) {
                issues.push({ level: "error", path: label, message: "`maxlength` must be an integer." });
            }
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

        if (Object.prototype.hasOwnProperty.call(p, "uniqueitems")) {
            if (!isBooleanValue(p.uniqueitems)) {
                issues.push({ level: "error", path: label, message: "`uniqueitems` must be a boolean." });
            }
            if (p.type !== "array") {
                issues.push({ level: "error", path: label, message: "`uniqueitems` requires the built-in type `array`." });
            }
        }

        if (Object.prototype.hasOwnProperty.call(p, "deprecated") && !isBooleanValue(p.deprecated)) {
            issues.push({ level: "error", path: label, message: "`deprecated` must be a boolean." });
        }
        if (Object.prototype.hasOwnProperty.call(p, "optional") && !isBooleanValue(p.optional)) {
            issues.push({ level: "error", path: label, message: "`optional` must be a boolean." });
        }

        if (Object.prototype.hasOwnProperty.call(p, "type")) {
            validateRef(label, "type", p.type);
        }
        if (Object.prototype.hasOwnProperty.call(p, "itemtype")) {
            validateRef(label, "itemtype", p.itemtype, { disallowCollection: true });
        }
        for (const ref of p.items || []) validateRef(label, "items", ref, { disallowCollection: true });
        for (const ref of p.oneof || []) validateRef(label, "oneof", ref, { disallowAny: true, disallowCollection: true });
        for (const ref of p.anyof || []) validateRef(label, "anyof", ref, { disallowAny: true, disallowCollection: true });
        for (const ref of p.allof || []) validateRef(label, "allof", ref, { disallowAny: true, disallowCollection: true });

        if (Array.isArray(p.allof) && p.allof.length > 0) {
            const localKinds = selectorKindsForNode;
            for (const ref of p.allof) {
                const kinds = resolvedKinds(ref);
                if (kinds.size > 1) {
                    issues.push({ level: "error", path: label, message: `\`allof\` reference \`${ref}\` must resolve to one effective TOML kind.` });
                    continue;
                }
                if (kinds.size === 1 && localKinds.size > 0) {
                    const componentKind = [...kinds][0];
                    const incompatible = [...localKinds].some((kind) => kind !== componentKind);
                    if (incompatible) {
                        issues.push({ level: "error", path: label, message: `\`allof\` reference \`${ref}\` is incompatible with this definition's effective kind.` });
                    }
                }
            }
        }

        if (Object.prototype.hasOwnProperty.call(p, "dependentrequired")) {
            validatePresenceMapping(label, "dependentrequired", p.dependentrequired, fixedChildren, selectorKindsForNode);
        }
        if (Object.prototype.hasOwnProperty.call(p, "mutuallyexclusive")) {
            validatePresenceGroups(label, "mutuallyexclusive", p.mutuallyexclusive, fixedChildren, selectorKindsForNode);
        }
        if (Object.prototype.hasOwnProperty.call(p, "exactlyone")) {
            validatePresenceGroups(label, "exactlyone", p.exactlyone, fixedChildren, selectorKindsForNode);
        }

        for (const child of node.children || []) {
            walk(child, `${label}.${child.name}`);
        }
    };

    for (const t of model.types || []) walk(t, `types.${t.name}`);
    for (const e of model.elements || []) walk(e, `elements.${e.name}`);

    const visited = new Set();
    const visitSelector = (name, visiting = new Set()) => {
        name = normalizeRef(name);
        if (!name || BUILTIN_TYPES.includes(name) || visited.has(name) || !typesByName.has(name)) return;
        if (visiting.has(name)) {
            issues.push({ level: "error", path: `types.${name}`, message: "Cyclic type selector reference." });
            return;
        }
        const nextVisiting = new Set(visiting).add(name);
        const props = typesByName.get(name).props || {};
        if (props.type) visitSelector(props.type, nextVisiting);
        for (const ref of [...(props.oneof || []), ...(props.anyof || []), ...(props.allof || [])]) {
            visitSelector(ref, nextVisiting);
        }
        visited.add(name);
    };
    for (const name of typeNames) visitSelector(name);

    if (!parsedVersion) {
        issues.push({ level: "error", path: "toml-schema.version", message: "version must be a full SemVer string (e.g. 1.0.0)." });
    } else if (parsedVersion.major !== 1 || parsedVersion.minor > 0) {
        issues.push({ level: "error", path: "toml-schema.version", message: "This editor supports TOML Schema 1.0 only." });
    }

    return issues;
}

function parseSemver(version) {
    const match = SEMVER_RE.exec(String(version || ""));
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}
