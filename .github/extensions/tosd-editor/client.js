// tosd-editor client SPA. Plain DOM, no build step. Talks to the extension's
// loopback server: GET /state, POST /preview (model -> toml + issues),
// POST /save (persist model to disk).

const BUILTIN_TYPES = [
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
const SIMPLE_TYPES = [
    "any",
    "string",
    "integer",
    "float",
    "boolean",
    "offset-date-time",
    "local-date-time",
    "local-date",
    "local-time",
];
const NUMERIC_TEMPORAL = [
    "integer",
    "float",
    "offset-date-time",
    "local-date-time",
    "local-date",
    "local-time",
];

const state = {
    path: null,
    model: null,
    selected: null,
    dirty: false,
    showAll: false,
    previewTab: "toml",
    lastIssues: [],
    view: "elements",
    zoom: 1,
    showLegend: false,
    kbFocus: false,
};

function resolvedKinds(ref, seen = new Set()) {
    if (!ref) return new Set();
    const name = ref.startsWith("types.") ? ref.slice(6) : ref;
    if (BUILTIN_TYPES.includes(name)) return new Set([name]);
    if (seen.has(name)) return new Set();
    const definition = (state.model?.types || []).find((candidate) => candidate.name === name);
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
}

const $ = (sel, root = document) => root.querySelector(sel);

let uidCounter = 0;
const uid = (prefix = "f") => `tosd-${prefix}-${++uidCounter}`;

function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v != null) node.setAttribute(k, v);
    }
    for (const kid of kids) {
        if (kid == null) continue;
        node.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return node;
}

// --- Networking ---------------------------------------------------------
async function load() {
    const res = await fetch("state");
    const data = await res.json();
    state.path = data.path;
    state.model = data.model;
    state.dirty = false;
    state.selected = (state.model.elements[0] || state.model.types[0]) ?? null;
    resetHistory();
    renderAll();
    schedulePreview();
}

let previewTimer = null;
function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 200);
}

async function refreshPreview() {
    try {
        const res = await fetch("preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(state.model),
        });
        const data = await res.json();
        state.lastIssues = data.issues || [];
        $("#preview").textContent = data.toml || "";
        renderIssues();
        updateValidityPill();
    } catch (e) {
        $("#preview").textContent = "// preview error: " + e.message;
    }
}

async function save() {
    const btn = $("#save");
    btn.disabled = true;
    try {
        const res = await fetch("save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(state.model),
        });
        const data = await res.json();
        if (data.ok) {
            state.dirty = false;
            history.saved = snapshot();
            updateStatus("saved", "Saved");
        } else {
            updateStatus("dirty", "Save failed: " + (data.error || "unknown"));
        }
    } catch (e) {
        updateStatus("dirty", "Save failed: " + e.message);
    } finally {
        btn.disabled = false;
    }
}

function markDirty() {
    state.dirty = true;
    updateStatus("dirty", "Unsaved changes");
    scheduleHistory();
    schedulePreview();
}

// --- Undo / redo history ------------------------------------------------
// Snapshots capture only persistent schema shape. Rapid edits (e.g. typing in
// a field) are coalesced into a single history entry via a short timer so undo
// steps map to meaningful user actions rather than individual keystrokes.
const history = { undo: [], redo: [], base: null, saved: null, timer: null, pending: false };

function snapshot() {
    const transientKeys = new Set(["__x", "__cy", "__root"]);
    const schemaNodes = new WeakSet();
    const collect = (nodes) => {
        for (const node of nodes || []) {
            schemaNodes.add(node);
            collect(node.children);
        }
    };
    collect(state.model.types);
    collect(state.model.elements);
    return JSON.stringify(
        { version: state.model.version, meta: state.model.meta, types: state.model.types, elements: state.model.elements },
        function replacer(k, v) {
            return schemaNodes.has(this) && transientKeys.has(k) ? undefined : v;
        },
    );
}

function resetHistory(markSaved = true) {
    history.undo = [];
    history.redo = [];
    history.base = snapshot();
    if (markSaved) history.saved = history.base;
    history.pending = false;
    clearTimeout(history.timer);
    updateHistoryButtons();
}

function scheduleHistory() {
    history.pending = true;
    clearTimeout(history.timer);
    history.timer = setTimeout(commitHistory, 400);
    updateHistoryButtons();
}

function commitHistory() {
    clearTimeout(history.timer);
    if (!history.pending) return;
    history.pending = false;
    const current = snapshot();
    if (current === history.base) return;
    history.undo.push(history.base);
    if (history.undo.length > 100) history.undo.shift();
    history.redo = [];
    history.base = current;
    updateHistoryButtons();
}

function findPath(list, target, acc) {
    for (const n of list || []) {
        const p = [...acc, n.name];
        if (n === target) return p;
        if (n.children) {
            const r = findPath(n.children, target, p);
            if (r) return r;
        }
    }
    return null;
}

function selectionRef() {
    if (state.selected === "__meta__") return { meta: true };
    if (!state.selected || typeof state.selected !== "object") return null;
    for (const view of ["elements", "types"]) {
        const p = findPath(state.model[view], state.selected, []);
        if (p) return { view, path: p };
    }
    return null;
}

function resolveSelection(ref) {
    if (!ref) return null;
    if (ref.meta) return "__meta__";
    let list = state.model[ref.view];
    let node = null;
    for (const name of ref.path) {
        node = (list || []).find((n) => n.name === name);
        if (!node) return null;
        list = node.children;
    }
    if (node) state.view = ref.view;
    return node;
}

function applySnapshot(str) {
    const ref = selectionRef();
    const d = JSON.parse(str);
    state.model.version = d.version;
    state.model.meta = d.meta;
    state.model.types = d.types;
    state.model.elements = d.elements;
    state.selected = resolveSelection(ref);
    history.base = str;
    state.dirty = str !== history.saved;
    renderAll();
    schedulePreview();
}

function undo() {
    commitHistory();
    if (!history.undo.length) return;
    history.redo.push(snapshot());
    applySnapshot(history.undo.pop());
    updateHistoryButtons();
}

function redo() {
    commitHistory();
    if (!history.redo.length) return;
    history.undo.push(snapshot());
    applySnapshot(history.redo.pop());
    updateHistoryButtons();
}

function updateHistoryButtons() {
    const u = $("#undo");
    const r = $("#redo");
    if (u) u.disabled = history.undo.length === 0 && !history.pending;
    if (r) r.disabled = history.redo.length === 0;
}

// --- Status / header ----------------------------------------------------
function updateStatus(cls, text) {
    const s = $("#status");
    s.className = "status " + cls;
    s.textContent = text;
    $("#save").disabled = !state.dirty;
}

function updateValidityPill() {
    const errs = state.lastIssues.filter((i) => i.level === "error").length;
    const warns = state.lastIssues.filter((i) => i.level === "warning").length;
    const pill = $("#validity");
    if (errs > 0) {
        pill.className = "pill err";
        pill.textContent = `${errs} error${errs > 1 ? "s" : ""}`;
    } else if (warns > 0) {
        pill.className = "pill";
        pill.textContent = `${warns} warning${warns > 1 ? "s" : ""}`;
    } else {
        pill.className = "pill ok";
        pill.textContent = "valid";
    }
}

