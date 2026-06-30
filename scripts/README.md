# Site build scripts

Tooling for the [toml-schema.org](https://toml-schema.org) static site published from `docs/`.

## `render-spec.mjs`

Renders the repository's `SPEC.md` into a styled, on-site page at `docs/spec/index.html`,
wrapped in the site's header, footer, and theme. `SPEC.md` stays the single source of
truth — the page is generated during the GitHub Pages build (`.github/workflows/pages.yml`),
not committed (`docs/spec/` is git-ignored).

Heading anchors are generated with GitHub's slug rules (`github-slugger`) so the
spec's in-document Table of Contents links resolve on the site.

### Build locally

```sh
cd scripts
npm ci
npm run render-spec
```

Then open `docs/spec/index.html` (e.g. `python3 -m http.server` from `docs/`).
