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
  "reference-implementations/dotnet",
  "reference-implementations/python",
  "reference-implementations/rust",
  "reference-implementations/typescript",
]);
const pages = [
  {
    source: "SPEC.md",
    output: join("spec", "index.html"),
    description:
      "The TOML Schema specification: a TOML-native schema language for validating TOML configuration documents.",
    canonical: "https://tomlschema.org/spec/",
    activeNav: "spec",
  },
  {
    source: "REFERENCE_IMPLEMENTATIONS.md",
    output: join("implementations", "index.html"),
    description:
      "Build and use the Java, Go, .NET, Python, Rust, and Node.js/TypeScript TOML Schema reference libraries and the canonical Rust command-line interface.",
    canonical: "https://tomlschema.org/implementations/",
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
        <a href="/editor/">Editor</a>
        <a href="/validation-report/">Evidence</a>
        <a href="/spec/"${navCurrent("spec")}>Spec</a>
        <a href="/implementations/"${navCurrent("implementations")}>Implementations</a>
        <a href="/cli/releases/">CLI</a>
        <a class="nav-github" href="${repositoryUrl}" aria-label="GitHub repository">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
          </svg>
          <span class="visually-hidden">GitHub</span>
        </a>
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
        <a href="/">Home</a>
        <span class="muted"> / </span>
        <a href="/spec/">Spec</a>
        <span class="muted"> / </span>
        <a href="/implementations/">Implementations</a>
        <span class="muted"> / </span>
        <a href="/cli/releases/">CLI releases</a>
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
