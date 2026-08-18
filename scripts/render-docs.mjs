#!/usr/bin/env node
// Render the long-form Markdown documentation into styled on-site pages.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import GithubSlugger from "github-slugger";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const repositoryUrl = "https://github.com/brunoborges/toml-schema";
const repositoryDirectories = new Set([
  "reference-implementations/java",
  "reference-implementations/go",
  "reference-implementations/rust",
]);
const pages = [
  {
    source: "SPEC.md",
    output: join("spec", "index.html"),
    description:
      "The TOML Schema specification: a TOML-native schema language for validating TOML configuration documents.",
    canonical: "https://toml-schema.org/spec/",
    activeNav: "spec",
  },
  {
    source: "REFERENCE_IMPLEMENTATIONS.md",
    output: join("implementations", "index.html"),
    description:
      "Build and use the Java, Go, and Rust TOML Schema reference implementations as libraries and command-line tools.",
    canonical: "https://toml-schema.org/implementations/",
    activeNav: "implementations",
  },
];

const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderMarkdown = (markdown) => {
  const slugger = new GithubSlugger();
  const renderer = new marked.Renderer();

  // Match GitHub's anchor IDs so in-document links keep working.
  renderer.heading = (text, level, raw) => {
    const id = slugger.slug(
      raw
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .trim(),
    );
    return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${level}>\n`;
  };

  // Route site documentation locally and repository artifacts to GitHub.
  renderer.link = (href, title, text) => {
    let resolvedHref = href;
    if (href.startsWith("SPEC.md")) {
      resolvedHref = href.replace("SPEC.md", "/spec/");
    } else if (href.startsWith("REFERENCE_IMPLEMENTATIONS.md")) {
      resolvedHref = href.replace(
        "REFERENCE_IMPLEMENTATIONS.md",
        "/implementations/",
      );
    } else if (href === "README.md") {
      resolvedHref = "/";
    } else if (!/^(?:[a-z]+:|\/|#)/i.test(href)) {
      const view = repositoryDirectories.has(href) ? "tree" : "blob";
      resolvedHref = `${repositoryUrl}/${view}/main/${href}`;
    }

    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(resolvedHref)}"${titleAttribute}>${text}</a>`;
  };

  return marked.parse(markdown, {
    renderer,
    gfm: true,
    headerIds: false,
    mangle: false,
  });
};

for (const pageConfig of pages) {
  const sourcePath = join(repoRoot, pageConfig.source);
  const outPath = join(repoRoot, "docs", pageConfig.output);
  const markdown = await readFile(sourcePath, "utf8");
  const bodyHtml = renderMarkdown(markdown);
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const pageTitle = titleMatch ? titleMatch[1].trim() : "TOML Schema";
  const navCurrent = (name) =>
    pageConfig.activeNav === name ? ' aria-current="page"' : "";

  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(pageConfig.description)}">
  <link rel="canonical" href="${pageConfig.canonical}">
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
        <a href="/validation-report/">Evidence</a>
        <a href="/#tour">Tour</a>
        <a href="/spec/"${navCurrent("spec")}>Spec</a>
        <a href="/implementations/"${navCurrent("implementations")}>Implementations</a>
        <a href="${repositoryUrl}">GitHub</a>
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
        <a href="/implementations/">Implementations</a>
        <span class="muted"> / </span>
        <a href="${repositoryUrl}/issues">Feedback</a>
      </span>
    </footer>
  </div>
</body>
</html>
`;

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, page, "utf8");
  console.log(`Rendered ${sourcePath} -> ${outPath}`);
}
