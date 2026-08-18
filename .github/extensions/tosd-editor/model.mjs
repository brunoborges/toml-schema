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
//   optional                               : boolean
//   minlength/maxlength                    : number
//   items/oneof/anyof                      : string[]  (type references)
//   allowedvalues                          : string[]  (TOML value tokens)
//   min/max                                : string    (TOML value token)

import {
    TomlError,
    parseToml,
    formatValue,
    formatKeyPath,
    parseValue,
    isPlainTable,
    tableCollisions,
} from "./toml.mjs";

export const PROP_ORDER = [
    "type",
    "description",
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

const STRING_PROPS = new Set(["type", "description", "itemtype", "pattern", "keypattern"]);
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
    const root = parseToml(text || "", { allowTableValueCollisions: true });
    const allowedTopLevel = new Set(["toml-schema", "types", "elements"]);
    for (const key of Object.keys(root)) {
        if (!allowedTopLevel.has(key)) {
            throw new TomlError(`Unsupported top-level key or table: ${key}`);
        }
    }

    const meta = root["toml-schema"];
    if (!isPlainTable(meta)) throw new TomlError("Missing required [toml-schema] table.");
    if (!Object.prototype.hasOwnProperty.call(meta, "version")) {
        throw new TomlError("Missing required [toml-schema].version.");
    }
    if (typeof meta.version !== "string") {
        throw new TomlError("[toml-schema].version must be a string.");
    }
    for (const key of [...Object.keys(meta), ...Object.keys(tableCollisions(meta))]) {
        if (!["version", "meta"].includes(key)) {
            throw new TomlError(`Unsupported key or table under [toml-schema]: ${key}`);
        }
    }
    if (Object.prototype.hasOwnProperty.call(meta, "meta") && !isPlainTable(meta.meta)) {
        throw new TomlError("[toml-schema].meta must be a table.");
    }
    if (!isPlainTable(root.elements)) throw new TomlError("Missing required [elements] table.");
    if (root.types !== undefined && !isPlainTable(root.types)) {
        throw new TomlError("[types] must be a table.");
    }

    const metaTable = isPlainTable(meta.meta) ? meta.meta : null;

    return {
        version: meta.version,
        meta: metaTable,
        types: tableToNodes(root.types, "types"),
        elements: tableToNodes(root.elements, "elements"),
    };
}

function tableToNodes(table, basePath) {
    if (!isPlainTable(table)) return [];
    const nodes = [];
    for (const [name, value] of Object.entries(table)) {
        if (!isPlainTable(value)) {
            throw new TomlError(`${basePath}.${name} must be a schema definition table.`);
        }
        nodes.push(tableToNode(name, value, `${basePath}.${name}`));
    }
    return nodes;
}

function tableToNode(name, table, path) {
    const node = { name, props: {}, children: [] };
    for (const [key, value] of Object.entries(table)) {
        if (isPlainTable(value)) {
            node.children.push(tableToNode(key, value, `${path}.${key}`));
        } else if (ALL_PROPS.has(key)) {
            node.props[key] = decodeProp(key, value, path);
        } else if (key === "arraytype" || key === "default") {
            // Preserve removed syntax long enough for validation to report it.
            node.props[key] = String(value);
        } else {
            throw new TomlError(`Unsupported schema property at ${path}: ${key}`);
        }
    }
    for (const [key, value] of Object.entries(tableCollisions(table))) {
        node.children.push(tableToNode(key, value, `${path}.${key}`));
    }
    return node;
}

