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
    if (GROUPLIST_PROPS.has(key)) {
        if (!Array.isArray(value) || value.some((group) => !Array.isArray(group) || group.some((entry) => typeof entry !== "string"))) {
            throw new TomlError(`${path}.${key} must be an array of string arrays.`);
        }
        return decodeGroupList(value);
    }
    if (MAPLIST_PROPS.has(key)) {
        const inner = value && value.__inline ? value.value : value;
        if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
            throw new TomlError(`${path}.${key} must be an inline table of string arrays.`);
        }
        for (const entry of Object.values(inner)) {
            if (!Array.isArray(entry) || entry.some((name) => typeof name !== "string")) {
                throw new TomlError(`${path}.${key} must map each key to an array of strings.`);
            }
        }
        return decodeDependentRequired(value);
    }
    if (VALUELIST_PROPS.has(key)) {
        if (!Array.isArray(value)) throw new TomlError(`${path}.${key} must be an array.`);
        return value.map(formatValue);
    }
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
        return (Array.isArray(raw) ? raw : []).map(String).filter((s) => s.trim() !== "");
    }
    if (GROUPLIST_PROPS.has(key)) {
        return normalizeGroups(raw);
    }
    if (MAPLIST_PROPS.has(key)) {
        return normalizeDependentRequired(raw);
    }
    if (VALUELIST_PROPS.has(key)) {
        const arr = (Array.isArray(raw) ? raw : [])
            .map((tok) => parseTokenForEmit(tok))
            .filter((v) => v !== undefined);
        return arr;
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
    const details = tokenDetails(raw);
    return details?.kind === "integer" ? details.value : undefined;
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

// ---------------------------------------------------------------------------
// Schema-load validation of declared defaults.
//
// SPEC.md requires a declared default to validate as a present value against
// the full effective definition: references, composition, alternatives, fixed
// children, sibling rules, and ordinary constraints all apply, while
// deprecation warnings are suppressed. Validation is read-only; defaults are
// never materialized into the model or into the document being validated.
// ---------------------------------------------------------------------------

class SchemaResolutionError extends Error {
    constructor(message, { code = "unresolved" } = {}) {
        super(message);
        this.name = "SchemaResolutionError";
        this.code = code;
    }
}

function normalizeTypeRef(ref) {
    if (typeof ref !== "string") return "";
    return ref.startsWith("types.") ? ref.slice(6) : ref;
}

function isBuiltinRef(ref) {
    return typeof ref === "string" && !ref.startsWith("types.") && BUILTIN_TYPES.includes(ref);
}

function namedTypeRef(props) {
    const ref = props?.type;
    return typeof ref === "string" && ref.trim() !== "" && !isBuiltinRef(ref) ? ref : null;
}

function alternativeRefs(props) {
    if (Array.isArray(props?.oneof) && props.oneof.length > 0) return props.oneof;
    return Array.isArray(props?.anyof) ? props.anyof : [];
}

// Mirrors the loader rule that a definition with children but no selector is a table.
function builtinTypeOf(node) {
    const props = node.props || {};
    if (isBuiltinRef(props.type)) return props.type;
    if ((node.children || []).length > 0) return "table";
    return "any";
}

function valueKind(value) {
    if (typeof value === "string") return "string";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return Number.isInteger(value) ? "integer" : "float";
    if (Array.isArray(value)) return "array";
    if (value && typeof value === "object") {
        if (value.__integer) return "integer";
        if (value.__float) return "float";
        if (value.__datetime) return value.__datetime;
        if (value.__inline) return "table";
        if (value.__rawToml) return null;
        return "table";
    }
    return null;
}

function valueDetails(value) {
    const kind = valueKind(value);
    if (!kind) return null;
    return { raw: formatValue(value), value, kind };
}

function isNaNDetails(details) {
    if (!details || details.kind !== "float") return false;
    const raw = details.value?.__float ? details.value.value : String(details.value);
    return /nan/i.test(raw);
}

function tableObject(value) {
    if (value && typeof value === "object" && value.__inline) return value.value || {};
    return value || {};
}

function isTableValue(value) {
    return valueKind(value) === "table";
}

function tableKeys(value) {
    return Object.keys(tableObject(value));
}

function tableHasKey(value, key) {
    return Object.prototype.hasOwnProperty.call(tableObject(value), key);
}

function tableGetKey(value, key) {
    return tableObject(value)[key];
}

function valuesEqual(left, right) {
    const leftKind = valueKind(left);
    const rightKind = valueKind(right);
    if (!leftKind || !rightKind) return false;
    if (leftKind === "array" || rightKind === "array") {
        if (leftKind !== rightKind || left.length !== right.length) return false;
        return left.every((item, index) => valuesEqual(item, right[index]));
    }
    if (leftKind === "table" || rightKind === "table") {
        if (leftKind !== rightKind) return false;
        const a = tableObject(left);
        const b = tableObject(right);
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && valuesEqual(a[key], b[key]));
    }
    if (["integer", "float"].includes(leftKind) && ["integer", "float"].includes(rightKind)) {
        const a = valueDetails(left);
        const b = valueDetails(right);
        if (isNaNDetails(a) || isNaNDetails(b)) return isNaNDetails(a) && isNaNDetails(b);
        return compareNumeric(a, b) === 0;
    }
    if (leftKind !== rightKind) return false;
    if (leftKind === "string" || leftKind === "boolean") return left === right;
    return compareTemporal(valueDetails(left), valueDetails(right)) === 0;
}

