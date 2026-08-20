# Site build scripts

Tooling for the canonical [tomlschema.org](https://tomlschema.org/) static site
published from `docs/`. The
[`brunoborges/tomlschema.org`](https://github.com/brunoborges/tomlschema.org)
repository also rebuilds this repository's `main` branch daily and mirrors the
site at the legacy [toml-schema.org](https://toml-schema.org/) domain.

## `render-docs.mjs`

Renders the repository's long-form Markdown documentation into styled, on-site pages
wrapped in the site's header, footer, and theme:

- `SPEC.md` to `docs/spec/index.html`
- `REFERENCE_IMPLEMENTATIONS.md` to `docs/implementations/index.html`

The Markdown files stay the single sources of truth. Pages are generated during the
GitHub Pages build (`.github/workflows/pages.yml`) and are not committed. Heading
anchors use GitHub's slug rules (`github-slugger`) so in-document links resolve on
the site.

### Build locally

```sh
cd scripts
npm ci
npm run render-docs
```

Then serve `docs/` locally and open `/spec/` or `/implementations/`.