// --- Render orchestration -----------------------------------------------
function renderAll() {
    $("#path").value = state.path || "";
    $("#path").title = state.path || "";
    renderDiagram();
    renderEditor();
    updateStatus(state.dirty ? "dirty" : "saved", state.dirty ? "Unsaved changes" : "No changes");
}

// Back-compat alias: existing mutations call renderTree().
function renderTree() {
    renderDiagram();
}

function typeBadge(node) {
    const p = node.props || {};
    if (p.type) return BUILTIN_TYPES.includes(p.type) ? p.type : "→ " + p.type.replace(/^types\./, "");
    if (p.oneof) return "oneof";
    if (p.anyof) return "anyof";
    if (node.children && node.children.length) return "table";
    return "?";
}

function typeCategory(node) {
    const p = node.props || {};
    const t = p.type;
    if (t === "string") return "string";
    if (t === "integer" || t === "float" || t === "number") return "number";
    if (t === "boolean") return "boolean";
    if (t === "datetime" || t === "date" || t === "time" || t === "offset-datetime" || t === "local-datetime" || t === "local-date" || t === "local-time") return "date";
    if (t === "table" || t === "collection") return "table";
    if (t === "array") return "array";
    if (t && !BUILTIN_TYPES.includes(t)) return "ref";
    if (p.oneof || p.anyof) return "choice";
    if (node.children && node.children.length) return "table";
    return "any";
}

// --- Diagram (design view) ----------------------------------------------
const DG = { BOX_W: 214, BOX_H: 58, H_GAP: 62, V_GAP: 16, PAD: 24 };

function cardinality(node) {
    const p = node.props || {};
    const many = p.type === "array" || p.type === "collection";
    if (many) {
        const lo = p.minlength != null ? p.minlength : (p.optional ? 0 : 1);
        const hi = p.maxlength != null ? p.maxlength : "\u221e";
        return `${lo}\u2026${hi}`;
    }
    return p.optional ? "0\u20261" : "1";
}

function cardinalityLabel(node) {
    const p = node.props || {};
    const many = p.type === "array" || p.type === "collection";
    if (many) {
        const lo = p.minlength != null ? p.minlength : (p.optional ? 0 : 1);
        const hi = p.maxlength != null ? p.maxlength : "unlimited";
        return `Repeats ${lo} to ${hi}`;
    }
    return p.optional ? "Optional (0 or 1)" : "Required (exactly 1)";
}

function compositor(node) {
    const p = node.props || {};
    if (p.type === "array" || p.type === "collection") return { glyph: "\u21bb", cls: "repeat", title: "Repeating items" };
    if (p.oneof) return { glyph: "\u25c8", cls: "choice", title: "One of \u2014 exactly one alternative" };
    if (p.anyof) return { glyph: "\u25c6", cls: "choice", title: "Any of \u2014 at least one alternative" };
    return { glyph: "\u2630", cls: "sequence", title: "All child fields (sequence)" };
}

// Type references on this node that don't resolve to a builtin or defined type.
function unresolvedRefs(node) {
    const p = node.props || {};
    const refs = [];
    if (p.type) refs.push(p.type);
    if (p.itemtype) refs.push(p.itemtype);
    for (const r of p.items || []) refs.push(r);
    for (const r of p.oneof || []) refs.push(r);
    for (const r of p.anyof || []) refs.push(r);
    return refs.filter((r) => r && !isKnownRef(r));
}

function visKids(n) {
    if (n.__root) return n.children;
    return n.__collapsed ? [] : (n.children || []);
}

