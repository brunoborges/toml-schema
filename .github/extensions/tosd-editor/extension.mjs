// Extension: tosd-editor
// A rich visual editor for TOML Schema definition (.tosd) documents.
//
// Each open canvas instance boots a loopback HTTP server that serves a small
// single-page editor (client.js / styles.css) and exposes JSON endpoints:
//   GET  /state    -> { path, model }
//   POST /preview  -> { toml, issues }   (model in body; does not write to disk)
//   POST /save     -> { ok }             (model in body; writes the .tosd file)
//
// The editor model and TOML (de)serialization live in model.mjs / toml.mjs so
// this file stays focused on wiring: file IO, HTTP routing, and canvas actions.

import { createServer } from "node:http";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { parseDocument, serializeDocument, validateModel } from "./model.mjs";
import { inferModelFromToml } from "./infer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// instanceId -> { server, url, path, model }
const instances = new Map();

let workspacePath = process.cwd();

function blankModel() {
    return {
        version: "1.0.0",
        meta: null,
        types: [],
        elements: [{ name: "title", props: { type: "string" }, children: [] }],
    };
}

function resolvePath(inputPath) {
    if (!inputPath) return null;
    return isAbsolute(inputPath) ? inputPath : resolve(findBaseDir(), inputPath);
}

// The extension process may be launched with its cwd set to the session-state
// folder rather than the repo. Walk up to the nearest ancestor that looks like
// a project root (contains .git) so relative paths and default discovery
// resolve against the repo rather than the session folder.
function findBaseDir() {
    for (const start of [HERE, workspacePath, process.cwd()]) {
        let dir = start;
        for (let i = 0; i < 12 && dir; i++) {
            if (existsSync(join(dir, ".git"))) return dir;
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return workspacePath;
}

async function findDefaultTosd() {
    const base = findBaseDir();
    try {
        const entries = await readdir(base);
        const tosd = entries.find((e) => e.endsWith(".tosd"));
        if (tosd) return join(base, tosd);
    } catch {
        /* ignore */
    }
    return join(base, "untitled.tosd");
}

async function loadModelForPath(filePath) {
    if (filePath && existsSync(filePath)) {
        const text = await readFile(filePath, "utf8");
        return parseDocument(text);
    }
    return blankModel();
}

// --- Copilot generation -------------------------------------------------
// Build a focused instruction that asks the agent to emit a .tosd document.
function buildGeneratePrompt(desc) {
    return [
        "I'm using the TOML Schema visual editor and want to generate a TOML Schema definition (.tosd) document for the configuration file described below.",
        "",
        "Description:",
        desc.trim(),
        "",
        "Requirements:",
        "- Reply with ONLY the .tosd document inside a single ```toml code block — no commentary before or after.",
        '- Include a [toml-schema] table with version = "1.0.0".',
        "- Describe the document's top-level structure under [elements]; use nested tables like [elements.<name>.<child>] for sub-tables.",
        '- Put reusable definitions under [types.<name>] and reference them with type = "types.<name>". Use itemtype = "types.<name>" for array and collection members.',
        "- Keep `type`, `oneof`, and `anyof` as mutually exclusive selectors. Use `allof` only as an additive list of compatible type references.",
        "- Use only TOML Schema property keys: type (any, string, integer, float, boolean, offset-date-time, local-date-time, local-date, local-time, array, table, collection), optional, min, max, minlength, maxlength, pattern, format, keypattern, allowedvalues, itemtype, items, oneof, anyof, if, then, else, allof, uniqueitems, dependentrequired, mutuallyexclusive, exactlyone, default, deprecated, description.",
        '- For standardized strings, use format = "email", "uuid", "uri", "hostname", "ipv4", or "ipv6" when appropriate.',
        "- For a table shape selected by a direct child value, define reusable table or collection branches under [types], then use if = { key = \"...\", equals = ... } (or in = [ ... ]) together with named then and else references.",
        "- Mark fields that may be omitted with optional = true; everything is required by default.",
    ].join("\n");
}

function extractTosd(text) {
    if (!text) return null;
    const fence = /```(?:toml|tosd)?\s*\r?\n([\s\S]*?)```/i.exec(text);
    if (fence) return fence[1].trim();
    if (/\[toml-schema\]/.test(text) && /\[elements\]/.test(text)) return text.trim();
    return null;
}

async function generateFromDescription(description) {
    const desc = (description || "").trim();
    if (!desc) throw new Error("Describe the configuration first.");
    const ev = await session.sendAndWait({ prompt: buildGeneratePrompt(desc) }, 180000);
    const text = ev && ev.data ? (ev.data.content || "") : "";
    const tosd = extractTosd(text);
    if (!tosd) {
        const e = new Error("Copilot did not return a schema. Try rephrasing or adding detail.");
        e.raw = text.slice(0, 500);
        throw e;
    }
    const model = parseDocument(tosd);
    return { model, tosd };
}


function readBody(req) {
    return new Promise((resolveBody, reject) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolveBody(data));
        req.on("error", reject);
    });
}

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(body);
}

