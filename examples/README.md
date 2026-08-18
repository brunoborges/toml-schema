# TOML Schema Examples

This folder contains example TOML Schema Definition (`.tosd`) files that
demonstrate how to describe the structure of real-world TOML configuration
files using [TOML Schema](../SPEC.md).

Each example is modeled after the documented configuration format of a
popular tool or project, and is intended as a learning resource and a
reference for writing your own schemas. The examples are not affiliated
with or endorsed by the upstream projects.

These schemas are representative snapshots rather than canonical schemas
published by the upstream projects. When an upstream rule depends on another
field's presence or value, the example accepts the structurally valid superset
and leaves that policy to application-level validation. See
[Expressiveness and Validation Scope](../SPEC.md#expressiveness-and-validation-scope).
The upstream sources in the table below were reviewed on 2026-08-18.

## Available examples

| File | Describes | Based on |
| --- | --- | --- |
| [`cargo.tosd`](cargo.tosd) | Rust Cargo manifests (`Cargo.toml`) | <https://doc.rust-lang.org/cargo/reference/manifest.html> |
| [`gitlab-runner.tosd`](gitlab-runner.tosd) | GitLab Runner advanced configuration | <https://docs.gitlab.com/runner/configuration/advanced-configuration/> |
| [`hugo.tosd`](hugo.tosd) | Hugo static site generator configuration | <https://gohugo.io/configuration/> |
| [`netlify.tosd`](netlify.tosd) | Netlify file-based build configuration (`netlify.toml`) | <https://docs.netlify.com/build/configure-builds/file-based-configuration/> |
| [`pyproject.tosd`](pyproject.tosd) | Python `pyproject.toml` (PEP 621 + dependency groups) | <https://packaging.python.org/en/latest/specifications/pyproject-toml/> |
| [`wrangler.tosd`](wrangler.tosd) | Cloudflare Workers `wrangler.toml` | <https://developers.cloudflare.com/workers/wrangler/configuration/> |

Together these examples exercise dynamic-key maps, arrays of tables, open
extension namespaces, constrained scalar values, map values, fixed and dynamic
children in one collection, and alternative representations such as scalar
versus table or one table versus an array of tables. They also expose the
intentional version 1.0 boundary: cross-field requirements, merge and
inheritance behavior, sibling mutual exclusion, array uniqueness, and
deprecation metadata require application-level handling.

## Industry format coverage

The version 1.0 vocabulary is sufficient to describe the parsed structure of
the major formats reviewed:

| Format | Structural coverage | Remaining application-level rules |
| --- | --- | --- |
| [Cargo](https://doc.rust-lang.org/cargo/reference/manifest.html) | Dependencies, target-specific maps, workspace inheritance, profiles, arrays of targets | Relationships among dependency source fields, unstable-feature gates |
| [`pyproject.toml`](https://packaging.python.org/en/latest/specifications/pyproject-toml/) | Project metadata, build systems, dependency groups, open `[tool]` namespaces | Static-versus-dynamic metadata rules, mutually exclusive table fields |
| [uv](https://docs.astral.sh/uv/reference/settings/) and [Ruff](https://docs.astral.sh/ruff/settings/) | Fixed settings, enums, unions, nested tables, typed maps | Merge behavior, sibling dependencies, defaults and deprecations |
| [Taplo](https://github.com/tamasfe/taplo/blob/master/crates/taplo-common/src/config.rs) | Closed option tables, arrays of rules, plugin maps | URL/path precedence and embedded glob semantics |
| [Starship](https://starship.rs/config/) | Fixed modules, custom-module maps, nested palette maps | Reusable base-module extension, defaults, embedded format-string syntax |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/) | Routes, bindings, module rules, environment maps | Inheritance and override semantics, embedded cron syntax |

A collection may combine fixed children with a general `itemtype`, so an open
namespace can still give well-known keys specialized schemas. For example,
`[tool.ruff]` and `[tool.uv]` can be fixed children of a `[tool]` collection
while unknown tool names remain open. The generic `pyproject.tosd` example
intentionally leaves every `[tool.*]` entry open because it does not bundle
third-party tool schemas.

Across these formats, the main practical limitation is semantic rather than
structural: version 1.0 does not express relationships between sibling or
cross-path values. Defaults, examples, and deprecation notices are also not
machine-readable annotations. These boundaries are detailed in
[Expressiveness and Validation Scope](../SPEC.md#expressiveness-and-validation-scope).

## Using the examples

You can validate a TOML file against any of these schemas using one of the
[reference implementations](../REFERENCE_IMPLEMENTATIONS.md). For example,
with the Java CLI from the repository root:

```bash
mvn -f reference-implementations/java/pom.xml package
java -jar reference-implementations/java/target/toml-schema-1.0.0-rc.2.jar \
    validate examples/pyproject.tosd path/to/your/pyproject.toml
```

See the top-level [`README.md`](../README.md) and [`SPEC.md`](../SPEC.md)
for the full TOML Schema language reference.

## Contributing examples

Contributions of additional examples are welcome. When adding a new
example:

- Place the file in this folder using a short, lowercase name that matches
  the tool or format it describes (for example, `cargo.tosd`).
- Add a comment at the top of the file linking to the upstream
  configuration documentation it is based on.
- Add a row to the table above describing the new example.
- Prefer reusing named definitions under `[types.*]` for repeated
  structures, as the existing examples do.
