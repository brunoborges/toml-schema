import { TomlDate } from "smol-toml";
import type { SchemaType } from "./builtins.js";

/**
 * The parsed TOML value model used throughout this library. Integers are
 * `bigint` (via smol-toml's `integersAsBigInt` option) so they remain
 * distinct from floats (`number`), matching the reference Go implementation's
 * `int64`/`float64` split. Temporal values are `TomlDate` instances,
 * distinguished by its `isDateTime()`/`isDate()`/`isTime()`/`isLocal()`
 * predicates.
 */
export type TomlScalar = string | bigint | number | boolean | TomlDate;
export type TomlTable = { [key: string]: TomlValue };
export type TomlValue = TomlScalar | TomlValue[] | TomlTable;

export function isTomlTable(value: unknown): value is TomlTable {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof TomlDate)
  );
}

export function isTomlArray(value: unknown): value is TomlValue[] {
  return Array.isArray(value);
}

export function isNumeric(value: unknown): value is bigint | number {
  return typeof value === "bigint" || typeof value === "number";
}

export function isNaNValue(value: unknown): boolean {
  return typeof value === "number" && Number.isNaN(value);
}

/** Reports whether `value` matches the parsed-TOML kind selected by `typeName`. */
export function isType(value: TomlValue | undefined, typeName: SchemaType): boolean {
  switch (typeName) {
    case "any":
      return value !== undefined;
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "bigint";
    case "float":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "offset-date-time":
      return value instanceof TomlDate && value.isDateTime() && !value.isLocal();
    case "local-date-time":
      return value instanceof TomlDate && value.isDateTime() && value.isLocal();
    case "local-date":
      return value instanceof TomlDate && value.isDate();
    case "local-time":
      return value instanceof TomlDate && value.isTime();
    case "array":
      return isTomlArray(value);
    case "table":
    case "collection":
      return isTomlTable(value);
    default:
      return false;
  }
}

export function typeNameOf(value: TomlValue | undefined): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return "string";
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") return "float";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof TomlDate) {
    if (value.isDateTime()) return value.isLocal() ? "local-date-time" : "offset-date-time";
    if (value.isDate()) return "local-date";
    if (value.isTime()) return "local-time";
    return "date-time";
  }
  if (Array.isArray(value)) return "array";
  return "table";
}

/* -------------------------------------------------------------------------- */
/* Exact bigint/float numeric comparison                                      */
/* -------------------------------------------------------------------------- */

/** Decomposes a finite JS double into an exact `num / den` rational (den a power of two). */
function floatToRational(value: number): { num: bigint; den: bigint } {
  if (value === 0) return { num: 0n, den: 1n };
  const buffer = new ArrayBuffer(8);
  new Float64Array(buffer)[0] = value;
  const bits = new BigUint64Array(buffer)[0]!;
  const sign = (bits >> 63n) & 1n;
  const rawExponent = Number((bits >> 52n) & 0x7ffn);
  const rawMantissa = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let exponent: number;
  if (rawExponent === 0) {
    // Subnormal: value = mantissa * 2^-1074.
    mantissa = rawMantissa;
    exponent = -1074;
  } else {
    // Normal: value = (2^52 + mantissa) * 2^(exponent-1075).
    mantissa = rawMantissa | (1n << 52n);
    exponent = rawExponent - 1075;
  }
  if (sign === 1n) mantissa = -mantissa;
  if (exponent >= 0) {
    return { num: mantissa << BigInt(exponent), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-exponent) };
}

function toRational(value: bigint | number): { num: bigint; den: bigint } {
  return typeof value === "bigint" ? { num: value, den: 1n } : floatToRational(value);
}

function signOf(value: bigint): -1 | 0 | 1 {
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}

/** Exact comparison between a bigint integer and/or a finite JS float, without rounding. */
function compareExact(left: bigint | number, right: bigint | number): -1 | 0 | 1 {
  const a = toRational(left);
  const b = toRational(right);
  return signOf(a.num * b.den - b.num * a.den);
}

function compareFloatApprox(left: number, right: number): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function asApproxFloat(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * Compares two TOML numeric values (integer `bigint` or float `number`) by
 * mathematical value. Integer/integer and integer/float comparisons remain
 * exact across the full range; NaN is unordered and throws.
 */
export function compareNumbers(left: bigint | number, right: bigint | number): -1 | 0 | 1 {
  if (isNaNValue(left) || isNaNValue(right)) {
    throw new Error("NaN is unordered");
  }
  if (typeof left === "bigint" && typeof right === "bigint") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  const leftInfinite = typeof left === "number" && !Number.isFinite(left);
  const rightInfinite = typeof right === "number" && !Number.isFinite(right);
  if (leftInfinite || rightInfinite) {
    return compareFloatApprox(asApproxFloat(left), asApproxFloat(right));
  }
  return compareExact(left, right);
}

/* -------------------------------------------------------------------------- */
/* Temporal ordering and equality                                             */
/* -------------------------------------------------------------------------- */

function requireFiniteTime(date: TomlDate): number {
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new Error("invalid temporal value");
  }
  return time;
}