async function sendFile(res, name, contentType) {
    try {
        const content = await readFile(join(HERE, name), "utf8");
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
    } catch {
        res.writeHead(404);
        res.end("not found");
    }
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TOML Schema Editor</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <script src="client.js"></script>
  </body>
</html>`;

async function startServer(instanceId, entry) {
    const server = createServer(async (req, res) => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const expectedHost = `127.0.0.1:${port}`;
        if (req.headers.host !== expectedHost) {
            res.writeHead(403);
            res.end("forbidden");
            return;
        }
        if (req.method === "POST" && req.headers.origin !== `http://${expectedHost}`) {
            res.writeHead(403);
            res.end("forbidden");
            return;
        }
        const url = new URL(req.url, "http://127.0.0.1");
        const path = url.pathname;
        try {
            if (req.method === "GET" && (path === "/" || path === "/index.html")) {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(INDEX_HTML);
                return;
            }
            if (req.method === "GET" && path === "/client.js") return void (await sendFile(res, "client.js", "text/javascript; charset=utf-8"));
            if (req.method === "GET" && path === "/styles.css") return void (await sendFile(res, "styles.css", "text/css; charset=utf-8"));

            if (req.method === "GET" && path === "/state") {
                return sendJson(res, 200, { path: entry.path, model: entry.model });
            }

            if (req.method === "POST" && path === "/preview") {
                const body = JSON.parse(await readBody(req));
                const model = body.model || body;
                const previewPath = resolvePath(body.path);
                if (previewPath && entry.approvedPaths.has(previewPath)) entry.path = previewPath;
                entry.model = model;
                let toml = "";
                let error = null;
                try {
                    toml = serializeDocument(model);
                } catch (e) {
                    error = e.message;
                }
                const issues = validateModel(model);
                return sendJson(res, 200, { toml, issues, error });
            }

            if (req.method === "POST" && path === "/open") {
                const body = JSON.parse(await readBody(req));
                const target = resolvePath((body.path || "").trim());
                if (!target) return sendJson(res, 200, { error: "Enter a file path." });
                if (!existsSync(target)) return sendJson(res, 200, { error: "File not found: " + target });
                if (!target.endsWith(".tosd")) return sendJson(res, 200, { error: "Not a .tosd schema file: " + target });
                try {
                    const text = await readFile(target, "utf8");
                    const model = parseDocument(text);
                    entry.approvedPaths.add(target);
                    entry.path = target;
                    entry.model = model;
                    return sendJson(res, 200, { ok: true, path: target, model });
                } catch (e) {
                    return sendJson(res, 200, { error: "Failed to parse " + target + ": " + e.message });
                }
            }

            if (req.method === "GET" && path === "/readfile") {
                const target = resolvePath(url.searchParams.get("path"));
                if (!target || !existsSync(target)) return sendJson(res, 200, { error: "file not found" });
                try {
                    return sendJson(res, 200, { content: await readFile(target, "utf8"), path: target });
                } catch (e) {
                    return sendJson(res, 200, { error: e.message });
                }
            }

            if (req.method === "POST" && path === "/infer") {
                const body = JSON.parse(await readBody(req));
                try {
                    let tomlText = body.toml;
                    if (!tomlText && body.path) {
                        const target = resolvePath(body.path);
                        if (!target || !existsSync(target)) return sendJson(res, 200, { error: "file not found: " + body.path });
                        tomlText = await readFile(target, "utf8");
                    }
                    const model = inferModelFromToml(tomlText || "");
                    return sendJson(res, 200, { model, tosd: serializeDocument(model) });
                } catch (e) {
                    return sendJson(res, 200, { error: e.message });
                }
            }

            if (req.method === "POST" && path === "/generate") {
                const body = JSON.parse(await readBody(req));
                try {
                    const { model, tosd } = await generateFromDescription(body.description);
                    return sendJson(res, 200, { model, tosd });
                } catch (e) {
                    return sendJson(res, 200, { error: e.message, raw: e.raw });
                }
            }

            if (req.method === "POST" && path === "/save") {
                const body = JSON.parse(await readBody(req));
                const model = body.model || body;
                const requestedPath = resolvePath(body.path) || entry.path;
                entry.model = model;
                if (!requestedPath) return sendJson(res, 200, { ok: false, error: "no file path for this schema" });
                if (!requestedPath.endsWith(".tosd") || !entry.approvedPaths.has(requestedPath)) {
                    return sendJson(res, 403, { ok: false, error: "Saving is allowed only to a .tosd file opened by this editor." });
                }
                try {
                    const errors = validateModel(model).filter((issue) => issue.level === "error");
                    if (errors.length) {
                        return sendJson(res, 200, {
                            ok: false,
                            error: `Schema has ${errors.length} validation error${errors.length === 1 ? "" : "s"}. Resolve them before saving.`,
                        });
                    }
                    const toml = serializeDocument(model);
                    await writeFile(requestedPath, toml, "utf8");
                    entry.path = requestedPath;
                    return sendJson(res, 200, { ok: true, path: entry.path });
                } catch (e) {
                    return sendJson(res, 200, { ok: false, error: e.message });
                }
            }

            res.writeHead(404);
            res.end("not found");
        } catch (e) {
            sendJson(res, 500, { error: e.message });
        }
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    return entry;
}

