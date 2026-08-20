#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const outputRoot = join(repoRoot, "docs", "cli", "releases");
const repository = process.env.GITHUB_REPOSITORY || "brunoborges/toml-schema";
const apiBaseUrl = process.env.GITHUB_API_URL || "https://api.github.com";
const token = process.env.GITHUB_TOKEN;
const releaseTagPattern =
  /^rust-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z](?:[0-9A-Za-z.-]*[0-9A-Za-z])?)?)$/;
const platforms = [
  ["Linux x86_64", "linux-x86_64"],
  ["Linux arm64", "linux-arm64"],
  ["macOS arm64", "macos-arm64"],
  ["Windows x86_64", "windows-x86_64"],
];

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const githubHeaders = (accept) => ({
  Accept: accept,
  "User-Agent": "toml-schema-pages-build",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: githubHeaders("application/vnd.github+json"),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed (${response.status}): ${await response.text()}`,
    );
  }
  return response.json();
};

const downloadAsset = async (asset, destination) => {
  const response = await fetch(asset.url, {
    headers: githubHeaders("application/octet-stream"),
  });
  if (!response.ok) {
    throw new Error(
      `Unable to download ${asset.name} (${response.status}): ${await response.text()}`,
    );
  }

  const contents = Buffer.from(await response.arrayBuffer());
  if (contents.length !== asset.size) {
    throw new Error(
      `Downloaded size for ${asset.name} was ${contents.length}, expected ${asset.size}`,
    );
  }
  await writeFile(destination, contents);
};

const releases = await fetchJson(
  `${apiBaseUrl}/repos/${repository}/releases?per_page=100`,
);
const cliReleases = releases
  .filter((release) => !release.draft && releaseTagPattern.test(release.tag_name))
  .map((release) => {
    const [, version] = release.tag_name.match(releaseTagPattern);
    const expectedAssets = new Set([
      "install-tosd.sh",
      `tosd-${version}-SHA256SUMS.txt`,
      ...platforms.map(
        ([, platform]) => `tosd-${version}-${platform}.tar.gz`,
      ),
    ]);
    const assets = release.assets.filter((asset) =>
      expectedAssets.has(asset.name),
    );
    const missingAssets = [...expectedAssets].filter(
      (name) => !assets.some((asset) => asset.name === name),
    );
    if (missingAssets.length > 0) {
      throw new Error(
        `${release.tag_name} is missing required CLI assets: ${missingAssets.join(", ")}`,
      );
    }
    return { release, version, assets };
  })
  .sort(
    (left, right) =>
      new Date(right.release.published_at) -
      new Date(left.release.published_at),
  );

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const { release, assets } of cliReleases) {
  const releaseDirectory = join(outputRoot, release.tag_name);
  await mkdir(releaseDirectory, { recursive: true });
  await Promise.all(
    assets.map((asset) =>
      downloadAsset(asset, join(releaseDirectory, asset.name)),
    ),
  );
}

const releaseSections = cliReleases
  .map(({ release, version }, index) => {
    const tag = escapeHtml(release.tag_name);
    const published = new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(release.published_at));
    const rows = platforms
      .map(([label, platform]) => {
        const asset = `tosd-${version}-${platform}.tar.gz`;
        return `          <tr><td>${escapeHtml(label)}</td><td><a href="./${tag}/${escapeHtml(asset)}"><code>${escapeHtml(asset)}</code></a></td></tr>`;
      })
      .join("\n");
    const latestBadge = index === 0 ? '<span class="badge">Latest</span>' : "";
    const prereleaseBadge = release.prerelease
      ? '<span class="badge">Prerelease</span>'
      : "";

    return `      <section class="section release" id="${tag}">
        <div class="release-heading">
          <div>
            <span class="eyebrow">tosd CLI</span>
            <h2>${escapeHtml(version)}</h2>
          </div>
          <div class="release-badges">${latestBadge}${prereleaseBadge}</div>
        </div>
        <p class="muted">Published ${escapeHtml(published)} · <a href="https://github.com/${escapeHtml(repository)}/releases/tag/${tag}">Release notes</a></p>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Platform</th><th>Download</th></tr></thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
        <p>
          <a href="./${tag}/tosd-${escapeHtml(version)}-SHA256SUMS.txt">SHA-256 checksums</a>
          <span class="muted"> · </span>
          <a href="./${tag}/install-tosd.sh">Installer script</a>
        </p>
      </section>`;
  })
  .join("\n\n");

const latest = cliReleases[0];
const heroContent = latest
  ? `<div class="panel install-panel">
          <div class="panel-header">
            <strong>Install ${escapeHtml(latest.version)}</strong>
            <span class="badge">${latest.release.prerelease ? "Prerelease" : "Latest"}</span>
          </div>
          <pre><code>curl -fsSL https://tomlschema.org/cli/releases/${escapeHtml(latest.release.tag_name)}/install-tosd.sh | bash</code></pre>
        </div>`
  : `<div class="card install-panel">
          <h2>Downloads are coming soon</h2>
          <p>The release index will populate automatically when the first <code>rust-v*</code> CLI release is published.</p>
        </div>`;
const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="description" content="Download versioned tosd CLI binaries for Linux, macOS, and Windows.">
  <link rel="canonical" href="https://tomlschema.org/cli/releases/">
  <title>tosd CLI releases — TOML Schema</title>
  <script>
    (() => {
      const param = new URLSearchParams(window.location.search).get("clawpilotTheme");
      const theme =
        param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", theme);
    })();
  </script>
  <link rel="stylesheet" href="../../styles.css">
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
        <a href="/spec/">Spec</a>
        <a href="/implementations/">Implementations</a>
        <a href="/cli/releases/" aria-current="page">CLI</a>
        <a class="nav-github" href="https://github.com/${escapeHtml(repository)}" aria-label="GitHub repository">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
          </svg>
          <span class="visually-hidden">GitHub</span>
        </a>
      </nav>
    </header>

    <main>
      <section class="report-hero">
        <span class="eyebrow">Downloads</span>
        <h1>tosd CLI releases</h1>
        <p class="lead">Versioned, checksum-protected binaries for Linux, Apple Silicon macOS, and Windows.</p>
        ${heroContent}
      </section>

${releaseSections}
    </main>

    <footer>
      <span>TOML Schema is licensed under MIT.</span>
      <span>
        <a href="/">Home</a>
        <span class="muted"> / </span>
        <a href="/implementations/">Implementations</a>
        <span class="muted"> / </span>
        <a href="https://github.com/${escapeHtml(repository)}/issues">Feedback</a>
      </span>
    </footer>
  </div>
</body>
</html>
`;

await writeFile(join(outputRoot, "index.html"), page, "utf8");
console.log(
  `Rendered CLI release index with ${cliReleases.length} mirrored release(s) to ${outputRoot}`,
);