function decodeProp(key, value, path) {
    if (STRING_PROPS.has(key)) {
        if (typeof value !== "string") throw new TomlError(`${path}.${key} must be a string.`);
        return value;
    }
    if (BOOL_PROPS.has(key)) {
        if (typeof value !== "boolean") throw new TomlError(`${path}.${key} must be a boolean.`);
        return value;
    }
    if (INT_PROPS.has(key)) {
        if (typeof value === "number" && Number.isInteger(value)) return value;
        if (value?.__integer) return value.value;
        throw new TomlError(`${path}.${key} must be an integer.`);
    }
    if (REFLIST_PROPS.has(key)) {
        if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
            throw new TomlError(`${path}.${key} must be an array of type-reference strings.`);
        }
        return value;
    }
    if (VALUELIST_PROPS.has(key)) {
        if (!Array.isArray(value)) throw new TomlError(`${path}.${key} must be an array.`);
        return value.map(formatValue);
    }
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
    if (INT_PROPS.has(key)) {
        const details = tokenDetails(raw);
        return details?.kind === "integer" ? details.value : undefined;
    }
    if (REFLIST_PROPS.has(key)) {
        const arr = (Array.isArray(raw) ? raw : []).map(String).filter((s) => s !== "");
        return arr;
    }
    if (VALUELIST_PROPS.has(key)) {
        const arr = (Array.isArray(raw) ? raw : [])
            .map((tok) => safeParseToken(tok))
            .filter((v) => v !== undefined);
        return arr;
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
    return formatKeyPath([key]);
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

const SIMPLE_TYPES = new Set([
    "any",
    "string",
    "integer",
    "float",
    "boolean",
    "offset-date-time",
    "local-date-time",
    "local-date",
    "local-time",
]);

const SEMVER_RE =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemVer(version) {
    const match = SEMVER_RE.exec(version || "");
    return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

function tokenDetails(token) {
    const raw = String(token ?? "").trim();
    try {
        const value = parseValue(raw);
        let kind;
        if (typeof value === "string") kind = "string";
        else if (typeof value === "boolean") kind = "boolean";
        else if (value?.__integer) kind = "integer";
        else if (value?.__float) kind = "float";
        else if (value?.__datetime) kind = value.__datetime;
        else if (typeof value === "number") {
            kind = /[.eE]|inf|nan/i.test(raw) ? "float" : "integer";
        }
        return { raw, value, kind };
    } catch {
        return null;
    }
}

function numericComparable(details) {
    if (!details || !["integer", "float"].includes(details.kind)) return false;
    if (details.value?.__float) return !details.value.value.toLowerCase().includes("nan");
    return !Number.isNaN(details.value);
}

function integerBigInt(details) {
    if (!details || details.kind !== "integer") return null;
    if (details.value?.__integer) return parseIntegerBigInt(details.value.value);
    return BigInt(details.value);
}

function parseIntegerBigInt(token) {
    const raw = String(token).replace(/_/g, "");
    const sign = raw.startsWith("-") ? -1n : 1n;
    const unsigned = raw.replace(/^[+-]/, "");
    return sign * BigInt(unsigned);
}

function patternIssue(pattern) {
    try {
        new RegExp(pattern, "u");
    } catch (error) {
        return { level: "error", message: `is not a valid regular expression: ${error.message}` };
    }
    if (/\\[dDsSwW]/.test(pattern) || /\\[1-9]/.test(pattern) || /\(\?(?:[=!]|<[=!])/.test(pattern)) {
        return { level: "warning", message: "uses syntax outside the portable RE2 profile" };
    }
    return null;
}

function numericValue(details) {
    if (!numericComparable(details)) return null;
    if (details.kind === "integer") return { numerator: integerBigInt(details), denominator: 1n };
    const token = details.value?.__float ? details.value.value.replace(/_/g, "") : String(details.value);
    const number = token.endsWith("inf")
        ? (token.startsWith("-") ? -Infinity : Infinity)
        : Number(token);
    if (number === Infinity) return { infinity: 1 };
    if (number === -Infinity) return { infinity: -1 };

    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, number, false);
    const bits = view.getBigUint64(0, false);
    const sign = bits >> 63n ? -1n : 1n;
    const exponentBits = Number((bits >> 52n) & 0x7ffn);
    const fractionBits = bits & ((1n << 52n) - 1n);
    const mantissa = exponentBits === 0 ? fractionBits : (1n << 52n) + fractionBits;
    const exponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
    return exponent >= 0
        ? { numerator: sign * (mantissa << BigInt(exponent)), denominator: 1n }
        : { numerator: sign * mantissa, denominator: 1n << BigInt(-exponent) };
}

function compareNumeric(left, right) {
    const a = numericValue(left);
    const b = numericValue(right);
    if (!a || !b) return null;
    if (a.infinity || b.infinity) {
        const av = a.infinity || 0;
        const bv = b.infinity || 0;
        return av === bv ? 0 : av < bv ? -1 : 1;
    }
    const difference = a.numerator * b.denominator - b.numerator * a.denominator;
    return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

function daysFromCivil(year, month, day) {
    const adjustedYear = year - (month <= 2 ? 1 : 0);
    const era = Math.floor(adjustedYear / 400);
    const yearOfEra = adjustedYear - era * 400;
    const shiftedMonth = month + (month > 2 ? -3 : 9);
    const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
    const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return BigInt(era * 146097 + dayOfEra);
}

function parseTime(raw) {
    const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(raw);
    if (!match) return null;
    return {
        seconds: BigInt(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])),
        fraction: match[4] || "",
    };
}

function temporalValue(details) {
    if (!details?.value?.__datetime) return null;
    const raw = details.value.value;
    if (details.kind === "local-date") {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        return match ? { whole: daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3])), fraction: "" } : null;
    }
    if (details.kind === "local-time") {
        const time = parseTime(raw);
        return time ? { whole: time.seconds, fraction: time.fraction } : null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})[Tt ](.+)$/.exec(raw);
    if (!match) return null;
    let timeText = match[4];
    let offsetSeconds = 0;
    if (details.kind === "offset-date-time") {
        const offset = /(Z|[+-]\d{2}:\d{2})$/i.exec(timeText);
        if (!offset) return null;
        timeText = timeText.slice(0, -offset[1].length);
        if (offset[1].toUpperCase() !== "Z") {
            const sign = offset[1][0] === "-" ? -1 : 1;
            offsetSeconds = sign * (Number(offset[1].slice(1, 3)) * 3600 + Number(offset[1].slice(4, 6)) * 60);
        }
    }
    const time = parseTime(timeText);
    if (!time) return null;
    const days = daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3]));
    return { whole: days * 86400n + time.seconds - BigInt(offsetSeconds), fraction: time.fraction };
}