// --- Canvas declaration -------------------------------------------------
const canvas = createCanvas({
    id: "tosd-editor",
    displayName: "TOML Schema Editor",
    description: "Visual editor for a TOML Schema definition (.tosd) document: edit types, elements, and constraints with a live TOML preview.",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Path to the .tosd file to edit (absolute, or relative to the workspace). If omitted, the first .tosd in the workspace root is used.",
            },
        },
        additionalProperties: false,
    },
    actions: [
        {
            name: "get_document",
            description: "Return the current edited schema as canonical TOML, the editor model, and any structural validation issues.",
            handler: async (ctx) => {
                const entry = instances.get(ctx.instanceId);
                if (!entry) throw new CanvasError("not_open", "Canvas instance is not open.");
                return {
                    path: entry.path,
                    toml: serializeDocument(entry.model),
                    model: entry.model,
                    issues: validateModel(entry.model),
                };
            },
        },
        {
            name: "reload_from_disk",
            description: "Discard in-memory edits and reload the schema from its file on disk.",
            handler: async (ctx) => {
                const entry = instances.get(ctx.instanceId);
                if (!entry) throw new CanvasError("not_open", "Canvas instance is not open.");
                entry.model = await loadModelForPath(entry.path);
                return { ok: true, path: entry.path };
            },
        },
        {
            name: "infer_from_toml",
            description: "Infer a TOML Schema from a sample/reference TOML document (by file path or inline content) and load it into the editor, replacing the current schema.",
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to a reference .toml file (absolute or workspace-relative)." },
                    toml: { type: "string", description: "Inline TOML content to infer from (used when path is omitted)." },
                },
                additionalProperties: false,
            },
            handler: async (ctx) => {
                const entry = instances.get(ctx.instanceId);
                if (!entry) throw new CanvasError("not_open", "Canvas instance is not open.");
                let tomlText = ctx.input && ctx.input.toml;
                if (!tomlText && ctx.input && ctx.input.path) {
                    const target = resolvePath(ctx.input.path);
                    if (!target || !existsSync(target)) throw new CanvasError("not_found", "Reference TOML not found: " + ctx.input.path);
                    tomlText = await readFile(target, "utf8");
                }
                if (!tomlText) throw new CanvasError("bad_input", "Provide either `path` or `toml`.");
                entry.model = inferModelFromToml(tomlText);
                return {
                    path: entry.path,
                    toml: serializeDocument(entry.model),
                    model: entry.model,
                    issues: validateModel(entry.model),
                };
            },
        },
        {
            name: "generate_from_description",
            description: "Generate a TOML Schema from a natural-language description of a configuration file (uses Copilot) and load it into the editor, replacing the current schema.",
            inputSchema: {
                type: "object",
                properties: {
                    description: { type: "string", description: "Natural-language description of the configuration file and its fields." },
                },
                required: ["description"],
                additionalProperties: false,
            },
            handler: async (ctx) => {
                const entry = instances.get(ctx.instanceId);
                if (!entry) throw new CanvasError("not_open", "Canvas instance is not open.");
                const desc = ctx.input && ctx.input.description;
                if (!desc) throw new CanvasError("bad_input", "Provide a `description`.");
                let result;
                try {
                    result = await generateFromDescription(desc);
                } catch (e) {
                    throw new CanvasError("generate_failed", e.message);
                }
                entry.model = result.model;
                return {
                    path: entry.path,
                    toml: serializeDocument(entry.model),
                    model: entry.model,
                    issues: validateModel(entry.model),
                };
            },
        },
    ],
    open: async (ctx) => {
        let entry = instances.get(ctx.instanceId);
        if (!entry) {
            const inputPath = ctx.input && ctx.input.path;
            const filePath = resolvePath(inputPath) || (await findDefaultTosd());
            const model = await loadModelForPath(filePath);
            entry = { server: null, url: null, path: filePath, model, approvedPaths: new Set([filePath]) };
            instances.set(ctx.instanceId, entry);
            await startServer(ctx.instanceId, entry);
            session.log(`tosd-editor: editing ${filePath}`, { level: "info", ephemeral: true });
        }
        return {
            title: `TOML Schema: ${entry.path ? entry.path.split("/").pop() : "untitled"}`,
            status: entry.path && existsSync(entry.path) ? "loaded" : "new",
            url: entry.url,
        };
    },
    onClose: async (ctx) => {
        const entry = instances.get(ctx.instanceId);
        if (entry) {
            instances.delete(ctx.instanceId);
            if (entry.server) await new Promise((r) => entry.server.close(() => r()));
        }
    },
});

const session = await joinSession({ canvases: [canvas] });
if (typeof session.workspacePath === "string" && session.workspacePath) {
    workspacePath = session.workspacePath;
}
