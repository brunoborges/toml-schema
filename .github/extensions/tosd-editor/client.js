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
const ARRAY_TYPES = BUILTIN_TYPES.filter((t) => t !== "collection");

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
};

const $ = (sel, root = document) => root.querySelector(sel);
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
    schedulePreview();
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
    $("#path").textContent = state.path || "(new schema)";
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
    if (p.type) return p.type;
    if (p.typeof) return "→ " + p.typeof.replace(/^types\./, "");
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
    if (p.typeof) return "ref";
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

function compositor(node) {
    const p = node.props || {};
    if (p.type === "array" || p.type === "collection") return { glyph: "\u21bb", cls: "repeat", title: "repeating items" };
    if (p.oneof) return { glyph: "\u25c8", cls: "choice", title: "one of" };
    if (p.anyof) return { glyph: "\u25c6", cls: "choice", title: "any of" };
    return { glyph: "\u2630", cls: "sequence", title: "sequence" };
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
    document.querySelectorAll(".vtab").forEach((b) => b.classList.toggle("active", b.dataset.view === view));

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

    const inner = el("div", { class: "diagram-inner" });
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
        const chip = el("div", { class: "dg-comp " + c.cls, title: c.title, text: c.glyph });
        chip.style.left = (node.__x + DG.BOX_W + DG.H_GAP / 2 - 11) + "px";
        chip.style.top = (node.__cy - 11) + "px";
        inner.appendChild(chip);
    }

    for (const { node } of placed) {
        inner.appendChild(node.__root ? rootBox(node) : diagramBox(node));
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
}

function rootBox(node) {
    const box = el("div", { class: "dg-root" });
    box.style.left = node.__x + "px";
    box.style.top = (node.__cy - DG.BOX_H / 2) + "px";
    box.style.width = DG.BOX_W + "px";
    box.style.height = DG.BOX_H + "px";
    box.append(el("span", { class: "dg-root-label", text: "[" + node.name + "]" }));
    const n = node.children.length;
    box.append(el("span", { class: "dg-root-sub", text: n + " " + (n === 1 ? "entry" : "entries") }));
    return box;
}

function diagramBox(node) {
    const p = node.props || {};
    const box = el("div", {
        class: "dg-box" + (state.selected === node ? " selected" : "") + (p.optional ? " optional" : ""),
        "data-cat": typeCategory(node),
    });
    box.style.left = node.__x + "px";
    box.style.top = (node.__cy - DG.BOX_H / 2) + "px";
    box.style.width = DG.BOX_W + "px";
    box.style.height = DG.BOX_H + "px";
    box.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        selectNode(node);
    });

    const top = el("div", { class: "dg-top" });
    top.append(el("span", { class: "dg-accent" }));
    top.append(el("span", { class: "dg-name", text: node.name }));
    top.append(el("span", { class: "dg-card", title: "cardinality", text: cardinality(node) }));
    box.append(top);

    const typeLine = el("div", { class: "dg-typeline" });
    typeLine.append(el("span", { class: "dg-type", "data-cat": typeCategory(node), text: typeBadge(node) }));
    if (p.typeof) {
        typeLine.append(el("button", {
            class: "dg-jump",
            title: "Jump to " + p.typeof,
            text: "\u2197",
            onclick: (e) => { e.stopPropagation(); jumpToType(p.typeof); },
        }));
    }
    box.append(typeLine);

    const kids = node.children || [];
    if (kids.length) {
        box.append(el("button", {
            class: "dg-expander",
            text: node.__collapsed ? "+" : "\u2013",
            title: node.__collapsed ? "Expand" : "Collapse",
            onclick: (e) => { e.stopPropagation(); node.__collapsed = !node.__collapsed; renderDiagram(); },
        }));
    }

    const acts = el("div", { class: "dg-actions" });
    acts.append(el("button", { class: "icon", title: "Add child field", text: "+", onclick: (e) => { e.stopPropagation(); addChild(node); } }));
    acts.append(el("button", { class: "icon", title: "Move up", text: "\u2191", onclick: (e) => { e.stopPropagation(); moveNode(node, -1); } }));
    acts.append(el("button", { class: "icon", title: "Move down", text: "\u2193", onclick: (e) => { e.stopPropagation(); moveNode(node, 1); } }));
    acts.append(el("button", { class: "icon danger", title: "Delete " + node.name, text: "\u2715", onclick: (e) => { e.stopPropagation(); deleteNode(node); } }));
    box.append(acts);

    return box;
}

