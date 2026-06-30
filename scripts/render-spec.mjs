#!/usr/bin/env node
// Render SPEC.md into a styled, on-site HTML page (docs/spec/index.html).
//
// SPEC.md remains the single source of truth: this script is run during the
// GitHub Pages build so the published page always matches the committed spec.
// Heading anchors are generated with GitHub's slugging rules so the
// spec's own Table of Contents links resolve correctly on the site.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import GithubSlugger from "github-slugger";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const specPath = join(repoRoot, "SPEC.md");
const outPath = join(repoRoot, "docs", "spec", "index.html");

const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const slugger = new GithubSlugger();

// Match GitHub's anchor IDs so the in-document TOC keeps working.
const renderer = new marked.Renderer();
renderer.heading = (text, level, raw) => {
  const id = slugger.slug(
    raw
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
  return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${level}>\n`;
};

marked.setOptions({
  renderer,
  gfm: true,
  headerIds: false,
  mangle: false,
});

const markdown = await readFile(specPath, "utf8");
const bodyHtml = marked.parse(markdown);

const titleMatch = markdown.match(/^#\s+(.+)$/m);
const pageTitle = titleMatch ? titleMatch[1].trim() : "Specification";

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="The TOML Schema specification: a TOML-native schema language for validating TOML configuration documents.">
  <link rel="canonical" href="https://toml-schema.org/spec/">
  <title>${escapeHtml(pageTitle)} — TOML Schema</title>
  <script>
    (() => {
      const param = new URLSearchParams(window.location.search).get("clawpilotTheme");
      const theme =
        param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", theme);
    })();
  </script>
  <link rel="stylesheet" href="../styles.css">
</head>
<body>
  <div class="page">
    <header>
      <a class="brand" href="/" aria-label="TOML Schema home">
        <svg class="brand-logo" viewBox="0 0 420 128" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">
          <polygon class="logo-bracket" points="0 0 34 0 34 14 18 14 18 114 34 114 34 128 0 128" />
          <polygon class="logo-t" points="42 26 104 26 104 42 80 42 80 110 66 110 66 42 42 42" />
          <polygon class="logo-bracket" points="112 0 146 0 146 128 112 128 112 114 128 114 128 14 112 14" />
          <text class="logo-schema" x="160" y="110">Schema</text>
        </svg>
        <span class="visually-hidden">TOML Schema</span>
      </a>
      <nav aria-label="Primary navigation">
        <a href="/#why">Why</a>
        <a href="/#tour">Tour</a>
        <a href="/spec/" aria-current="page">Spec</a>
        <a href="/#implementations">Implementations</a>
        <a href="https://github.com/brunoborges/toml-schema">GitHub</a>
      </nav>
    </header>

    <main>
      <article class="markdown">
${bodyHtml}
      </article>
    </main>

    <footer>
      <span>TOML Schema is licensed under MIT.</span>
      <span>
        <a href="/spec/">Spec</a>
        <span class="muted"> / </span>
        <a href="https://github.com/brunoborges/toml-schema/blob/main/REFERENCE_IMPLEMENTATIONS.md">Implementations</a>
        <span class="muted"> / </span>
        <a href="https://github.com/brunoborges/toml-schema/issues">Feedback</a>
      </span>
    </footer>
  </div>
</body>
</html>
`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, page, "utf8");
console.log(`Rendered ${specPath} -> ${outPath}`);
