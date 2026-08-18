# Site build scripts

Tooling for the [toml-schema.org](https://toml-schema.org) static site published from `docs/`.

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