function selectNode(node) {
    state.selected = node;
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
    if (!node.props.type && !node.props.typeof && !node.props.oneof && !node.props.anyof) {
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
    const header = el("div", { class: "field" });
    header.append(el("label", { text: "Name" }));
    const nameInput = el("input", {
        type: "text",
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

    // Type selector
    box.append(
        selectField("Type", p.type || "", ["", ...BUILTIN_TYPES], (v) => {
            if (v) p.type = v;
            else delete p.type;
            renderEditor();
            markDirty();
        }, "The built-in kind of this definition."),
    );

    const t = p.type;

    // typeof (reference) - relevant when no concrete type, or for collection items
    if (!t || t === "collection") {
        box.append(refField("typeof", "Type reference", p.typeof || "", (v) => setProp(p, "typeof", v)));
    }

    // Array-specific
    if (t === "array") {
        box.append(
            selectField("arraytype", p.arraytype || "", ["", ...ARRAY_TYPES], (v) => setProp(p, "arraytype", v),
                "Built-in type of each array item."),
        );
        box.append(refField("itemtype", "Item type (reference)", p.itemtype || "", (v) => setProp(p, "itemtype", v),
            "Validate each item against a reusable type (required for arrays of tables)."));
        box.append(listField("items", "Positional items (tuple)", p.items || [], (arr) => setListProp(p, "items", arr),
            true, "Ordered type refs; fixed arity. Mutually exclusive with arraytype/itemtype."));
    }

    // collection alternatives
    if (t === "collection" || p.oneof || p.anyof) {
        box.append(listField("oneof", "oneof (exactly one)", p.oneof || [], (arr) => setListProp(p, "oneof", arr), true));
        box.append(listField("anyof", "anyof (at least one)", p.anyof || [], (arr) => setListProp(p, "anyof", arr), true));
    }

    // string pattern + allowedvalues for simple types
    if (t === "string") {
        box.append(textField("pattern", "Pattern (regex)", p.pattern || "", (v) => setProp(p, "pattern", v), true,
            "PCRE-compatible regular expression."));
    }
    if (SIMPLE_TYPES.includes(t) || t === "array") {
        box.append(listField("allowedvalues", "Allowed values (enum)", p.allowedvalues || [],
            (arr) => setListProp(p, "allowedvalues", arr), false,
            "TOML value tokens, e.g. \"red\" or 80."));
    }

    // min / max for numeric/temporal (or arrays thereof)
    const showRange = NUMERIC_TEMPORAL.includes(t) || (t === "array" && NUMERIC_TEMPORAL.includes(p.arraytype));
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

    // optional + default (always available)
    box.append(checkboxField("optional", "Optional (may be omitted in the document)", !!p.optional, (v) => {
        if (v) p.optional = true;
        else delete p.optional;
        markDirty();
        renderTree();
    }));
    box.append(textField("default", "Default value (TOML token)", p.default || "", (v) => setProp(p, "default", v), true));

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
    const allProps = ["type", "typeof", "arraytype", "itemtype", "pattern", "min", "max", "default"];
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
    if (clean.length === 0) delete p[key];
    else p[key] = clean;
    markDirty();
    renderTree();
}

// --- Field builders -----------------------------------------------------
function textField(name, label, value, onchange, mono = false, hint) {
    const f = el("div", { class: "field" });
    f.append(labelEl(label, hint));
    f.append(el("input", {
        type: "text",
        class: mono ? "mono" : "",
        value,
        placeholder: name,
        oninput: (e) => onchange(e.target.value),
    }));
    return f;
}

function numField(name, label, value, onchange) {
    const f = el("div", { class: "field" });
    f.append(labelEl(label));
    f.append(el("input", {
        type: "number",
        value: value != null ? value : "",
        placeholder: name,
        oninput: (e) => onchange(e.target.value === "" ? "" : Number(e.target.value)),
    }));
    return f;
}

function selectField(label, value, options, onchange, hint) {
    const f = el("div", { class: "field" });
    f.append(labelEl(label, hint));
    const sel = el("select", { onchange: (e) => onchange(e.target.value) });
    for (const opt of options) {
        const o = el("option", { value: opt, text: opt === "" ? "(none)" : opt });
        if (opt === value) o.selected = true;
        sel.append(o);
    }
    f.append(sel);
    return f;
}

function checkboxField(name, label, checked, onchange) {
    const f = el("div", { class: "field inline" });
    const cb = el("input", { type: "checkbox", onchange: (e) => onchange(e.target.checked) });
    cb.checked = checked;
    f.append(cb);
    f.append(el("label", { text: label }));
    return f;
}

function refField(name, label, value, onchange, hint) {
    const f = el("div", { class: "field" });
    f.append(labelEl(label, hint));
    const input = el("input", {
        type: "text",
        class: "mono",
        value,
        placeholder: name,
        list: "type-refs",
        oninput: (e) => onchange(e.target.value),
    });
    f.append(input);
    return f;
}

function listField(name, label, values, onchange, isRef, hint) {
    const f = el("div", { class: "field" });
    f.append(labelEl(label, hint));
    const arr = [...values];
    const container = el("div");
    const rerender = () => {
        container.textContent = "";
        arr.forEach((val, idx) => {
            const row = el("div", { class: "list-row" });
            row.append(el("input", {
                type: "text",
                class: "mono",
                value: val,
                list: isRef ? "type-refs" : null,
                oninput: (e) => {
                    arr[idx] = e.target.value;
                    onchange([...arr]);
                },
            }));
            row.append(el("button", {
                class: "icon danger",
                text: "✕",
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
        class: "icon",
        text: "+ add",
        onclick: () => {
            arr.push("");
            onchange([...arr]);
            rerender();
        },
    }));
    return f;
}

function labelEl(text, hint) {
    const l = el("label", {}, text);
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
    const entries = Object.entries(meta).filter(([, v]) => typeof v !== "object" || v.__datetime || v.__inline || Array.isArray(v));
    const container = el("div");
    const arr = entries.map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
    const commit = () => {
        const obj = {};
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
            row.append(el("input", { type: "text", class: "mono", value: pair[0], placeholder: "key",
                oninput: (e) => { arr[idx][0] = e.target.value; commit(); } }));
            row.append(el("input", { type: "text", class: "mono", value: pair[1], placeholder: "value",
                oninput: (e) => { arr[idx][1] = e.target.value; commit(); } }));
            row.append(el("button", { class: "icon danger", text: "✕",
                onclick: () => { arr.splice(idx, 1); commit(); rerender(); } }));
            container.append(row);
        });
    };
    rerender();
    box.append(container);
    box.append(el("button", { class: "icon", text: "+ add metadata", onclick: () => { arr.push(["", ""]); rerender(); } }));
    box.append(el("div", { class: "field hint", text: "Values are stored as strings. Use the preview to confirm output." }));
}

// --- Issues -------------------------------------------------------------
function renderIssues() {
    const box = $("#issues");
    box.textContent = "";
    for (const issue of state.lastIssues) {
        const row = el("div", { class: "issue " + issue.level });
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
      <span class="title"><span class="brand-mark">◆</span> TOML Schema Editor</span>
      <span class="path" id="path"></span>
      <span class="pill" id="validity"></span>
      <span class="spacer"></span>
      <span class="status" id="status"></span>
      <button id="new" title="Start a new, empty schema">New</button>
      <button id="generate" title="Describe a config file and let Copilot generate the schema">&#10024; Generate</button>
      <button id="infer" title="Generate a schema from a sample TOML document">Infer from TOML</button>
      <button id="add-type">+ Type</button>
      <button id="add-element">+ Element</button>
      <button id="revert">Revert</button>
      <button id="save" class="primary">Save</button>
    </div>
    <div class="workspace">
      <div class="diagram-pane">
        <div class="diagram-bar">
          <div class="view-tabs">
            <button class="vtab active" data-view="elements">Elements</button>
            <button class="vtab" data-view="types">Types</button>
          </div>
          <button id="dg-add" class="icon" title="Add a top-level entry to this view">+ Add</button>
          <button id="dg-meta" class="icon" title="Edit [toml-schema] metadata">&#9881; Metadata</button>
          <span class="spacer"></span>
          <div class="zoom">
            <button id="zoom-out" class="icon" title="Zoom out">&#8722;</button>
            <span id="zoom-label" class="zoom-label">100%</span>
            <button id="zoom-in" class="icon" title="Zoom in">+</button>
            <button id="zoom-fit" class="icon" title="Fit to view">Fit</button>
          </div>
        </div>
        <div class="diagram-scroll" id="diagram"></div>
      </div>
      <div class="side">
        <div class="panel side-panel">
          <div class="panel-head"><h2>Properties</h2><span class="spacer"></span><button id="prop-close" class="icon" title="Close / deselect" hidden>&#10005;</button></div>
          <div class="editor" id="editor"></div>
        </div>
        <div class="panel side-panel preview-panel">
          <div class="panel-head"><h2>TOML Preview</h2><span class="spacer"></span></div>
          <div class="preview-wrap">
            <pre class="preview mono" id="preview"></pre>
            <div class="issues" id="issues"></div>
          </div>
        </div>
      </div>
    </div>
    <datalist id="type-refs"></datalist>`;

    $("#save").addEventListener("click", save);
    $("#revert").addEventListener("click", load);
    $("#new").addEventListener("click", newSchema);
    $("#generate").addEventListener("click", openGenerateModal);
    $("#infer").addEventListener("click", openInferModal);
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

    $("#diagram").addEventListener("click", (e) => {
        if (suppressDiagramClick) { suppressDiagramClick = false; return; }
        if (e.target.closest(".dg-box, .dg-root, .dg-comp, button")) return;
        if (state.selected) clearSelection();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && state.selected && !document.querySelector(".modal-overlay")) clearSelection();
    });
    setupPanning();

    load();
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
    renderEditor();
    renderDiagram();
}

// --- New (empty) schema -------------------------------------------------
function newSchema() {
    if (state.dirty && !confirm("Discard unsaved changes and start a new schema?")) return;
    state.model = { version: "1.0.0", meta: null, types: [], elements: [] };
    state.selected = "__meta__";
    markDirty();
    renderAll();
}

// --- Generate-with-Copilot modal ---------------------------------------
function openGenerateModal() {
    const existing = $("#generate-modal");
    if (existing) existing.remove();

    const overlay = el("div", { class: "modal-overlay", id: "generate-modal" });
    const dialog = el("div", { class: "modal" });
    dialog.append(el("h3", { text: "\u2728 Generate schema with Copilot" }));
    dialog.append(el("p", { class: "hint", text: "Describe the configuration file you want a schema for \u2014 its sections, fields, and any constraints. Copilot will draft the TOML Schema. The result replaces the current schema (not saved until you click Save)." }));

    const ta = el("textarea", {
        class: "modal-textarea",
        placeholder: "e.g. A web service config with a [server] section (host string, port integer 1-65535), a [database] table with url and pool_size, an optional [logging] section with level one of debug/info/warn/error, and a list of [[routes]] each having path and handler.",
    });
    dialog.append(ta);

    const errBox = el("div", { class: "modal-err" });
    dialog.append(errBox);

    const actions = el("div", { class: "modal-actions" });
    const cancelBtn = el("button", { text: "Cancel", onclick: () => overlay.remove() });
    const genBtn = el("button", { class: "primary", text: "Generate" });
    genBtn.addEventListener("click", async () => {
        const description = ta.value.trim();
        if (!description) { errBox.textContent = "Describe the configuration first."; return; }
        genBtn.disabled = true;
        cancelBtn.disabled = true;
        ta.disabled = true;
        errBox.className = "modal-err working";
        errBox.textContent = "Asking Copilot\u2026 this runs a Copilot turn and may take a moment.";
        try {
            const res = await fetch("generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description }),
            });
            const data = await res.json();
            if (data.error) {
                errBox.className = "modal-err";
                errBox.textContent = data.error;
                genBtn.disabled = false;
                cancelBtn.disabled = false;
                ta.disabled = false;
                return;
            }
            state.model = data.model;
            state.view = "elements";
            state.selected = (state.model.elements[0] || state.model.types[0]) ?? null;
            markDirty();
            renderAll();
            overlay.remove();
        } catch (e) {
            errBox.className = "modal-err";
            errBox.textContent = e.message;
            genBtn.disabled = false;
            cancelBtn.disabled = false;
            ta.disabled = false;
        }
    });
    actions.append(cancelBtn, genBtn);
    dialog.append(actions);

    overlay.append(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
    ta.focus();
}

// --- Infer-from-TOML modal ---------------------------------------------
function openInferModal() {
    const existing = $("#infer-modal");
    if (existing) existing.remove();

    const overlay = el("div", { class: "modal-overlay", id: "infer-modal" });
    const dialog = el("div", { class: "modal" });
    dialog.append(el("h3", { text: "Infer schema from a reference TOML document" }));
    dialog.append(el("p", { class: "hint", text: "Paste a sample TOML document, or load one from a file path. The generated schema replaces the current one (it is not saved until you click Save)." }));

    const pathRow = el("div", { class: "list-row" });
    const pathInput = el("input", { type: "text", class: "mono", placeholder: "path/to/sample.toml (absolute or workspace-relative)" });
    const loadBtn = el("button", { text: "Load file", onclick: async () => {
        const p = pathInput.value.trim();
        if (!p) return;
        errBox.textContent = "Loading…";
        try {
            const res = await fetch("readfile?path=" + encodeURIComponent(p));
            const data = await res.json();
            if (data.error) { errBox.textContent = data.error; return; }
            ta.value = data.content;
            errBox.textContent = "";
        } catch (e) { errBox.textContent = e.message; }
    } });
    pathRow.append(pathInput, loadBtn);
    dialog.append(pathRow);

    const ta = el("textarea", { class: "mono modal-textarea", placeholder: "# paste TOML here\ntitle = \"Example\"\n[owner]\nname = \"…\"" });
    dialog.append(ta);

    const errBox = el("div", { class: "modal-err" });
    dialog.append(errBox);

    const actions = el("div", { class: "modal-actions" });
    actions.append(el("button", { text: "Cancel", onclick: () => overlay.remove() }));
    actions.append(el("button", { class: "primary", text: "Infer schema", onclick: async () => {
        const toml = ta.value;
        if (!toml.trim()) { errBox.textContent = "Provide some TOML to infer from."; return; }
        errBox.textContent = "Inferring…";
        try {
            const res = await fetch("infer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toml }),
            });
            const data = await res.json();
            if (data.error) { errBox.textContent = data.error; return; }
            state.model = data.model;
            state.selected = (state.model.elements[0] || state.model.types[0]) ?? null;
            markDirty();
            renderAll();
            overlay.remove();
        } catch (e) { errBox.textContent = e.message; }
    } }));
    dialog.append(actions);

    overlay.append(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
    ta.focus();
}

boot();