/** Instant/lexicographic ordering, per "Minimum Value / Maximum Value" in SPEC.md. */
function compareTemporal(left: TomlDate, right: TomlDate): -1 | 0 | 1 {
  const a = requireFiniteTime(left);
  const b = requireFiniteTime(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Splits an offset date-time's canonical ISO text into local fields + a signed offset (minutes). */
function offsetDateTimeParts(date: TomlDate): { local: string; offsetMinutes: number } {
  const iso = date.toISOString();
  if (iso.endsWith("Z")) {
    return { local: iso.slice(0, -1), offsetMinutes: 0 };
  }
  const sign = iso.at(-6) === "-" ? -1 : 1;
  const hours = Number(iso.slice(-5, -3));
  const minutes = Number(iso.slice(-2));
  return { local: iso.slice(0, -6), offsetMinutes: sign * (hours * 60 + minutes) };
}

/**
 * Parsed Value Equality for temporal values (SPEC.md "Parsed Value Equality"):
 * same TOML temporal type and same parsed fields, including the numeric UTC
 * offset for an offset date-time. Equivalent spellings (`.1`/`.100`,
 * `Z`/`+00:00`) are equal; different offsets for the same instant are not.
 */
function temporalValuesEqual(left: TomlDate, right: TomlDate): boolean {
  if (left.isDateTime() !== right.isDateTime()) return false;
  if (left.isDate() !== right.isDate()) return false;
  if (left.isTime() !== right.isTime()) return false;
  if (left.isLocal() !== right.isLocal()) return false;
  if (left.isDateTime() && !left.isLocal()) {
    const a = offsetDateTimeParts(left);
    const b = offsetDateTimeParts(right);
    return a.local === b.local && a.offsetMinutes === b.offsetMinutes;
  }
  return left.toISOString() === right.toISOString();
}

/**
 * Parsed Value Equality (SPEC.md), used by `allowedvalues` membership,
 * `uniqueitems`, and comparing defaults contributed by composition.
 */
export function valuesEqual(left: TomlValue | undefined, right: TomlValue | undefined): boolean {
  if (isNumeric(left) && isNumeric(right)) {
    if (isNaNValue(left) || isNaNValue(right)) {
      return isNaNValue(left) && isNaNValue(right);
    }
    return compareNumbers(left, right) === 0;
  }
  if (left instanceof TomlDate) {
    return right instanceof TomlDate && temporalValuesEqual(left, right);
  }
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => valuesEqual(item, right[index]));
  }
  if (isTomlTable(left)) {
    if (!isTomlTable(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => key in right && valuesEqual(left[key], right[key]));
  }
  if (typeof left === "string") return typeof right === "string" && left === right;
  if (typeof left === "boolean") return typeof right === "boolean" && left === right;
  return left === undefined && right === undefined;
}

/**
 * Compares a document value against a `min`/`max` boundary. Both operands
 * must be one comparable kind (numeric-with-numeric, or matching temporal
 * types); throws otherwise.
 */
export function compareValues(value: TomlValue, boundary: TomlValue): -1 | 0 | 1 {
  if (isNumeric(value) && isNumeric(boundary)) {
    return compareNumbers(value, boundary);
  }
  if (value instanceof TomlDate && boundary instanceof TomlDate) {
    return compareTemporal(value, boundary);
  }
  throw new Error(`cannot compare ${typeNameOf(value)} with boundary ${typeNameOf(boundary)}`);
}

export function boundaryMatchesType(value: TomlValue, typeName: SchemaType): boolean {
  switch (typeName) {
    case "integer":
    case "float":
      return isNumeric(value);
    case "offset-date-time":
      return value instanceof TomlDate && value.isDateTime() && !value.isLocal();
    case "local-date-time":
      return value instanceof TomlDate && value.isDateTime() && value.isLocal();
    case "local-date":
      return value instanceof TomlDate && value.isDate();
    case "local-time":
      return value instanceof TomlDate && value.isTime();
    default:
      return false;
  }
}

/** Unicode-scalar-value length of a string, per "Length - minlength and maxlength" in SPEC.md. */
export function scalarLength(value: string): number {
  return [...value].length;
}
