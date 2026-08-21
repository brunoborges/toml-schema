import { DiagnosticCodes, type DiagnosticCode, type DiagnosticPhase } from "./diagnostics.js";

/** Optional structured metadata attached to a {@link SchemaError}. */
export interface SchemaErrorOptions {
  readonly phase?: DiagnosticPhase;
  readonly code?: string;
  readonly schemaPath?: string;
}

/**
 * Thrown for structural/semantic problems detected while discovering or loading
 * a schema. The error carries a structured diagnostic (phase, registry code, and
 * optional schema path) so callers can report a normative diagnostic instead of
 * parsing free-form message text. When no more specific code is supplied it
 * defaults to the schema-load `schema-malformed` catch-all, which SPEC.md
 * designates for any schema-load failure with no more specific code.
 */
export class SchemaError extends Error {
  readonly phase: DiagnosticPhase;
  readonly code: string;
  readonly schemaPath: string | undefined;

  constructor(message: string, options: SchemaErrorOptions = {}) {
    super(message);
    this.name = "SchemaError";
    this.phase = options.phase ?? "schema-load";
    this.code = options.code ?? DiagnosticCodes.SCHEMA_MALFORMED;
    this.schemaPath = options.schemaPath;
  }
}

/** Thrown when a document or schema file cannot be located or parsed. */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

/**
 * Thrown when a TOML document submitted for validation is not well-formed TOML.
 *
 * Such a document never reaches the validator, so its failure is deliberately
 * *not* a validation diagnostic. SPEC.md requires that a parse failure "is a
 * parse error rather than a validation diagnostic", that it is not reported under
 * a registry or extension code, and that the document is not reported as invalid.
 * A command-line validator reports it as an unusable invocation and exits `2`.
 */
export class DocumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentParseError";
  }
}

export { DiagnosticCodes };
export type { DiagnosticCode, DiagnosticPhase };