function compileRegex(pattern) {
    if (typeof pattern !== "string" || pattern === "") return null;
    try {
        return new RegExp(pattern, "u");
    } catch {
        return null;
    }
}

function lengthBound(raw) {
    if (raw == null || raw === "") return null;
    return integerBigInt(tokenDetails(raw));
}

function compareWithBoundary(details, boundary) {
    if (!details || !boundary) return null;
    if (numericComparable(details) && numericComparable(boundary)) return compareNumeric(details, boundary);
    if (details.kind === boundary.kind && details.value?.__datetime && boundary.value?.__datetime) {
        return compareTemporal(details, boundary);
    }
    return null;
}

function createDefaultChecker(typesByName) {
    const builtins = new Map();

    const builtinDefinition = (name) => {
        if (!builtins.has(name)) builtins.set(name, { name, props: { type: name }, children: [] });
        return builtins.get(name);
    };

    const resolve = (ref, visiting) => {
        if (isBuiltinRef(ref)) return builtinDefinition(ref);
        const name = normalizeTypeRef(ref).trim();
        if (!name) throw new SchemaResolutionError("blank type reference");
        if (visiting.has(name)) {
            throw new SchemaResolutionError(`cyclic type reference through \`types.${name}\``, { code: "cycle" });
        }
        visiting.add(name);
        const definition = typesByName.get(name);
        if (!definition) throw new SchemaResolutionError(`unknown type reference \`${ref}\``);
        return definition;
    };

    const collectFixedChildren = (node, visiting) => {
        const result = new Set((node.children || []).map((child) => child.name));
        const props = node.props || {};
        const merge = (ref) => {
            const scope = new Set(visiting);
            for (const name of collectFixedChildren(resolve(ref, scope), scope)) result.add(name);
        };
        const reference = namedTypeRef(props);
        if (reference) merge(reference);
        for (const alternative of alternativeRefs(props)) merge(alternative);
        for (const component of props.allof || []) merge(component);
        return result;
    };

    const effectiveKind = (node, visiting) => {
        const props = node.props || {};
        const reference = namedTypeRef(props);
        if (reference) {
            const scope = new Set(visiting);
            return effectiveKind(resolve(reference, scope), scope);
        }
        const alternatives = alternativeRefs(props);
        if (alternatives.length > 0) {
            let kind = null;
            for (const alternative of alternatives) {
                const scope = new Set(visiting);
                const candidate = effectiveKind(resolve(alternative, scope), scope);
                if (kind === null) kind = candidate;
                else if (kind !== candidate) return "any";
            }
            return kind === null ? "any" : kind;
        }
        return builtinTypeOf(node);
    };

    const resolvesToUnionSelector = (node, visiting) => {
        const props = node.props || {};
        if (alternativeRefs(props).length > 0) return true;
        const reference = namedTypeRef(props);
        if (!reference) return false;
        const scope = new Set(visiting);
        return resolvesToUnionSelector(resolve(reference, scope), scope);
    };

    const isOptional = (node, visiting) => {
        const props = node.props || {};
        if (props.optional === true) return true;
        const reference = namedTypeRef(props);
        if (!reference) return false;
        const scope = new Set(visiting);
        return isOptional(resolve(reference, scope), scope);
    };

    const isValueOfType = (value, type) => {
        if (type === "any") return true;
        const kind = valueKind(value);
        if (type === "table" || type === "collection") return kind === "table";
        return kind === type;
    };

    const add = (errors, path, message) => errors.push({ path, message });

    // Keys allowed at this node by contributors other than the one being validated.
    const siblingChildren = (node, externalChildren, excludePrimary, excludedComponent, visiting) => {
        const props = node.props || {};
        const result = new Set(externalChildren);
        for (const child of node.children || []) result.add(child.name);
        if (!excludePrimary) {
            for (const name of primaryChildren(node, visiting)) result.add(name);
        }
        for (const component of props.allof || []) {
            if (component === excludedComponent) continue;
            const scope = new Set(visiting);
            for (const name of collectFixedChildren(resolve(component, scope), scope)) result.add(name);
        }
        return result;
    };

    const primaryChildren = (node, visiting) => {
        const props = node.props || {};
        const reference = namedTypeRef(props);
        if (reference) {
            const scope = new Set(visiting);
            return collectFixedChildren(resolve(reference, scope), scope);
        }
        const result = new Set();
        for (const alternative of alternativeRefs(props)) {
            const scope = new Set(visiting);
            for (const name of collectFixedChildren(resolve(alternative, scope), scope)) result.add(name);
        }
        return result;
    };

    const validateValue = (path, value, node, errors) => {
        const fixedChildren = collectFixedChildren(node, new Set());
        validateContributor(path, value, node, new Set(), new Set(), errors);
        if (effectiveKind(node, new Set()) === "table"
            && !resolvesToUnionSelector(node, new Set())
            && isTableValue(value)
            && fixedChildren.size > 0) {
            for (const key of tableKeys(value)) {
                if (!fixedChildren.has(key)) add(errors, `${path}.${key}`, "unexpected key");
            }
        }
    };

    const validateContributor = (path, value, node, externalChildren, visiting, errors) => {
        const props = node.props || {};
        const reference = namedTypeRef(props);
        const alternatives = alternativeRefs(props);
        if (reference) {
            const scope = new Set(visiting);
            const target = resolve(reference, scope);
            validateContributor(path, value, target,
                siblingChildren(node, externalChildren, true, null, visiting), scope, errors);
            if (isTableValue(value)) validatePresenceRules(path, value, node, errors);
            if (Array.isArray(value) && props.uniqueitems === true) validateUniqueItems(path, value, errors);
        } else if (alternatives.length > 0) {
            validateUnion(path, value, node,
                siblingChildren(node, externalChildren, true, null, visiting), errors);
            if (isTableValue(value)) validatePresenceRules(path, value, node, errors);
            if (Array.isArray(value) && props.uniqueitems === true) validateUniqueItems(path, value, errors);
        } else {
            const type = builtinTypeOf(node);
            if (!isValueOfType(value, type)) {
                add(errors, path, `expected ${type} but found ${valueKind(value) || "an unparsable value"}`);
            } else {
                validateCommonConstraints(path, value, node, errors);
                if (type === "table") {
                    validateFixedChildren(path, value, node.children, errors);
                    validatePresenceRules(path, value, node, errors);
                } else if (type === "collection") {
                    const known = new Set(externalChildren);
                    for (const name of collectFixedChildren(node, new Set(visiting))) known.add(name);
                    validateCollection(path, value, node, known, errors);
                } else if (type === "array") {
                    validateArray(path, value, node, errors);
                }
            }
        }
        for (const component of props.allof || []) {
            const scope = new Set(visiting);
            const target = resolve(component, scope);
            validateContributor(path, value, target,
                siblingChildren(node, externalChildren, false, component, visiting), scope, errors);
        }
    };

    const validateUnion = (path, value, node, sharedChildren, errors) => {
        const props = node.props || {};
        const alternatives = alternativeRefs(props);
        let successful = 0;
        for (const alternative of alternatives) {
            const branchErrors = [];
            const scope = new Set();
            const target = resolve(alternative, scope);
            const closure = new Set(collectFixedChildren(target, new Set(scope)));
            for (const name of sharedChildren) closure.add(name);
            validateContributor(path, value, target, sharedChildren, new Set(scope), branchErrors);
            if (effectiveKind(target, new Set(scope)) === "table" && isTableValue(value) && closure.size > 0) {
                for (const key of tableKeys(value)) {
                    if (!closure.has(key)) add(branchErrors, `${path}.${key}`, "unexpected key");
                }
            }
            if (branchErrors.length === 0) successful += 1;
        }
        if (Array.isArray(props.oneof) && props.oneof.length > 0) {
            if (successful !== 1) {
                add(errors, path, `expected exactly one matching type from oneof but found ${successful}`);
            }
            return;
        }
        if (successful === 0) add(errors, path, "expected at least one matching type from anyof");
    };

    const validateFixedChildren = (path, table, children, errors) => {
        for (const child of children || []) {
            const childPath = `${path}.${child.name}`;
            if (!tableHasKey(table, child.name)) {
                if (!isOptional(child, new Set())) add(errors, childPath, "required value is missing");
            } else {
                validateValue(childPath, tableGetKey(table, child.name), child, errors);
            }
        }
    };

    const validateCollection = (path, table, node, fixedChildren, errors) => {
        const props = node.props || {};
        validateFixedChildren(path, table, node.children, errors);
        validatePresenceRules(path, table, node, errors);
        const keyPattern = compileRegex(props.keypattern);
        let dynamicEntries = 0;
        for (const key of tableKeys(table)) {
            if (fixedChildren.has(key)) continue;
            dynamicEntries += 1;
            const childPath = `${path}.${key}`;
            if (keyPattern && !keyPattern.test(key)) {
                add(errors, childPath, `key does not match keypattern ${props.keypattern}`);
            }
            if (props.itemtype) {
                validateValue(childPath, tableGetKey(table, key), resolve(props.itemtype, new Set()), errors);
            }
        }
        validateLength(path, BigInt(dynamicEntries), node, errors);
    };

    const validatePresenceRules = (path, table, node, errors) => {
        const props = node.props || {};
        const mapping = isNonArrayObject(props.dependentrequired) ? props.dependentrequired : {};
        for (const [trigger, required] of Object.entries(mapping)) {
            if (!tableHasKey(table, trigger)) continue;
            for (const name of Array.isArray(required) ? required : []) {
                if (!tableHasKey(table, name)) {
                    add(errors, `${path}.${name}`, `${name} is required when ${trigger} is present`);
                }
            }
        }
        for (const group of Array.isArray(props.mutuallyexclusive) ? props.mutuallyexclusive : []) {
            const present = (Array.isArray(group) ? group : []).filter((name) => tableHasKey(table, name));
            if (present.length > 1) {
                add(errors, path, `at most one of [${group.join(", ")}] may be present`);
            }
        }
        for (const group of Array.isArray(props.exactlyone) ? props.exactlyone : []) {
            const present = (Array.isArray(group) ? group : []).filter((name) => tableHasKey(table, name));
            if (present.length !== 1) {
                add(errors, path, `exactly one of [${group.join(", ")}] must be present`);
            }
        }
    };

    const validateArray = (path, array, node, errors) => {
        const props = node.props || {};
        validateLength(path, BigInt(array.length), node, errors);
        if (props.uniqueitems === true) validateUniqueItems(path, array, errors);
        if (Array.isArray(props.items) && props.items.length > 0) {
            if (array.length !== props.items.length) {
                add(errors, path, `expected array length ${props.items.length} but found ${array.length}`);
            }
            const bound = Math.min(array.length, props.items.length);
            for (let index = 0; index < bound; index += 1) {
                validateValue(`${path}[${index}]`, array[index], resolve(props.items[index], new Set()), errors);
            }
            return;
        }
        const boundaries = rangeBoundaries(props);
        for (let index = 0; index < array.length; index += 1) {
            const item = array[index];
            const itemPath = `${path}[${index}]`;
            if (props.itemtype) {
                validateValue(itemPath, item, resolve(props.itemtype, new Set()), errors);
            }
            if (Array.isArray(props.allowedvalues) && props.allowedvalues.length > 0) {
                validateAllowedValues(itemPath, item, props, errors);
            }
            if (comparableWithBoundaries(item, boundaries)) {
                validateRange(itemPath, item, boundaries, errors);
            }
        }
    };

    const validateUniqueItems = (path, array, errors) => {
        for (let i = 0; i < array.length; i += 1) {
            for (let j = 0; j < i; j += 1) {
                if (valuesEqual(array[i], array[j])) {
                    add(errors, `${path}[${i}]`, `array item duplicates item at index ${j}`);
                    break;
                }
            }
        }
    };

    const validateCommonConstraints = (path, value, node, errors) => {
        const props = node.props || {};
        if (Array.isArray(value)) return;
        const hasAllowedValues = Array.isArray(props.allowedvalues) && props.allowedvalues.length > 0;
        if (hasAllowedValues) {
            validateAllowedValues(path, value, props, errors);
        } else {
            validateRange(path, value, rangeBoundaries(props), errors);
        }
        if (typeof value === "string") {
            validateLength(path, BigInt([...value].length), node, errors);
            const pattern = compileRegex(props.pattern);
            if (pattern && !pattern.test(value)) {
                add(errors, path, `does not match pattern ${props.pattern}`);
            }
        }
    };

    const validateAllowedValues = (path, value, props, errors) => {
        const allowed = Array.isArray(props.allowedvalues) ? props.allowedvalues : [];
        if (allowed.length === 0) return;
        const matches = allowed.some((token) => {
            const parsed = parseTokenForValidation(token);
            return parsed.ok && valuesEqual(parsed.value, value);
        });
        if (!matches) add(errors, path, "value is not in allowedvalues");
    };

    const rangeBoundaries = (props) => ({
        min: props.min != null && props.min !== "" ? tokenDetails(props.min) : null,
        max: props.max != null && props.max !== "" ? tokenDetails(props.max) : null,
    });

    const comparableWithBoundaries = (value, boundaries) => {
        if (!boundaries.min && !boundaries.max) return false;
        const details = valueDetails(value);
        for (const key of ["min", "max"]) {
            if (boundaries[key] && compareWithBoundary(details, boundaries[key]) == null) return false;
        }
        return true;
    };

    const validateRange = (path, value, boundaries, errors) => {
        const details = valueDetails(value);
        for (const key of ["min", "max"]) {
            const boundary = boundaries[key];
            if (!boundary) continue;
            const comparison = compareWithBoundary(details, boundary);
            if (comparison == null) {
                add(errors, path, `cannot be compared with \`${key}\` ${boundary.raw}`);
            } else if (key === "min" ? comparison < 0 : comparison > 0) {
                add(errors, path, `value is ${key === "min" ? "less" : "greater"} than ${key}`);
            }
        }
    };

    const validateLength = (path, length, node, errors) => {
        const props = node.props || {};
        const min = lengthBound(props.minlength);
        const max = lengthBound(props.maxlength);
        if (min != null && length < min) add(errors, path, "length is less than minlength");
        if (max != null && length > max) add(errors, path, "length is greater than maxlength");
    };

    const declaredDefault = (props) => {
        if (!Object.prototype.hasOwnProperty.call(props, "default")) return null;
        const raw = props.default;
        if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
        return parseTokenForValidation(raw);
    };

    const effectiveDefault = (node, visiting) => {
        const props = node.props || {};
        const local = declaredDefault(props);
        if (local) return local.ok ? { present: true, value: local.value } : { present: false };
        const inherited = [];
        const collect = (ref) => {
            if (isBuiltinRef(ref)) return;
            const scope = new Set(visiting);
            const candidate = effectiveDefault(resolve(ref, scope), scope);
            if (candidate.present) inherited.push(candidate.value);
        };
        const reference = namedTypeRef(props);
        if (reference) collect(reference);
        for (const component of props.allof || []) collect(component);
        if (inherited.length === 0) return { present: false };
        const first = inherited[0];
        if (inherited.slice(1).some((value) => !valuesEqual(first, value))) {
            throw new SchemaResolutionError("composed components contribute conflicting defaults", { code: "conflict" });
        }
        return { present: true, value: first };
    };

    return (node, label) => {
        const issue = (message) => ({ level: "error", path: label, message });
        let effective;
        try {
            effective = effectiveDefault(node, new Set());
        } catch (error) {
            if (!(error instanceof SchemaResolutionError)) throw error;
            // Unresolvable and cyclic reference chains are reported by the reference
            // checks; only a real annotation conflict belongs to this definition.
            return error.code === "conflict"
                ? issue(`\`default\` is ambiguous: ${error.message}.`)
                : null;
        }
        if (!effective.present) return null;
        const errors = [];
        try {
            validateValue("$default", effective.value, node, errors);
        } catch (error) {
            if (!(error instanceof SchemaResolutionError)) throw error;
            return error.code === "unresolved"
                ? null
                : issue(`\`default\` cannot be validated because of a ${error.message}.`);
        }
        if (errors.length === 0) return null;
        const first = errors[0];
        return issue(`\`default\` must validate against the effective definition: ${first.message} (at ${first.path}).`);
    };
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

    const normalizeRef = (ref) => normalizeTypeRef(ref);
    const bareBuiltin = (ref) => isBuiltinRef(ref);
    const isNamedRef = (ref) => !!ref && !bareBuiltin(ref);
    const refExists = (ref) => {
        if (!ref) return true;
        const qualified = ref.startsWith("types.");
        const name = qualified ? ref.slice(6) : ref;
        if (!qualified && BUILTIN_TYPES.includes(name)) return true;
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
        if (bareBuiltin(ref)) return new Set([name]);
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
        const direct = bareBuiltin(ref) ? ref : null;
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
        let compiledPattern = null;

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

        const isNamedTypeRef = p.type && isNamedRef(p.type) && refExists(p.type);
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
        if (p.items && p.type !== "array") {
            issues.push({ level: "error", path: label, message: "`items` requires `type = \"array\"`." });
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
        if (hasMin) pushTokenIssue(label, "min", p.min);
        if (hasMax) pushTokenIssue(label, "max", p.max);
        if (p.default != null && p.default !== "") pushTokenIssue(label, "default", p.default);
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

        if (p.allowedvalues != null) {
            if (!Array.isArray(p.allowedvalues)) {
                issues.push({ level: "error", path: label, message: "`allowedvalues` must be an array of TOML values." });
            }
            if (p.type && !SIMPLE_TYPES.has(p.type) && p.type !== "array") {
                issues.push({ level: "error", path: label, message: "`allowedvalues` requires a scalar, unconstrained, or `array` type." });
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
        checkSiblingNames(node.children, label);
    };

    for (const t of model.types || []) walk(t, `types.${t.name}`);
    for (const e of model.elements || []) walk(e, `elements.${e.name}`);

    const checkDefault = createDefaultChecker(typesByName);
    const visitDefaults = (node, label) => {
        const issue = checkDefault(node, label);
        if (issue) issues.push(issue);
        for (const child of node.children || []) visitDefaults(child, `${label}.${child.name}`);
    };
    for (const t of model.types || []) visitDefaults(t, `types.${t.name}`);
    for (const e of model.elements || []) visitDefaults(e, `elements.${e.name}`);

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
        for (const ref of [...(props.oneof || []), ...(props.anyof || []), ...(props.allof || [])]) {
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
