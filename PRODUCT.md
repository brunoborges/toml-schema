# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

TOML developers and project maintainers who need to define and maintain schemas for configuration files.

## Product Purpose

TOML Schema provides a TOML-native schema language and reference implementations for validating TOML configuration documents. Success means developers can describe, understand, and validate TOML structures without switching to a foreign schema syntax.

## Positioning

TOML Schema keeps schemas in TOML itself. Its GitHub Copilot App canvas editor turns `.tosd` documents into a visual, structured editing experience while preserving a live TOML representation.

## Operating Context

Developers work in the GitHub Copilot App with this repository open, edit `.tosd` schema files, inspect their generated TOML, and use the repository's Java, Go, or Rust reference implementations to validate TOML documents.

## Capabilities and Constraints

- Schema documents use the `.tosd` extension and TOML Schema language version `1.0.0`.
- The canvas editor opens existing `.tosd` files or starts a new schema.
- The editor supports visual schema navigation, reusable types, constraints, live TOML preview, model validation, save, undo/redo, and Copilot-assisted generation from a description.
- Public access currently requires opening this repository in the GitHub Copilot App and asking Copilot to open a `.tosd` file.

## Brand Commitments

Use the names "TOML Schema" and "TOML Schema Editor." Describe the product directly and technically without fabricated adoption, customer, or performance claims.

## Evidence on Hand

- The working canvas extension lives in `.github/extensions/tosd-editor/`.
- Checked-in `.tosd` examples and the TOML Schema self-schema provide real demonstration content.
- Java, Go, and Rust reference implementations and the real-world validation report provide implementation evidence.
- No testimonials, customer logos, or benchmark claims are available and none should be invented.

## Product Principles

- Keep TOML readable and central.
- Demonstrate real behavior with real project artifacts.
- Make advanced schema capabilities approachable without hiding the underlying document.
- Keep generated output inspectable and editable.

## Accessibility & Inclusion

The website and editor should remain keyboard accessible, responsive, readable in light and dark color schemes, and respectful of reduced-motion preferences.