function compareTemporal(left, right) {
    const a = temporalValue(left);
    const b = temporalValue(right);
    if (!a || !b) return null;
    if (a.whole !== b.whole) return a.whole < b.whole ? -1 : 1;
    const width = Math.max(a.fraction.length, b.fraction.length);
    const af = (a.fraction || "").padEnd(width, "0");
    const bf = (b.fraction || "").padEnd(width, "0");
    return af === bf ? 0 : af < bf ? -1 : 1;
}

function valueSatisfiesRange(details, boundary, direction) {
    if (!details || !boundary) return false;
    if (numericComparable(details) && numericComparable(boundary)) {
        const comparison = compareNumeric(details, boundary);
        return comparison != null && (direction === "min" ? comparison >= 0 : comparison <= 0);
    }
    if (details.kind !== boundary.kind || !details.value?.__datetime || !boundary.value?.__datetime) return false;
    const comparison = compareTemporal(details, boundary);
    return comparison != null && (direction === "min" ? comparison >= 0 : comparison <= 0);
}

export function validateModel(model) {
    const issues = [];
    const checkSiblingNames = (nodes, path) => {
        const names = new Set();
        for (const node of nodes || []) {
            if (!node.name) {
                issues.push({ level: "error", path, message: "Schema definition names must not be blank." });
            } else if (names.has(node.name)) {
                issues.push({ level: "error", path: `${path}.${node.name}`, message: `Duplicate schema definition name: ${node.name}.` });
            }
            names.add(node.name);
        }
    };
    checkSiblingNames(model.elements, "elements");

    const typeNames = new Set();
    for (const type of model.types || []) {
        if (!type.name) {
            issues.push({ level: "error", path: "types", message: "Reusable type names must not be blank." });
        } else if (BUILTIN_TYPES.includes(type.name)) {
            issues.push({ level: "error", path: `types.${type.name}`, message: `Built-in type name \`${type.name}\` is reserved.` });
        } else if (typeNames.has(type.name)) {
            issues.push({ level: "error", path: `types.${type.name}`, message: `Duplicate reusable type name: ${type.name}.` });
        }
        typeNames.add(type.name);
    }
    const typesByName = new Map((model.types || []).map((t) => [t.name, t]));

    const refExists = (ref) => {
        if (!ref) return true;
        const qualified = ref.startsWith("types.");
        const name = qualified ? ref.slice(6) : ref;
        if (!qualified && BUILTIN_TYPES.includes(name)) return true;
        return typeNames.has(name);
    };
    const normalizeRef = (ref) => ref?.startsWith("types.") ? ref.slice(6) : ref;
    const bareBuiltin = (ref) => !!ref && !ref.startsWith("types.") && BUILTIN_TYPES.includes(ref);

    const resolvedKinds = (ref, seen = new Set()) => {
        if (!ref) return new Set();
        const name = normalizeRef(ref);
        if (bareBuiltin(ref)) return new Set([name]);
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
        let compiledPattern = null;

        if (p.arraytype != null) {
            issues.push({ level: "error", path: label, message: "`arraytype` is not supported; use `itemtype`." });
        }
        if (p.default != null) {
            issues.push({ level: "error", path: label, message: "`default` is not a TOML Schema property." });
        }

        const exclusivity = ["type", "oneof", "anyof"].filter((k) => Object.prototype.hasOwnProperty.call(p, k));
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
        for (const unionKey of ["oneof", "anyof"]) {
            if (Object.prototype.hasOwnProperty.call(p, unionKey) && (!Array.isArray(p[unionKey]) || p[unionKey].length === 0)) {
                issues.push({ level: "error", path: label, message: `\`${unionKey}\` must contain at least one type reference.` });
            }
        }
        if (Object.prototype.hasOwnProperty.call(p, "oneof") || Object.prototype.hasOwnProperty.call(p, "anyof")) {
            const allowed = new Set(["oneof", "anyof", "description", "optional"]);
            for (const key of Object.keys(p)) {
                if (!allowed.has(key)) {
                    issues.push({ level: "error", path: label, message: `A union cannot define \`${key}\`.` });
                }
            }
        }
        if (p.type && !bareBuiltin(p.type) && refExists(p.type)) {
            const allowed = new Set(["type", "description", "optional"]);
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
        if (p.items && p.type !== "array") {
            issues.push({ level: "error", path: label, message: "`items` requires `type = \"array\"`." });
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
        if (p.items && p.allowedvalues) {
            issues.push({ level: "error", path: label, message: "`items` is mutually exclusive with `allowedvalues`." });
        }
        const minLength = p.minlength != null ? integerBigInt(tokenDetails(p.minlength)) : null;
        const maxLength = p.maxlength != null ? integerBigInt(tokenDetails(p.maxlength)) : null;
        if (p.minlength != null && (minLength == null || minLength < 0n)) {
            issues.push({ level: "error", path: label, message: "`minlength` must be an integer greater than or equal to zero." });
        }
        if (p.maxlength != null && (maxLength == null || maxLength < 0n)) {
            issues.push({ level: "error", path: label, message: "`maxlength` must be an integer greater than or equal to zero." });
        }
        if (minLength != null && maxLength != null && minLength > maxLength) {
            issues.push({ level: "error", path: label, message: "`minlength` must be less than or equal to `maxlength`." });
        }

        const hasMin = p.min != null && p.min !== "";
        const hasMax = p.max != null && p.max !== "";
        const rangeKind = p.type === "array"
            ? (resolvedKinds(p.itemtype).size === 1 ? [...resolvedKinds(p.itemtype)][0] : null)
            : p.type;
        const boundaries = {};
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
            for (const key of ["min", "max"]) {
                if (p[key] == null || p[key] === "") continue;
                const details = tokenDetails(p[key]);
                boundaries[key] = details;
                const valid = NUMERIC_OR_TEMPORAL.has(rangeKind)
                    && (["integer", "float"].includes(rangeKind)
                        ? numericComparable(details)
                        : details?.kind === rangeKind);
                if (!valid) {
                    issues.push({ level: "error", path: label, message: `\`${key}\` must be a comparable TOML value for ${rangeKind || "the selected type"}.` });
                }
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
        } else if (p.pattern) {
            const issue = patternIssue(p.pattern);
            if (issue) issues.push({ level: issue.level, path: label, message: `\`pattern\` ${issue.message}.` });
            if (issue?.level !== "error") compiledPattern = new RegExp(p.pattern, "u");
        }

        if (Object.prototype.hasOwnProperty.call(p, "keypattern") && p.type !== "collection") {
            issues.push({ level: "error", path: label, message: "`keypattern` requires the built-in type `collection`." });
        } else if (p.keypattern) {
            const issue = patternIssue(p.keypattern);
            if (issue) issues.push({ level: issue.level, path: label, message: `\`keypattern\` ${issue.message}.` });
        }

        for (const ref of [p.type, p.itemtype]) {
            if (ref && !refExists(ref)) {
                issues.push({ level: "error", path: label, message: `Unknown type reference: "${ref}".` });
            }
        }
        for (const listKey of ["items", "oneof", "anyof"]) {
            for (const ref of p[listKey] || []) {
                if (!String(ref).trim()) {
                    issues.push({ level: "error", path: label, message: `Type references in ${listKey} must not be blank.` });
                } else if (!refExists(ref)) {
                    issues.push({ level: "error", path: label, message: `Unknown type reference in ${listKey}: "${ref}".` });
                }
                const builtin = bareBuiltin(ref) ? ref : null;
                if (builtin === "collection") {
                    issues.push({ level: "error", path: label, message: `Bare \`collection\` is not valid in ${listKey}.` });
                }
                if (["oneof", "anyof"].includes(listKey) && builtin === "any") {
                    issues.push({ level: "error", path: label, message: `Bare \`any\` is not valid in ${listKey}.` });
                }
            }
        }
        if (bareBuiltin(p.itemtype) && p.itemtype === "collection") {
            issues.push({ level: "error", path: label, message: "Bare `collection` is not valid as an `itemtype`." });
        }

        if (p.allowedvalues != null) {
            if (!Array.isArray(p.allowedvalues)) {
                issues.push({ level: "error", path: label, message: "`allowedvalues` must be an array of TOML values." });
            }
            if (p.type && !SIMPLE_TYPES.has(p.type) && p.type !== "array") {
                issues.push({ level: "error", path: label, message: "`allowedvalues` requires a simple type or `array`." });
            }
            const expectedKind = p.type === "array"
                ? (resolvedKinds(p.itemtype).size === 1 ? [...resolvedKinds(p.itemtype)][0] : null)
                : p.type;
            for (const token of p.allowedvalues || []) {
                const details = tokenDetails(token);
                if (!details) {
                    issues.push({ level: "error", path: label, message: `Invalid TOML value in \`allowedvalues\`: ${token}.` });
                    continue;
                }
                if (expectedKind && expectedKind !== "any") {
                    const sameKind = details.kind === expectedKind
                        || (["integer", "float"].includes(details.kind) && ["integer", "float"].includes(expectedKind));
                    if (!sameKind) {
                        issues.push({ level: "error", path: label, message: `\`allowedvalues\` entry ${token} does not match ${expectedKind}.` });
                        continue;
                    }
                }
                if (compiledPattern && details.kind === "string" && !compiledPattern.test(details.value)) {
                    issues.push({ level: "error", path: label, message: `\`allowedvalues\` entry ${token} does not satisfy \`pattern\`.` });
                }
                if (p.type === "string" && details.kind === "string") {
                    const length = [...details.value].length;
                    if (p.minlength != null && length < p.minlength) {
                        issues.push({ level: "error", path: label, message: `\`allowedvalues\` entry ${token} is shorter than \`minlength\`.` });
                    }
                    if (p.maxlength != null && length > p.maxlength) {
                        issues.push({ level: "error", path: label, message: `\`allowedvalues\` entry ${token} is longer than \`maxlength\`.` });
                    }
                }
                for (const key of ["min", "max"]) {
                    if (boundaries[key] && !valueSatisfiesRange(details, boundaries[key], key)) {
                        issues.push({ level: "error", path: label, message: `\`allowedvalues\` entry ${token} violates \`${key}\`.` });
                    }
                }
            }
        }

        for (const child of node.children || []) {
            walk(child, `${label}.${child.name}`);
        }
        checkSiblingNames(node.children, label);
    };

    for (const t of model.types || []) walk(t, `types.${t.name}`);
    for (const e of model.elements || []) walk(e, `elements.${e.name}`);

    const visited = new Set();
    const visitSelector = (name, visiting = new Set()) => {
        if (!name || bareBuiltin(name)) return;
        name = normalizeRef(name);
        if (visited.has(name) || !typesByName.has(name)) return;
        if (visiting.has(name)) {
            issues.push({ level: "error", path: `types.${name}`, message: "Cyclic type selector reference." });
            return;
        }
        const nextVisiting = new Set(visiting).add(name);
        const props = typesByName.get(name).props || {};
        if (props.type) visitSelector(props.type, nextVisiting);
        for (const ref of [...(props.oneof || []), ...(props.anyof || [])]) {
            visitSelector(ref, nextVisiting);
        }
        visited.add(name);
    };
    for (const name of typeNames) visitSelector(name);

    const semver = parseSemVer(model.version);
    if (!semver) {
        issues.push({ level: "error", path: "toml-schema.version", message: "version must be a full SemVer string (e.g. 1.0.0)." });
    } else if (semver.major !== 1 || semver.minor > 0) {
        issues.push({ level: "error", path: "toml-schema.version", message: `Unsupported TOML Schema version: ${model.version}.` });
    }

    return issues;
}
