import { DiagnosticCodes } from "./diagnostics.js";
import { SchemaError } from "./errors.js";

// SemVer 2.0.0 MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD], per semver.org's reference regex.
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export interface SemVerParts {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
}

/** Parses a SemVer string, returning its major/minor/patch components. */
export function parseSemVer(value: string): SemVerParts | undefined {
  const match = SEMVER_PATTERN.exec(value);
  if (!match) return undefined;
  return { major: match[1] as string, minor: match[2] as string, patch: match[3] as string };
}

/** Validates that `value` is a well-formed `1.0.x` TOML Schema language version string. */
export function validateSchemaVersion(value: unknown): asserts value is string {
  const options = {
    code: DiagnosticCodes.UNSUPPORTED_VERSION,
    schemaPath: "$.toml-schema.version",
  };
  if (typeof value !== "string") {
    throw new SchemaError("[toml-schema].version must be a SemVer string", options);
  }
  const parts = parseSemVer(value);
  if (!parts) {
    throw new SchemaError("[toml-schema].version must use SemVer MAJOR.MINOR.PATCH syntax", options);
  }
  if (parts.major !== "1") {
    throw new SchemaError(`unsupported TOML Schema major version: ${value}`, options);
  }
  if (parts.minor !== "0") {
    throw new SchemaError(`unsupported TOML Schema minor version: ${value}`, options);
  }
}
