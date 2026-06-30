// Infer a TOML Schema (editor model) from a sample/reference TOML document.
//
// The inference walks a parsed TOML document and produces:
//   * one [elements] entry per top-level key, and
//   * reusable [types] for arrays of tables (and nested arrays of tables),
//     referenced via `itemtype`.
//
// Heuristics are intentionally conservative - the result is a faithful starting
// point that the user refines in the editor. The reserved root [toml-schema]
// table is ignored, matching how it is treated during document validation.

import { parseToml, isPlainTable } from "./toml.mjs";

export function inferModelFromToml(text) {
    const root = parseToml(text || "");
    const ctx = { types: [], usedNames: new Set() };

    const elements = [];
    for (const [key, value] of Object.entries(root)) {
        if (key === "toml-schema") continue; // reserved metadata in TOML documents
        elements.push(inferNode(key, value, ctx));
    }

    return {
        version: "1.0.0",
        meta: null,
        types: ctx.types,
        elements,
    };
}

function inferNode(name, value, ctx) {
    if (isTableLike(value)) {
        const obj = tableObject(value);
        return {
            name,
            props: { type: "table" },
            children: Object.entries(obj).map(([k, v]) => inferNode(k, v, ctx)),
        };
    }
    if (Array.isArray(value)) {
        return { name, props: inferArrayProps(name, value, ctx), children: [] };
    }
    return { name, props: { type: scalarType(value) }, children: [] };
}

function inferArrayProps(name, arr, ctx) {
    if (arr.length === 0) return { type: "array" };

    const allTables = arr.every(isTableLike);
    if (allTables) {
        const typeName = synthTableType(name, arr.map(tableObject), ctx);
        return { type: "array", arraytype: "table", itemtype: `types.${typeName}` };
    }

    const anyArray = arr.some((v) => Array.isArray(v));
    if (anyArray) return { type: "array", arraytype: "array" };

    const kinds = new Set(arr.map((v) => (isTableLike(v) ? "table" : Array.isArray(v) ? "array" : scalarType(v))));
    if (kinds.size === 1) {
        return { type: "array", arraytype: [...kinds][0] };
    }
    // Mixed scalar types: leave arraytype unset (items default to `any`).
    return { type: "array" };
}

// Merge the shape of every table in an array of tables into one reusable type,
// marking fields that are not present in every item as optional.
function synthTableType(baseName, objects, ctx) {
    const typeName = uniqueTypeName(baseName, ctx);
    const node = { name: typeName, props: { type: "table" }, children: [] };
    // Reserve the name immediately so nested synths don't collide.
    ctx.types.push(node);

    const order = [];
    const seen = new Set();
    const valuesByKey = new Map();
    for (const obj of objects) {
        for (const [k, v] of Object.entries(obj)) {
            if (!seen.has(k)) {
                seen.add(k);
                order.push(k);
                valuesByKey.set(k, []);
            }
            valuesByKey.get(k).push(v);
        }
    }

    for (const key of order) {
        const values = valuesByKey.get(key);
        const present = values.length;
        let child;

        if (values.every(isTableLike)) {
            const merged = mergeChildTable(key, values.map(tableObject), ctx);
            child = merged;
        } else if (values.every((v) => Array.isArray(v))) {
            const combined = values.flat();
            child = { name: key, props: inferArrayProps(key, combined, ctx), children: [] };
        } else {
            child = { name: key, props: { type: representativeScalarType(values) }, children: [] };
        }

        if (present < objects.length) child.props.optional = true;
        node.children.push(child);
    }

    return typeName;
}

// A nested table field inside a synthesized type: merge its shape too.
function mergeChildTable(key, objects, ctx) {
    const order = [];
    const seen = new Set();
    const valuesByKey = new Map();
    for (const obj of objects) {
        for (const [k, v] of Object.entries(obj)) {
            if (!seen.has(k)) {
                seen.add(k);
                order.push(k);
                valuesByKey.set(k, []);
            }
            valuesByKey.get(k).push(v);
        }
    }
    const children = [];
    for (const k of order) {
        const values = valuesByKey.get(k);
        let child;
        if (values.every(isTableLike)) {
            child = mergeChildTable(k, values.map(tableObject), ctx);
        } else if (values.every((v) => Array.isArray(v))) {
            child = { name: k, props: inferArrayProps(k, values.flat(), ctx), children: [] };
        } else {
            child = { name: k, props: { type: representativeScalarType(values) }, children: [] };
        }
        if (values.length < objects.length) child.props.optional = true;
        children.push(child);
    }
    return { name: key, props: { type: "table" }, children };
}

function representativeScalarType(values) {
    const kinds = new Set(values.map((v) => (isTableLike(v) ? "table" : Array.isArray(v) ? "array" : scalarType(v))));
    if (kinds.size === 1) return [...kinds][0];
    // Integers seen alongside floats are best represented as float.
    if ([...kinds].every((k) => k === "integer" || k === "float")) return "float";
    return "any";
}

function scalarType(value) {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return Number.isInteger(value) ? "integer" : "float";
    if (value && value.__datetime) return value.__datetime;
    return "string";
}

function isTableLike(value) {
    return isPlainTable(value) || (value && value.__inline === true);
}

function tableObject(value) {
    return value && value.__inline ? value.value : value;
}

function uniqueTypeName(baseName, ctx) {
    let base = singularize(String(baseName).replace(/[^A-Za-z0-9]/g, "")) || "item";
    base = base.charAt(0).toLowerCase() + base.slice(1) + "Type";
    let name = base;
    let i = 1;
    while (ctx.usedNames.has(name)) name = base.replace(/Type$/, "") + ++i + "Type";
    ctx.usedNames.add(name);
    return name;
}

function singularize(word) {
    if (/ies$/i.test(word)) return word.replace(/ies$/i, "y");
    if (/ses$/i.test(word)) return word.replace(/es$/i, "");
    if (/s$/i.test(word) && !/ss$/i.test(word)) return word.replace(/s$/i, "");
    return word;
}
