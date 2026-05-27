# TOML Schema Examples

This folder contains example TOML Schema Definition (`.tosd`) files that
demonstrate how to describe the structure of real-world TOML configuration
files using [TOML Schema](../SPEC.md).

Each example is modeled after the documented configuration format of a
popular tool or project, and is intended as a learning resource and a
reference for writing your own schemas. The examples are not affiliated
with or endorsed by the upstream projects.

## Available examples

| File | Describes | Based on |
| --- | --- | --- |
| [`gitlab-runner.tosd`](gitlab-runner.tosd) | GitLab Runner advanced configuration | <https://docs.gitlab.com/runner/configuration/advanced-configuration/> |
| [`hugo.tosd`](hugo.tosd) | Hugo static site generator configuration | <https://gohugo.io/configuration/> |
| [`netlify.tosd`](netlify.tosd) | Netlify file-based build configuration (`netlify.toml`) | <https://docs.netlify.com/build/configure-builds/file-based-configuration/> |
| [`pyproject.tosd`](pyproject.tosd) | Python `pyproject.toml` (PEP 621 + dependency groups) | <https://packaging.python.org/en/latest/specifications/pyproject-toml/> |
| [`wrangler.tosd`](wrangler.tosd) | Cloudflare Workers `wrangler.toml` | <https://developers.cloudflare.com/workers/wrangler/configuration/> |

## Using the examples

You can validate a TOML file against any of these schemas using one of the
[reference implementations](../REFERENCE_IMPLEMENTATIONS.md). For example,
with the Java CLI from the repository root:

```bash
mvn -f reference-implementations/java/pom.xml package
java -jar reference-implementations/java/target/toml-schema-0.1.0-SNAPSHOT.jar \
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