function renderDiagram() {
    const host = $("#diagram");
    if (!host) return;
    host.textContent = "";

    const view = state.view || "elements";
    document.querySelectorAll(".vtab").forEach((b) => {
        const on = b.dataset.view === view;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });

    const roots = state.model[view] || [];
    const root = { __root: true, name: view, children: roots, props: {} };

    const placed = [];
    const links = [];
    let cursorY = DG.PAD;

    function layout(node, depth) {
        const x = DG.PAD + depth * (DG.BOX_W + DG.H_GAP);
        const kids = visKids(node);
        let y;
        if (!kids || kids.length === 0) {
            y = cursorY + DG.BOX_H / 2;
            cursorY += DG.BOX_H + DG.V_GAP;
        } else {
            const ys = kids.map((k) => layout(k, depth + 1));
            y = (ys[0] + ys[ys.length - 1]) / 2;
        }
        node.__x = x;
        node.__cy = y;
        placed.push({ node, depth });
        for (const k of kids) links.push({ from: node, to: k });
        return y;
    }
    layout(root, 0);

    let maxX = 0, maxY = 0;
    for (const { node } of placed) {
        maxX = Math.max(maxX, node.__x + DG.BOX_W);
        maxY = Math.max(maxY, node.__cy + DG.BOX_H / 2);
    }
    const totalW = maxX + DG.PAD;
    const totalH = Math.max(maxY + DG.PAD, cursorY + DG.PAD);
    state.__totalW = totalW;
    state.__totalH = totalH;

    const inner = el("div", { class: "diagram-inner", role: "tree", "aria-label": "Schema " + view });
    inner.style.width = totalW + "px";
    inner.style.height = totalH + "px";
    inner.style.transform = "scale(" + (state.zoom || 1) + ")";

    const SVGNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "dg-links");
    svg.setAttribute("width", totalW);
    svg.setAttribute("height", totalH);
    for (const { from, to } of links) {
        const x1 = from.__x + DG.BOX_W;
        const y1 = from.__cy;
        const x2 = to.__x;
        const y2 = to.__cy;
        const midX = x1 + DG.H_GAP / 2;
        const path = document.createElementNS(SVGNS, "path");
        path.setAttribute("d", `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
        path.setAttribute("class", "dg-link" + (state.selected === to ? " active" : ""));
        svg.appendChild(path);
    }
    inner.appendChild(svg);

    for (const { node } of placed) {
        const kids = visKids(node);
        if (node.__root || !kids.length) continue;
        const c = compositor(node);
        const chip = el("div", { class: "dg-comp " + c.cls, title: c.title, role: "img", "aria-label": c.title, text: c.glyph });
        chip.style.left = (node.__x + DG.BOX_W + DG.H_GAP / 2 - 11) + "px";
        chip.style.top = (node.__cy - 11) + "px";
        inner.appendChild(chip);
    }

    for (const { node, depth } of placed) {
        inner.appendChild(node.__root ? rootBox(node) : diagramBox(node, depth));
    }

    host.appendChild(inner);

    if (!roots.length) {
        const empty = el("div", { class: "dg-empty" });
        empty.append(el("p", { text: "No " + view + " defined yet." }));
        empty.append(el("button", {
            class: "primary",
            text: "+ Add " + (view === "types" ? "type" : "element"),
            onclick: () => addNode(state.model[view], [view]),
        }));
        host.appendChild(empty);
    }

    const zl = $("#zoom-label");
    if (zl) zl.textContent = Math.round((state.zoom || 1) * 100) + "%";
    refreshTypeRefs();

    // Roving tabindex: ensure exactly one box is tab-reachable.
    if (!inner.querySelector('.dg-box[tabindex="0"]')) {
        const first = inner.querySelector(".dg-box");
        if (first) first.setAttribute("tabindex", "0");
    }
    if (state.kbFocus) {
        const sel = inner.querySelector(".dg-box.selected");
        if (sel) sel.focus();
        state.kbFocus = false;
    }
}

function rootBox(node) {
    const box = el("div", { class: "dg-root", role: "presentation", "aria-hidden": "true" });
    box.style.left = node.__x + "px";
    box.style.top = (node.__cy - DG.BOX_H / 2) + "px";
    box.style.width = DG.BOX_W + "px";
    box.style.height = DG.BOX_H + "px";
    box.append(el("span", { class: "dg-root-label", text: "[" + node.name + "]" }));
    const n = node.children.length;
    box.append(el("span", { class: "dg-root-sub", text: n + " " + (n === 1 ? "entry" : "entries") }));
    box.setAttribute("aria-label", "[" + node.name + "], " + n + (n === 1 ? " entry" : " entries"));
    return box;
}

function diagramBox(node, depth = 1) {
    const p = node.props || {};
    const kids = node.children || [];
    const selected = state.selected === node;
    const unresolved = unresolvedRefs(node);
    const box = el("div", {
        class: "dg-box" + (selected ? " selected" : "") + (p.optional ? " optional" : "") + (unresolved.length ? " has-error" : ""),
        "data-cat": typeCategory(node),
        role: "treeitem",
        "aria-level": String(depth),
        "aria-selected": selected ? "true" : "false",
        tabindex: selected ? "0" : "-1",
    });
    if (kids.length) box.setAttribute("aria-expanded", node.__collapsed ? "false" : "true");
    const ariaParts = [node.name, typeBadge(node), cardinalityLabel(node)];
    if (p.optional) ariaParts.push("optional");
    if (unresolved.length) ariaParts.push("unresolved reference " + unresolved.join(", "));
    box.setAttribute("aria-label", ariaParts.join(", "));
    box.style.left = node.__x + "px";
    box.style.top = (node.__cy - DG.BOX_H / 2) + "px";
    box.style.width = DG.BOX_W + "px";
    box.style.height = DG.BOX_H + "px";
    box.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        selectNode(node);
    });
    box.addEventListener("keydown", (e) => onBoxKeydown(e, node));

    const top = el("div", { class: "dg-top" });
    top.append(el("span", { class: "dg-accent" }));
    top.append(el("span", { class: "dg-name", text: node.name }));
    if (unresolved.length) {
        top.append(el("span", { class: "dg-warn", role: "img", title: "Unresolved type reference: " + unresolved.join(", "), "aria-label": "Unresolved reference", text: "\u26a0" }));
    }
    top.append(el("span", { class: "dg-card", title: cardinalityLabel(node), "aria-hidden": "true", text: cardinality(node) }));
    box.append(top);

    const typeLine = el("div", { class: "dg-typeline" });
    typeLine.append(el("span", { class: "dg-type", "data-cat": typeCategory(node), text: typeBadge(node) }));
    const jumpReference = p.type && !BUILTIN_TYPES.includes(p.type)
        ? p.type
        : p.itemtype && !BUILTIN_TYPES.includes(p.itemtype) ? p.itemtype : null;
    if (jumpReference) {
        typeLine.append(el("button", {
            class: "dg-jump",
            title: "Jump to " + jumpReference,
            text: "\u2197",
            onclick: (e) => { e.stopPropagation(); jumpToType(jumpReference); },
        }));
    }
    box.append(typeLine);

    if (kids.length) {
        box.append(el("button", {
            class: "dg-expander",
            text: node.__collapsed ? "+" : "\u2013",
            title: node.__collapsed ? "Expand" : "Collapse",
            "aria-label": (node.__collapsed ? "Expand " : "Collapse ") + node.name + " (" + kids.length + " field" + (kids.length > 1 ? "s" : "") + ")",
            onclick: (e) => { e.stopPropagation(); node.__collapsed = !node.__collapsed; renderDiagram(); },
        }));
    }

    const acts = el("div", { class: "dg-actions" });
    acts.append(el("button", { class: "icon", title: "Add child field", "aria-label": "Add child field to " + node.name, text: "+", onclick: (e) => { e.stopPropagation(); addChild(node); } }));
    acts.append(el("button", { class: "icon", title: "Move up", "aria-label": "Move " + node.name + " up", text: "\u2191", onclick: (e) => { e.stopPropagation(); moveNode(node, -1); } }));
    acts.append(el("button", { class: "icon", title: "Move down", "aria-label": "Move " + node.name + " down", text: "\u2193", onclick: (e) => { e.stopPropagation(); moveNode(node, 1); } }));
    acts.append(el("button", { class: "icon danger", title: "Delete " + node.name, "aria-label": "Delete " + node.name, text: "\u2715", onclick: (e) => { e.stopPropagation(); deleteNode(node); } }));
    box.append(acts);

    return box;
}

// Flatten currently-visible nodes in top-to-bottom order for keyboard nav.
function flatVisible() {
    const out = [];
    const walk = (list) => {
        for (const n of list || []) {
            out.push(n);
            if (!n.__collapsed && n.children && n.children.length) walk(n.children);
        }
    };
    walk(state.model[state.view || "elements"] || []);
    return out;
}

function parentOf(node) {
    const search = (list, parent) => {
        for (const n of list || []) {
            if (n === node) return parent;
            if (n.children) {
                const r = search(n.children, n);
                if (r !== undefined) return r;
            }
        }
        return undefined;
    };
    const r = search(state.model[state.view] || [], null);
    return r === undefined ? null : r;
}

function onBoxKeydown(e, node) {
    if (e.target.closest("button, input, select, textarea, a[href]")) return;
    const flat = flatVisible();
    const idx = flat.indexOf(node);
    const kids = node.children || [];
    switch (e.key) {
        case "ArrowDown":
            e.preventDefault();
            if (idx < flat.length - 1) selectNode(flat[idx + 1], true);
            break;
        case "ArrowUp":
            e.preventDefault();
            if (idx > 0) selectNode(flat[idx - 1], true);
            break;
        case "ArrowRight":
            e.preventDefault();
            if (kids.length && node.__collapsed) { node.__collapsed = false; state.kbFocus = true; renderDiagram(); }
            else if (kids.length) selectNode(kids[0], true);
            break;
        case "ArrowLeft":
            e.preventDefault();
            if (kids.length && !node.__collapsed) { node.__collapsed = true; state.kbFocus = true; renderDiagram(); }
            else { const par = parentOf(node); if (par) selectNode(par, true); }
            break;
        case "Enter":
        case " ":
            e.preventDefault();
            selectNode(node, true);
            break;
        case "Delete":
        case "Backspace":
            e.preventDefault();
            deleteNode(node);
            break;
    }
}

function selectNode(node, kb = false) {
    state.selected = node;
    state.kbFocus = kb;
    renderDiagram();
    renderEditor();
}

function jumpToType(ref) {
    const name = String(ref).replace(/^types\./, "");
    const target = (state.model.types || []).find((t) => t.name === name);
    if (!target) return;
    state.view = "types";
    selectNode(target);
}

function moveNode(node, dir) {
    const findList = (list) => {
        if (list.includes(node)) return list;
        for (const n of list) {
            if (n.children) {
                const r = findList(n.children);
                if (r) return r;
            }
        }
        return null;
    };
    const list = findList(state.model.elements) || findList(state.model.types);
    if (!list) return;
    const i = list.indexOf(node);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    markDirty();
    renderDiagram();
}

function setZoom(z) {
    state.zoom = Math.min(2, Math.max(0.3, z));
    renderDiagram();
}

function fitZoom() {
    const host = $("#diagram");
    if (!host || !state.__totalW) return;
    const z = Math.min(
        (host.clientWidth - 16) / state.__totalW,
        (host.clientHeight - 16) / state.__totalH,
        1.4,
    );
    setZoom(z);
    host.scrollTo({ left: 0, top: 0 });
}

// --- Mutations ----------------------------------------------------------
function uniqueName(siblings, base) {
    let name = base;
    let i = 1;
    const taken = new Set(siblings.map((s) => s.name));
    while (taken.has(name)) name = `${base}${++i}`;
    return name;
}

function addNode(siblings, basePath) {
    const isType = basePath[basePath.length - 1] === "types";
    const node = {
        name: uniqueName(siblings, isType ? "newType" : "newField"),
        props: { type: "string" },
        children: [],
    };
    siblings.push(node);
    state.selected = node;
    markDirty();
    renderTree();
    renderEditor();
}

function addChild(node) {
    node.props = node.props || {};
    if (!node.props.type && !node.props.oneof && !node.props.anyof) {
        node.props.type = "table";
    }
    const child = { name: uniqueName(node.children, "field"), props: { type: "string" }, children: [] };
    node.children.push(child);
    node.__collapsed = false;
    state.selected = child;
    markDirty();
    renderTree();
    renderEditor();
}

function deleteNode(node) {
    const kidCount = (node.children || []).length;
    const detail = kidCount ? ` and its ${kidCount} child field${kidCount > 1 ? "s" : ""}` : "";
    if (!confirm(`Delete "${node.name}"${detail}? You can undo this with Ctrl/Cmd+Z.`)) return;
    const removeFrom = (list) => {
        const idx = list.indexOf(node);
        if (idx >= 0) {
            list.splice(idx, 1);
            return true;
        }
        return list.some((n) => n.children && removeFrom(n.children));
    };
    removeFrom(state.model.types);
    removeFrom(state.model.elements);
    if (state.selected === node) state.selected = null;
    markDirty();
    renderTree();
    renderEditor();
}

// --- Editor -------------------------------------------------------------
function renderEditor() {
    const box = $("#editor");
    box.textContent = "";
    const closeBtn = $("#prop-close");
    if (closeBtn) closeBtn.hidden = !state.selected;
    if (state.selected === "__meta__") return renderMetaEditor(box);
    const node = state.selected;
    if (!node) {
        box.append(el("div", { class: "empty", text: "Select a type or element on the left, or add a new one." }));
        return;
    }

    const p = (node.props = node.props || {});

    // Header: name + actions
    const nameId = uid("name");
    const header = el("div", { class: "field" });
    header.append(el("label", { for: nameId, text: "Name" }));
    const nameInput = el("input", {
        type: "text",
        id: nameId,
        class: "mono",
        value: node.name,
        oninput: (e) => {
            node.name = e.target.value;
            markDirty();
            // update diagram label lazily (avoid full re-render to keep focus)
            const sel = document.querySelector(".dg-box.selected .dg-name");
            if (sel) sel.textContent = node.name;
        },
    });
    header.append(nameInput);
    box.append(header);

    const actions = el("div", { class: "field inline" });
    actions.append(el("button", { text: "+ Add child", onclick: () => addChild(node) }));
    actions.append(el("button", { class: "danger", text: "Delete", onclick: () => deleteNode(node) }));
    box.append(actions);

    box.append(textField("description", "Description", p.description || "", (v) => setProp(p, "description", v),
        false, "Human-readable documentation for this schema definition."));

    // Current-node type selector
    box.append(
        refField("type", "Type", p.type || "", (v) => setProp(p, "type", v),
            "A built-in type or reusable type reference. Mutually exclusive with oneof/anyof."),
    );

    const t = p.type;

    // Array-specific
    if (t === "array") {
        box.append(refField("itemtype", "Item type", p.itemtype || "", (v) => setProp(p, "itemtype", v),
            "Validate every item against a built-in or reusable type."));
        box.append(listField("items", "Positional items (tuple)", p.items || [], (arr) => setListProp(p, "items", arr),
            true, "Ordered type refs; fixed arity. Mutually exclusive with itemtype."));
    }

    if (t === "collection") {
        box.append(refField("itemtype", "Item type", p.itemtype || "", (v) => setProp(p, "itemtype", v),
            "Validate each dynamically keyed collection value against this type."));
    }

    // Current-node alternatives
    if (!t || p.oneof || p.anyof) {
        box.append(listField("oneof", "oneof (exactly one)", p.oneof || [], (arr) => setListProp(p, "oneof", arr), true));
        box.append(listField("anyof", "anyof (at least one)", p.anyof || [], (arr) => setListProp(p, "anyof", arr), true));
    }

    // string pattern + allowedvalues for simple types
    if (t === "string") {
        box.append(textField("pattern", "Pattern (regex)", p.pattern || "", (v) => setProp(p, "pattern", v), true,
            "Portable RE2-profile regular expression."));
    }
    // collection key pattern
    if (t === "collection") {
        box.append(textField("keypattern", "Key pattern (regex)", p.keypattern || "", (v) => setProp(p, "keypattern", v), true,
            "Portable RE2-profile regex every dynamic entry key must match."));
    }
    if (SIMPLE_TYPES.includes(t) || t === "array") {
        box.append(listField("allowedvalues", "Allowed values (enum)", p.allowedvalues || [],
            (arr) => setListProp(p, "allowedvalues", arr), false,
            "TOML value tokens, e.g. \"red\" or 80."));
    }

    // min / max for numeric/temporal (or arrays thereof)
    const itemKinds = t === "array" ? resolvedKinds(p.itemtype) : new Set();
    const showRange = NUMERIC_TEMPORAL.includes(t)
        || (itemKinds.size === 1 && NUMERIC_TEMPORAL.includes([...itemKinds][0]));
    if (showRange) {
        const row = el("div", { class: "row-2" });
        row.append(textField("min", "min", p.min || "", (v) => setProp(p, "min", v), true));
        row.append(textField("max", "max", p.max || "", (v) => setProp(p, "max", v), true));
        box.append(row);
    }

    // length for string/array/collection
    if (["string", "array", "collection"].includes(t)) {
        const row = el("div", { class: "row-2" });
        row.append(numField("minlength", "minlength", p.minlength, (v) => setNumProp(p, "minlength", v)));
        row.append(numField("maxlength", "maxlength", p.maxlength, (v) => setNumProp(p, "maxlength", v)));
        box.append(row);
    }

    // optional (always available)
    box.append(checkboxField("optional", "Optional (may be omitted in the document)", !!p.optional, (v) => {
        if (v) p.optional = true;
        else delete p.optional;
        markDirty();
        renderTree();
    }));

    // Show-all advanced toggle
    const toggle = el("button", {
        class: "toggle-all",
        text: state.showAll ? "Hide advanced properties" : "Show all properties",
        onclick: () => {
            state.showAll = !state.showAll;
            renderEditor();
        },
    });
    box.append(toggle);
    if (state.showAll) box.append(advancedAll(p));

    if (t === "table") {
        box.append(el("div", { class: "field hint", text: "Table fields are managed as children in the tree. A table with no children is treated as open-ended." }));
    }
}

function advancedAll(p) {
    const wrap = el("div");
    wrap.append(el("div", { class: "section-title", text: "All properties" }));
    const allProps = ["type", "itemtype", "pattern", "keypattern", "min", "max"];
    for (const key of allProps) {
        wrap.append(textField(key, key, p[key] != null ? String(p[key]) : "", (v) => setProp(p, key, v), true));
    }
    for (const key of ["minlength", "maxlength"]) {
        wrap.append(numField(key, key, p[key], (v) => setNumProp(p, key, v)));
    }
    for (const key of ["items", "oneof", "anyof", "allowedvalues"]) {
        wrap.append(listField(key, key, p[key] || [], (arr) => setListProp(p, key, arr), key !== "allowedvalues"));
    }
    return wrap;
}

function setProp(p, key, v) {
    if (v == null || v === "") delete p[key];
    else p[key] = v;
    markDirty();
}
function setNumProp(p, key, v) {
    if (v === "" || v == null || Number.isNaN(v)) delete p[key];
    else p[key] = v;
    markDirty();
}
function setListProp(p, key, arr) {
    const clean = arr.filter((s) => s !== "");
    if (clean.length === 0 && key !== "allowedvalues") delete p[key];
    else p[key] = clean;
    markDirty();
    renderTree();
}

// --- Field builders -----------------------------------------------------
function knownTypeNames() {
    return new Set((state.model.types || []).map((t) => t.name));
}

function isKnownRef(v) {
    const val = String(v || "").trim();
    if (!val) return true;
    if (BUILTIN_TYPES.includes(val)) return true;
    const names = knownTypeNames();
    if (val.startsWith("types.")) return names.has(val.slice(6));
    return names.has(val);
}

function markRefValidity(input, msgEl) {
    const ok = isKnownRef(input.value);
    input.classList.toggle("invalid", !ok);
    input.setAttribute("aria-invalid", ok ? "false" : "true");
    if (msgEl) msgEl.textContent = ok ? "" : "Unknown type reference \u2014 define it under Types first.";
}

function textField(name, label, value, onchange, mono = false, hint) {
    const id = uid("in");
    const f = el("div", { class: "field" });
    f.append(labelEl(label, hint, id));
    f.append(el("input", {
        type: "text",
        id,
        class: mono ? "mono" : "",
        value,
        placeholder: name,
        oninput: (e) => onchange(e.target.value),
    }));
    return f;
}

function numField(name, label, value, onchange) {
    const id = uid("num");
    const f = el("div", { class: "field" });
    f.append(labelEl(label, null, id));
    f.append(el("input", {
        type: "number",
        id,
        value: value != null ? value : "",
        placeholder: name,
        oninput: (e) => onchange(e.target.value === "" ? "" : Number(e.target.value)),
    }));
    return f;
}

function selectField(label, value, options, onchange, hint) {
    const id = uid("sel");
    const f = el("div", { class: "field" });
    f.append(labelEl(label, hint, id));
    const sel = el("select", { id, onchange: (e) => onchange(e.target.value) });
    for (const opt of options) {
        const o = el("option", { value: opt, text: opt === "" ? "(none)" : opt });
        if (opt === value) o.selected = true;
        sel.append(o);
    }
    f.append(sel);
    return f;
}

function checkboxField(name, label, checked, onchange) {
    const id = uid("chk");
    const f = el("div", { class: "field inline" });
    const cb = el("input", { type: "checkbox", id, onchange: (e) => onchange(e.target.checked) });
    cb.checked = checked;
    f.append(cb);
    f.append(el("label", { for: id, text: label }));
    return f;
}

function refField(name, label, value, onchange, hint) {
    const id = uid("ref");
    const errId = uid("err");
    const f = el("div", { class: "field" });
    f.append(labelEl(label, hint, id));
    const msg = el("div", { class: "field-err", id: errId, role: "alert" });
    const input = el("input", {
        type: "text",
        id,
        class: "mono",
        value,
        placeholder: name,
        list: "type-refs",
        "aria-describedby": errId,
        oninput: (e) => { onchange(e.target.value); markRefValidity(input, msg); },
    });
    f.append(input);
    f.append(msg);
    markRefValidity(input, msg);
    return f;
}

function listField(name, label, values, onchange, isRef, hint) {
    const f = el("div", { class: "field" });
    const groupId = uid("list");
    f.append(labelEl(label, hint, null, groupId));
    const arr = [...values];
    const container = el("div", { role: "group", "aria-labelledby": groupId });
    const rerender = () => {
        container.textContent = "";
        arr.forEach((val, idx) => {
            const row = el("div", { class: "list-row" });
            const input = el("input", {
                type: "text",
                class: "mono",
                value: val,
                "aria-label": `${label} item ${idx + 1}`,
                list: isRef ? "type-refs" : null,
                oninput: (e) => {
                    arr[idx] = e.target.value;
                    onchange([...arr]);
                    if (isRef) input.classList.toggle("invalid", !isKnownRef(e.target.value));
                },
            });
            if (isRef) input.classList.toggle("invalid", !isKnownRef(val));
            row.append(input);
            row.append(el("button", {
                class: "icon danger",
                text: "\u2715",
                "aria-label": `Remove ${label} item ${idx + 1}`,
                title: "Remove",
                onclick: () => {
                    arr.splice(idx, 1);
                    onchange([...arr]);
                    rerender();
                },
            }));
            container.append(row);
        });
    };
    rerender();
    f.append(container);
    f.append(el("button", {
        class: "icon add-row",
        text: "+ add",
        "aria-label": "Add " + label + " item",
        onclick: () => {
            arr.push("");
            onchange([...arr]);
            rerender();
            const inputs = container.querySelectorAll("input");
            if (inputs.length) inputs[inputs.length - 1].focus();
        },
    }));
    return f;
}

function labelEl(text, hint, forId, id) {
    const attrs = {};
    if (forId) attrs.for = forId;
    if (id) attrs.id = id;
    const l = el("label", attrs, text);
    if (hint) l.append(el("span", { class: "hint", text: hint }));
    return l;
}

function refreshTypeRefs() {
    const dl = $("#type-refs");
    dl.textContent = "";
    for (const b of BUILTIN_TYPES) dl.append(el("option", { value: b }));
    for (const t of state.model.types) dl.append(el("option", { value: "types." + t.name }));
}

// --- Meta editor --------------------------------------------------------
function renderMetaEditor(box) {
    box.append(el("div", { class: "section-title", text: "Schema metadata" }));
    box.append(textField("version", "version (SemVer)", state.model.version || "1.0.0", (v) => {
        state.model.version = v;
        markDirty();
    }, true, "Full MAJOR.MINOR.PATCH, e.g. 1.0.0"));

    box.append(el("div", { class: "section-title", text: "[toml-schema.meta] (custom metadata)" }));
    const meta = state.model.meta || {};
    const entries = Object.entries(meta).filter(([, v]) => typeof v === "string");
    const preserved = Object.fromEntries(Object.entries(meta).filter(([, v]) => typeof v !== "string"));
    const container = el("div");
    const conflictMessage = el("div", { class: "field-err", role: "alert" });
    const arr = entries.map(([k, v]) => [k, v]);
    const keyConflict = (key, index) => !!key && (
        Object.prototype.hasOwnProperty.call(preserved, key)
        || arr.some((pair, otherIndex) => otherIndex !== index && pair[0] === key)
    );
    const validateKeys = () => {
        let hasConflict = false;
        [...container.querySelectorAll(".meta-key")].forEach((input, index) => {
            const conflict = keyConflict(arr[index][0], index);
            hasConflict ||= conflict;
            input.classList.toggle("invalid", conflict);
            input.setAttribute("aria-invalid", conflict ? "true" : "false");
            input.title = conflict ? "Metadata keys must be unique and cannot replace preserved typed metadata." : "";
        });
        conflictMessage.textContent = hasConflict
            ? "Metadata keys must be unique and cannot replace preserved typed metadata."
            : "";
        return !hasConflict;
    };
    const commit = () => {
        if (!validateKeys()) return;
        const obj = { ...preserved };
        for (const [k, v] of arr) {
            if (k === "") continue;
            obj[k] = v;
        }
        state.model.meta = Object.keys(obj).length ? obj : null;
        markDirty();
    };
    const rerender = () => {
        container.textContent = "";
        arr.forEach((pair, idx) => {
            const row = el("div", { class: "list-row" });
            row.append(el("input", { type: "text", class: "mono meta-key", value: pair[0], placeholder: "key", "aria-label": "Metadata key " + (idx + 1),
                oninput: (e) => { arr[idx][0] = e.target.value; validateKeys(); commit(); } }));
            row.append(el("input", { type: "text", class: "mono", value: pair[1], placeholder: "value", "aria-label": "Metadata value " + (idx + 1),
                oninput: (e) => { arr[idx][1] = e.target.value; commit(); } }));
            row.append(el("button", { class: "icon danger", text: "\u2715", "aria-label": "Remove metadata " + (idx + 1), title: "Remove",
                onclick: () => { arr.splice(idx, 1); commit(); rerender(); } }));
            container.append(row);
        });
        validateKeys();
    };
    rerender();
    box.append(container);
    box.append(conflictMessage);
    box.append(el("button", { class: "icon", text: "+ add metadata", onclick: () => { arr.push(["", ""]); rerender(); } }));
    const preservedCount = Object.keys(preserved).length;
    box.append(el("div", {
        class: "field hint",
        text: preservedCount
            ? `${preservedCount} typed or nested metadata entr${preservedCount === 1 ? "y is" : "ies are"} preserved read-only. New values are stored as strings.`
            : "New values are stored as strings. Use the preview to confirm output.",
    }));
}

// --- Issues -------------------------------------------------------------
function renderIssues() {
    const box = $("#issues");
    box.textContent = "";
    for (const issue of state.lastIssues) {
        const row = el("div", { class: "issue " + issue.level, role: "listitem" });
        row.append(el("span", { class: "lvl", text: issue.level === "error" ? "ERROR" : "WARN" }));
        row.append(el("span", { text: issue.message }));
        row.append(el("span", { class: "where mono", text: issue.path }));
        box.append(row);
    }
}

// --- Boot ---------------------------------------------------------------
function boot() {
    document.body.innerHTML = `
    <div class="toolbar">
      <div class="tb-row tb-row-info">
        <div class="tb-brand">
          <span class="brand-mark">&#9670;</span>
          <span class="brand-text">TOML Schema <b>Editor</b></span>
        </div>
        <span class="tb-sep"></span>
        <div class="tb-info">
          <input class="path-field mono" id="path" readonly title="" placeholder="(new schema)" aria-label="Schema file path" />
          <span class="pill" id="validity" role="status" aria-live="polite"></span>
          <span class="status" id="status" role="status" aria-live="polite"></span>
        </div>
      </div>
      <div class="tb-row tb-row-actions">
        <div class="tb-actions">
          <div class="tb-group">
            <button id="add-element" class="btn"><span class="bi">+</span>Element</button>
            <button id="add-type" class="btn"><span class="bi">+</span>Type</button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button id="undo" class="btn icon-btn" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled><span class="bi">&#8630;</span></button>
            <button id="redo" class="btn icon-btn" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" disabled><span class="bi">&#8631;</span></button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button id="generate" class="btn accent" title="Describe a config file and let Copilot generate the schema"><span class="bi">&#10024;</span>Generate</button>
            <button id="infer" class="btn" title="Infer a schema from a sample TOML document">Infer from TOML</button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button id="new" class="btn" title="Start a new, empty schema"><span class="bi">&#10010;</span>New</button>
            <button id="open" class="btn" title="Open an existing .tosd schema file"><span class="bi">&#128193;</span>Open</button>
          </div>
          <span class="spacer"></span>
          <div class="tb-group">
            <button id="revert" class="btn ghost" title="Discard changes and reload from disk">Revert</button>
            <button id="save" class="btn primary" title="Save to disk (Ctrl/Cmd+S)">Save</button>
          </div>
        </div>
      </div>
    </div>
    <div class="workspace">
      <div class="diagram-pane">
        <div class="diagram-bar">
          <div class="view-tabs" role="tablist" aria-label="Schema view">
            <button class="vtab active" data-view="elements" role="tab" aria-selected="true">Elements</button>
            <button class="vtab" data-view="types" role="tab" aria-selected="false">Types</button>
          </div>
          <button id="dg-add" class="icon" title="Add a top-level entry to this view">+ Add</button>
          <button id="dg-meta" class="icon" title="Edit [toml-schema] metadata">&#9881; Metadata</button>
          <span class="spacer"></span>
          <button id="legend-toggle" class="icon" title="Show notation legend" aria-expanded="false" aria-controls="legend">&#9432; Legend</button>
          <div class="zoom">
            <button id="zoom-out" class="icon" title="Zoom out" aria-label="Zoom out">&#8722;</button>
            <span id="zoom-label" class="zoom-label" aria-hidden="true">100%</span>
            <button id="zoom-in" class="icon" title="Zoom in" aria-label="Zoom in">+</button>
            <button id="zoom-fit" class="icon" title="Fit to view">Fit</button>
          </div>
        </div>
        <div class="diagram-scroll" id="diagram" role="region" aria-label="Schema diagram" tabindex="0"></div>
        <div class="legend" id="legend" hidden></div>
      </div>
      <div class="side">
        <div class="panel side-panel">
          <div class="panel-head"><h2>Properties</h2><span class="spacer"></span><button id="prop-close" class="icon" title="Close / deselect" aria-label="Close properties" hidden>&#10005;</button></div>
          <div class="editor" id="editor"></div>
        </div>
        <div class="panel side-panel preview-panel">
          <div class="panel-head"><h2>TOML Preview</h2><span class="spacer"></span></div>
          <div class="preview-wrap">
            <pre class="preview mono" id="preview" tabindex="0" aria-label="Generated TOML preview"></pre>
            <div class="issues" id="issues" role="list" aria-label="Validation issues"></div>
          </div>
        </div>
      </div>
    </div>
    <datalist id="type-refs"></datalist>`;

    $("#save").addEventListener("click", save);
    $("#revert").addEventListener("click", load);
    $("#new").addEventListener("click", newSchema);
    $("#open").addEventListener("click", openSchema);
    $("#generate").addEventListener("click", openGenerateModal);
    $("#infer").addEventListener("click", openInferModal);
    $("#undo").addEventListener("click", undo);
    $("#redo").addEventListener("click", redo);
    $("#add-type").addEventListener("click", () => { state.view = "types"; addNode(state.model.types, ["types"]); });
    $("#add-element").addEventListener("click", () => { state.view = "elements"; addNode(state.model.elements, ["elements"]); });

    document.querySelectorAll(".vtab").forEach((b) =>
        b.addEventListener("click", () => { state.view = b.dataset.view; renderDiagram(); }));
    $("#dg-add").addEventListener("click", () => addNode(state.model[state.view], [state.view]));
    $("#dg-meta").addEventListener("click", () => { state.selected = "__meta__"; renderEditor(); renderDiagram(); });
    $("#zoom-in").addEventListener("click", () => setZoom((state.zoom || 1) + 0.1));
    $("#zoom-out").addEventListener("click", () => setZoom((state.zoom || 1) - 0.1));
    $("#zoom-fit").addEventListener("click", fitZoom);
    $("#prop-close").addEventListener("click", clearSelection);
    $("#legend-toggle").addEventListener("click", toggleLegend);
    renderLegend();

    $("#diagram").addEventListener("click", (e) => {
        if (suppressDiagramClick) { suppressDiagramClick = false; return; }
        if (e.target.closest(".dg-box, .dg-root, .dg-comp, button")) return;
        if (state.selected) clearSelection();
    });
    document.addEventListener("keydown", onGlobalKeydown);
    setupPanning();

    load();
}

function onGlobalKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (state.dirty) save();
        return;
    }
    if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
    }
    if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
    }
    if (e.key === "Escape") {
        const overlay = document.querySelector(".modal-overlay");
        if (overlay) { closeModal(overlay); return; }
        if (state.selected) clearSelection();
    }
}

// --- Legend -------------------------------------------------------------
function toggleLegend() {
    state.showLegend = !state.showLegend;
    renderLegend();
}

function renderLegend() {
    const box = $("#legend");
    const btn = $("#legend-toggle");
    if (!box) return;
    box.hidden = !state.showLegend;
    if (btn) {
        btn.setAttribute("aria-expanded", state.showLegend ? "true" : "false");
        btn.classList.toggle("active", !!state.showLegend);
    }
    if (!state.showLegend) { box.textContent = ""; return; }
    box.textContent = "";

    const group = (title, items) => {
        const g = el("div", { class: "legend-group" });
        g.append(el("div", { class: "legend-title", text: title }));
        for (const [glyph, label, cls] of items) {
            const row = el("div", { class: "legend-item" });
            row.append(el("span", { class: "legend-glyph " + (cls || ""), text: glyph }));
            row.append(el("span", { class: "legend-label", text: label }));
            g.append(row);
        }
        return g;
    };

    box.append(group("Cardinality", [
        ["1", "Required (exactly one)"],
        ["0\u20261", "Optional (zero or one)"],
        ["1\u2026\u221e", "One or more"],
        ["0\u2026\u221e", "Any number"],
    ]));
    box.append(group("Composition", [
        ["\u2630", "Sequence \u2014 all child fields", "sequence"],
        ["\u21bb", "Repeating array / collection", "repeat"],
        ["\u25c8", "One of \u2014 exactly one alternative", "choice"],
        ["\u25c6", "Any of \u2014 at least one alternative", "choice"],
    ]));
    box.append(group("Actions", [
        ["\u2197", "Jump to type definition"],
        ["+ / \u2013", "Expand / collapse children"],
        ["\u26a0", "Unresolved type reference", "warn"],
    ]));

    const cats = [
        ["string", "string"], ["number", "number"], ["boolean", "boolean"],
        ["date", "date/time"], ["table", "table"], ["array", "array"],
        ["ref", "type reference"], ["choice", "one/any of"],
    ];
    const cg = el("div", { class: "legend-group" });
    cg.append(el("div", { class: "legend-title", text: "Type colors" }));
    for (const [cat, label] of cats) {
        const row = el("div", { class: "legend-item" });
        row.append(el("span", { class: "legend-dot", "data-cat": cat }));
        row.append(el("span", { class: "legend-label", text: label }));
        cg.append(row);
    }
    box.append(cg);
}

// --- Pan / hand tool ----------------------------------------------------
let suppressDiagramClick = false;
function setupPanning() {
    const dg = $("#diagram");
    let pan = null;
    dg.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        if (e.target.closest(".dg-box, .dg-root, .dg-comp, button, input, textarea")) return;
        pan = { x: e.clientX, y: e.clientY, sl: dg.scrollLeft, st: dg.scrollTop, moved: false };
        dg.classList.add("panning");
        e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
        if (!pan) return;
        const dx = e.clientX - pan.x;
        const dy = e.clientY - pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
        dg.scrollLeft = pan.sl - dx;
        dg.scrollTop = pan.st - dy;
    });
    window.addEventListener("mouseup", () => {
        if (!pan) return;
        if (pan.moved) suppressDiagramClick = true;
        pan = null;
        dg.classList.remove("panning");
    });
}

function clearSelection() {
    state.selected = null;
    state.kbFocus = false;
    renderEditor();
    renderDiagram();
}

// --- Modal helpers (focus trap + restore) -------------------------------
function installModal(overlay) {
    overlay.__restoreFocus = document.activeElement;
    overlay.__closed = false;
    overlay.__requests = new Set();
    overlay.__trap = (e) => {
        if (e.key !== "Tab") return;
        const f = [...overlay.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')]
            .filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", overlay.__trap, true);
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
}

function modalIsActive(overlay) {
    return !overlay.__closed && overlay.isConnected;
}

async function modalJson(overlay, url, options = {}) {
    const controller = new AbortController();
    overlay.__requests.add(controller);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        const data = await res.json();
        return modalIsActive(overlay) ? data : null;
    } finally {
        overlay.__requests.delete(controller);
    }
}

function modalRequestCancelled(error, overlay) {
    return error?.name === "AbortError" || !modalIsActive(overlay);
}

function closeModal(overlay) {
    if (!overlay || overlay.__closed) return;
    overlay.__closed = true;
    for (const controller of overlay.__requests || []) controller.abort();
    overlay.__requests?.clear();
    if (overlay.__trap) document.removeEventListener("keydown", overlay.__trap, true);
    const restore = overlay.__restoreFocus;
    overlay.remove();
    if (restore && document.contains(restore) && typeof restore.focus === "function") restore.focus();
}

// --- New (empty) schema -------------------------------------------------
function newSchema() {
    if (state.dirty && !confirm("Discard unsaved changes and start a new schema?")) return;
    state.model = { version: "1.0.0", meta: null, types: [], elements: [] };
    state.selected = "__meta__";
    resetHistory(false);
    markDirty();
    renderAll();
}

// --- Generate-with-Copilot modal ---------------------------------------
function openGenerateModal() {
    const existing = $("#generate-modal");
    if (existing) closeModal(existing);

    const titleId = uid("mt");
    const overlay = el("div", { class: "modal-overlay", id: "generate-modal", "aria-labelledby": titleId });
    const dialog = el("div", { class: "modal" });
    dialog.append(el("h3", { id: titleId, text: "\u2728 Generate schema with Copilot" }));
    dialog.append(el("p", { class: "hint", text: "Describe the configuration file you want a schema for \u2014 its sections, fields, and any constraints. Copilot will draft the TOML Schema. The result replaces the current schema (not saved until you click Save)." }));

    const ta = el("textarea", {
        class: "modal-textarea",
        "aria-label": "Configuration description",
        placeholder: "e.g. A web service config with a [server] section (host string, port integer 1-65535), a [database] table with url and pool_size, an optional [logging] section with level one of debug/info/warn/error, and a list of [[routes]] each having path and handler.",
    });
    dialog.append(ta);

    const errBox = el("div", { class: "modal-err", role: "alert" });
    dialog.append(errBox);

    const actions = el("div", { class: "modal-actions" });
    const cancelBtn = el("button", { text: "Cancel", onclick: () => closeModal(overlay) });
    const genBtn = el("button", { class: "primary", text: "Generate" });
    genBtn.addEventListener("click", async () => {
        const description = ta.value.trim();
        if (!description) { errBox.className = "modal-err"; errBox.textContent = "Describe the configuration first."; ta.focus(); return; }
        genBtn.disabled = true;
        ta.disabled = true;
        errBox.className = "modal-err working";
        errBox.textContent = "Asking Copilot\u2026 this runs a Copilot turn and may take a moment.";
        try {
            const data = await modalJson(overlay, "generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description }),
            });
            if (!data) return;
            if (data.error) {
                errBox.className = "modal-err";
                errBox.textContent = data.error;
                genBtn.disabled = false;
                ta.disabled = false;
                return;
            }
            state.model = data.model;
            state.view = "elements";
            state.selected = (state.model.elements[0] || state.model.types[0]) ?? null;
            resetHistory(false);
            markDirty();
            renderAll();
            closeModal(overlay);
        } catch (e) {
            if (modalRequestCancelled(e, overlay)) return;
            errBox.className = "modal-err";
            errBox.textContent = e.message;
            genBtn.disabled = false;
            ta.disabled = false;
        }
    });
    actions.append(cancelBtn, genBtn);
    dialog.append(actions);

    overlay.append(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(overlay); });
    document.body.append(overlay);
    installModal(overlay);
    ta.focus();
}

// --- Open existing schema modal ----------------------------------------
function openSchema() {
    const existing = $("#open-modal");
    if (existing) closeModal(existing);

    const titleId = uid("mt");
    const overlay = el("div", { class: "modal-overlay", id: "open-modal", "aria-labelledby": titleId });
    const dialog = el("div", { class: "modal" });
    dialog.append(el("h3", { id: titleId, text: "\u{1F4C1} Open schema file" }));
    dialog.append(el("p", { class: "hint", text: "Enter the path to an existing .tosd schema file (absolute or workspace-relative). It will be loaded into the editor, replacing the current schema." }));

    const errBox = el("div", { class: "modal-err", role: "alert" });

    const doOpen = async (input, openBtn) => {
        const p = input.value.trim();
        if (!p) { errBox.className = "modal-err"; errBox.textContent = "Enter a file path."; input.focus(); return; }
        errBox.className = "modal-err working";
        errBox.textContent = "Opening\u2026";
        if (openBtn) openBtn.disabled = true;
        try {
            const data = await modalJson(overlay, "open", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: p }),
            });
            if (!data) return;
            if (data.error) { errBox.className = "modal-err"; errBox.textContent = data.error; if (openBtn) openBtn.disabled = false; return; }
            state.path = data.path;
            state.model = data.model;
            state.dirty = false;
            state.selected = (state.model.elements[0] || state.model.types[0]) ?? null;
            resetHistory();
            renderAll();
            schedulePreview();
            closeModal(overlay);
        } catch (e) {
            if (modalRequestCancelled(e, overlay)) return;
            errBox.className = "modal-err";
            errBox.textContent = e.message;
            if (openBtn) openBtn.disabled = false;
        }
    };

    const pathRow = el("div", { class: "list-row" });
    const pathInput = el("input", { type: "text", class: "mono", "aria-label": "Schema file path", placeholder: "path/to/schema.tosd" });
    pathInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doOpen(pathInput, openBtn); } });
    pathRow.append(pathInput);
    dialog.append(pathRow);
    dialog.append(errBox);

    const actions = el("div", { class: "modal-actions" });
    actions.append(el("button", { text: "Cancel", onclick: () => closeModal(overlay) }));
    const openBtn = el("button", { class: "primary", text: "Open" });
    openBtn.addEventListener("click", () => doOpen(pathInput, openBtn));
    actions.append(openBtn);
    dialog.append(actions);

    overlay.append(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(overlay); });
    document.body.append(overlay);
    installModal(overlay);
    pathInput.focus();
}

// --- Infer-from-TOML modal ---------------------------------------------
function openInferModal() {
    const existing = $("#infer-modal");
    if (existing) closeModal(existing);

    const titleId = uid("mt");
    const overlay = el("div", { class: "modal-overlay", id: "infer-modal", "aria-labelledby": titleId });
    const dialog = el("div", { class: "modal" });
    dialog.append(el("h3", { id: titleId, text: "Infer schema from a reference TOML document" }));
    dialog.append(el("p", { class: "hint", text: "Paste a sample TOML document, or load one from a file path. The generated schema replaces the current one (it is not saved until you click Save)." }));

    const pathRow = el("div", { class: "list-row" });
    const pathInput = el("input", { type: "text", class: "mono", "aria-label": "Reference TOML file path", placeholder: "path/to/sample.toml (absolute or workspace-relative)" });
    const loadBtn = el("button", { text: "Load file", onclick: async () => {
        const p = pathInput.value.trim();
        if (!p) { pathInput.focus(); return; }
        errBox.className = "modal-err working";
        errBox.textContent = "Loading\u2026";
        try {
            const data = await modalJson(overlay, "readfile?path=" + encodeURIComponent(p));
            if (!data) return;
            if (data.error) { errBox.className = "modal-err"; errBox.textContent = data.error; return; }
            ta.value = data.content;
            errBox.className = "modal-err";
            errBox.textContent = "";
        } catch (e) {
            if (modalRequestCancelled(e, overlay)) return;
            errBox.className = "modal-err";
            errBox.textContent = e.message;
        }
    } });
    pathRow.append(pathInput, loadBtn);
    dialog.append(pathRow);

    const ta = el("textarea", { class: "mono modal-textarea", "aria-label": "TOML content to infer from", placeholder: "# paste TOML here\ntitle = \"Example\"\n[owner]\nname = \"…\"" });
    dialog.append(ta);

    const errBox = el("div", { class: "modal-err", role: "alert" });
    dialog.append(errBox);

    const actions = el("div", { class: "modal-actions" });
    actions.append(el("button", { text: "Cancel", onclick: () => closeModal(overlay) }));
    const inferBtn = el("button", { class: "primary", text: "Infer schema" });
    inferBtn.addEventListener("click", async () => {
        const toml = ta.value;
        if (!toml.trim()) { errBox.className = "modal-err"; errBox.textContent = "Provide some TOML to infer from."; ta.focus(); return; }
        inferBtn.disabled = true;
        errBox.className = "modal-err working";
        errBox.textContent = "Inferring\u2026";
        try {
            const data = await modalJson(overlay, "infer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toml }),
            });
            if (!data) return;
            if (data.error) { errBox.className = "modal-err"; errBox.textContent = data.error; inferBtn.disabled = false; return; }
            state.model = data.model;
            state.selected = (state.model.elements[0] || state.model.types[0]) ?? null;
            resetHistory(false);
            markDirty();
            renderAll();
            closeModal(overlay);
        } catch (e) {
            if (modalRequestCancelled(e, overlay)) return;
            errBox.className = "modal-err";
            errBox.textContent = e.message;
            inferBtn.disabled = false;
        }
    });
    actions.append(inferBtn);
    dialog.append(actions);

    overlay.append(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(overlay); });
    document.body.append(overlay);
    installModal(overlay);
    ta.focus();
}

boot();
