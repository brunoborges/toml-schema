import {
  CONDITIONAL_KEYS,
  DEFINITION_KEYS,
  NAMED_REFERENCE_KEYS,
  UNION_KEYS,
  isRangeComparable,
  normalizeReference,
  parseSchemaType,
  type SchemaType,
} from "./builtins.js";
import { emptyRecord, type Condition, type RawDefinition } from "./definition.js";
import { SchemaError } from "./errors.js";
import { isValidStringFormat, parseStringFormat, type StringFormat } from "./formats.js";
import { SchemaSource } from "./tomlSource.js";
import {
  compareValues,
  boundaryMatchesType,
  isNaNValue,
  isNumeric,
  isTomlArray,
  isTomlTable,
  scalarLength,
  type TomlTable,
  type TomlValue,
} from "./values.js";
import { TomlDate } from "smol-toml";

/** Reads a definition-table property, treating a raw table value as "not present". */
function propertyValue(table: TomlTable, key: string): TomlValue | undefined {
  const value = table[key];
  if (value !== undefined && isTomlTable(value)) return undefined;
  return value;
}

function getStringProp(table: TomlTable, key: string, context: string): string {
  const value = propertyValue(table, key);
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new SchemaError(`expected ${key} to be a string (${context})`);
  }
  return value;
}

function getBoolProp(table: TomlTable, key: string, context: string): boolean {
  const value = propertyValue(table, key);
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new SchemaError(`expected ${key} to be a boolean (${context})`);
  }
  return value;
}

function getOptionalBoolProp(
  table: TomlTable,
  key: string,
  context: string,
): boolean | undefined {
  const value = propertyValue(table, key);
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new SchemaError(`expected ${key} to be a boolean (${context})`);
  }
  return value;
}

const MAX_INT32 = 2147483647;

function getIntegerProp(table: TomlTable, key: string, context: string): number | undefined {
  const value = propertyValue(table, key);
  if (value === undefined) return undefined;
  if (typeof value !== "bigint") {
    throw new SchemaError(`expected ${key} to be an integer (${context})`);
  }
  if (value < 0n || value > BigInt(MAX_INT32)) {
    throw new SchemaError(`${key} must be between 0 and ${MAX_INT32} (${context})`);
  }
  return Number(value);
}

function getPatternProp(
  table: TomlTable,
  key: string,
  context: string,
): { regex: RegExp; source: string } | undefined {
  const value = propertyValue(table, key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new SchemaError(`expected ${key} to be a string (${context})`);
  }
  validatePortablePattern(context, key, value);
  try {
    return { regex: new RegExp(toJavaScriptPattern(value), "u"), source: value };
  } catch (cause) {
    throw new SchemaError(
      `invalid-pattern: ${context} has invalid ${key}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function validatePortablePattern(context: string, key: string, pattern: string): void {
  let inCharacterClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const current = pattern[index];
    if (current === "\\" && index + 1 < pattern.length) {
      const escaped = pattern[index + 1]!;
      if (!"\\.^$*+?()[]{}|-tnrfva".includes(escaped)) {
        throw new SchemaError(
          `unsupported-pattern: ${context} ${key} uses non-portable escape \\${escaped}`,
        );
      }
      index++;
    } else if (current === "[") {
      inCharacterClass = true;
    } else if (current === "]") {
      inCharacterClass = false;
    } else if (
      !inCharacterClass &&
      current === "(" &&
      pattern[index + 1] === "?" &&
      pattern[index + 2] !== ":"
    ) {
      throw new SchemaError(
        `unsupported-pattern: ${context} ${key} uses non-portable group syntax`,
      );
    } else if (
      !inCharacterClass &&
      "?*+}".includes(current ?? "") &&
      index + 1 < pattern.length &&
      "?+".includes(pattern[index + 1] ?? "")
    ) {
      throw new SchemaError(
        `unsupported-pattern: ${context} ${key} uses a non-greedy or possessive quantifier`,
      );
    }
  }

}

function toJavaScriptPattern(pattern: string): string {
  let translated = "";
  for (let index = 0; index < pattern.length; index++) {
    const current = pattern[index]!;
    if (current === "\\" && index + 1 < pattern.length) {
      const escaped = pattern[index + 1]!;
      translated += escaped === "a" ? "\u0007" : current + escaped;
      index++;
    } else {
      translated += current;
    }
  }
  return translated;
}

function getArrayProp(table: TomlTable, key: string, context: string): TomlValue[] | undefined {
  const value = propertyValue(table, key);
  if (value === undefined) return undefined;
  if (!isTomlArray(value)) {
    throw new SchemaError(`expected ${key} to be an array (${context})`);
  }
  return value;
}

function getStringArrayProp(table: TomlTable, key: string, context: string): string[] {
  const values = getArrayProp(table, key, context);
  if (values === undefined) return [];
  return values.map((value) => {
    if (typeof value !== "string") {
      throw new SchemaError(`expected ${key} to contain only strings (${context})`);
    }
    return value;
  });
}

function normalizeReferences(references: readonly string[]): string[] {
  return references.map(normalizeReference);
}

/* -------------------------------------------------------------------------- */
/* Top-level and reference-shape validation helpers                           */
/* -------------------------------------------------------------------------- */

function rejectBareCollectionReference(name: string, property: string, reference: string): void {
  if (reference !== "" && normalizeReference(reference) === "collection") {
    throw new SchemaError(`${name} cannot use collection as a bare ${property} reference`);
  }
}

function rejectBareCollectionReferences(
  name: string,
  property: string,
  references: readonly string[],
): void {
  for (const reference of references) {
    rejectBareCollectionReference(name, property, normalizeReference(reference));
  }
}

function validateAlternativeReferences(
  name: string,
  property: string,
  references: readonly string[],
): void {
  const seen = new Map<string, string>();
  for (const reference of references) {
    const normalized = normalizeReference(reference);
    rejectBareCollectionReference(name, property, normalized);
    if (normalized === "any") {
      throw new SchemaError(`${name} cannot use any directly in ${property}`);
    }
    const first = seen.get(normalized);
    if (first !== undefined) {
      throw new SchemaError(
        `${name} ${property} contains duplicate type references ${JSON.stringify(first)} and ${JSON.stringify(reference)}; both resolve to ${normalized}`,
      );
    }
    seen.set(normalized, reference);
  }
}

function isRangeBoundary(value: TomlValue): boolean {
  return isNumeric(value) || value instanceof TomlDate;
}

function validateRangeBoundary(name: string, key: string, value: TomlValue | undefined): void {
  if (value === undefined || isRangeBoundary(value)) return;
  throw new SchemaError(`${name} ${key} must be an integer, float, or temporal value`);
}

function validateBoundaryMatchesType(
  name: string,
  key: string,
  value: TomlValue | undefined,
  typeName: SchemaType,
): void {
  if (value === undefined || boundaryMatchesType(value, typeName)) return;
  throw new SchemaError(`${name} ${key} must be comparable with ${typeName}`);
}

function validateRangeConstraints(
  name: string,
  typeName: SchemaType | undefined,
  min: TomlValue | undefined,
  max: TomlValue | undefined,
): void {
  if (min === undefined && max === undefined) return;
  validateRangeBoundary(name, "min", min);
  validateRangeBoundary(name, "max", max);
  if (isNaNValue(min)) throw new SchemaError(`${name} cannot use NaN as min`);
  if (isNaNValue(max)) throw new SchemaError(`${name} cannot use NaN as max`);
  if (typeName === "any") {
    throw new SchemaError(`${name} cannot define min or max when type is any`);
  }
  if (typeName === "array" || typeName === "collection") return;
  if (typeName !== undefined && !isRangeComparable(typeName)) {
    throw new SchemaError(
      `${name} can only define min or max for integer, float, date/time, or compatible array types`,
    );
  }
  if (typeName !== undefined) {
    validateBoundaryMatchesType(name, "min", min, typeName);
    validateBoundaryMatchesType(name, "max", max, typeName);
    validateOrderedRange(name, min, max, typeName);
  }
}

export function validateOrderedRange(
  name: string,
  min: TomlValue | undefined,
  max: TomlValue | undefined,
  comparableKind: SchemaType,
): void {
  if (comparableKind === "integer") {
    if (typeof min === "number" && !Number.isFinite(min)) {
      throw new SchemaError(`${name} cannot use infinity as min when comparable kind is integer`);
    }
    if (typeof max === "number" && !Number.isFinite(max)) {
      throw new SchemaError(`${name} cannot use infinity as max when comparable kind is integer`);
    }
  }
  if (min !== undefined && max !== undefined && compareValues(min, max) > 0) {
    throw new SchemaError(`${name} min must not be greater than max`);
  }
}

function validateAllowedValuesConstraints(
  name: string,
  typeName: SchemaType | undefined,
  allowedValues: readonly TomlValue[],
  pattern: RegExp | undefined,
  format: StringFormat | undefined,
  min: TomlValue | undefined,
  max: TomlValue | undefined,
  minLength: number | undefined,
  maxLength: number | undefined,
): void {
  if (allowedValues.length === 0) return;
  const isContainer = typeName === "array" || typeName === "collection";
  allowedValues.forEach((allowed, index) => {
    const entry = `${name} allowedvalues[${index}]`;
    if (pattern !== undefined) {
      if (typeof allowed !== "string" || !pattern.test(allowed)) {
        throw new SchemaError(`${entry} does not satisfy pattern`);
      }
    }
    if (format !== undefined) {
      if (typeof allowed !== "string" || !isValidStringFormat(format, allowed)) {
        throw new SchemaError(`${entry} does not satisfy format ${format}`);
      }
    }
    if ((min !== undefined || max !== undefined) && isNaNValue(allowed)) {
      throw new SchemaError(`${entry} does not satisfy min or max`);
    }
    if (min !== undefined) {
      let comparison: number;
      try {
        comparison = compareValues(allowed, min);
      } catch (cause) {
        throw new SchemaError(
          `${entry} cannot be compared with min: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      if (comparison < 0) throw new SchemaError(`${entry} is less than min`);
    }
    if (max !== undefined) {
      let comparison: number;
      try {
        comparison = compareValues(allowed, max);
      } catch (cause) {
        throw new SchemaError(
          `${entry} cannot be compared with max: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      if (comparison > 0) throw new SchemaError(`${entry} is greater than max`);
    }
    if (!isContainer && (minLength !== undefined || maxLength !== undefined)) {
      if (typeof allowed !== "string") {
        throw new SchemaError(`${entry} does not satisfy string length constraints`);
      }
      const length = scalarLength(allowed);
      if (minLength !== undefined && length < minLength) {
        throw new SchemaError(`${entry} is shorter than minlength`);
      }
      if (maxLength !== undefined && length > maxLength) {
        throw new SchemaError(`${entry} is longer than maxlength`);
      }
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Conditional (`if`/`then`/`else`) and sibling-rule property parsing         */
/* -------------------------------------------------------------------------- */

interface ParsedConditional {
  condition?: Condition;
  thenReference: string;
  elseReference: string;
}

function getConditional(
  name: string,
  path: readonly string[],
  table: TomlTable,
  source: SchemaSource,
): ParsedConditional {
  const hasIf = source.isProperty(table, path, "if");
  const hasThen = source.isProperty(table, path, "then");
  const hasElse = source.isProperty(table, path, "else");
  if (!hasIf && !hasThen && !hasElse) {
    return { thenReference: "", elseReference: "" };
  }
  if (!hasIf || !hasThen || !hasElse) {
    throw new SchemaError(`${name} must define if, then, and else together`);
  }
  const rawCondition = table["if"];
  if (!isTomlTable(rawCondition)) {
    throw new SchemaError(`${name} if must be an inline table`);
  }
  for (const key of Object.keys(rawCondition)) {
    if (key !== "key" && key !== "equals" && key !== "in") {
      throw new SchemaError(`${name} if contains unsupported property: ${key}`);
    }
  }
  const key = rawCondition["key"];
  if (typeof key !== "string") {
    throw new SchemaError(`${name} if.key must be a string`);
  }
  const hasEquals = "equals" in rawCondition;
  const hasIn = "in" in rawCondition;
  if (hasEquals === hasIn) {
    throw new SchemaError(`${name} if must define exactly one of equals and in`);
  }
  let inValues: TomlValue[] = [];
  if (hasIn) {
    const rawIn = rawCondition["in"];
    if (!isTomlArray(rawIn) || rawIn.length === 0) {
      throw new SchemaError(`${name} if.in must be a non-empty array`);
    }
    inValues = rawIn;
  }
  const thenReference = table["then"];
  if (typeof thenReference !== "string" || thenReference.trim() === "") {
    throw new SchemaError(`${name} then must be a non-blank named type reference`);
  }
  const elseReference = table["else"];
  if (typeof elseReference !== "string" || elseReference.trim() === "") {
    throw new SchemaError(`${name} else must be a non-blank named type reference`);
  }
  for (const [property, reference] of [
    ["then", thenReference],
    ["else", elseReference],
  ] as const) {
    if (parseSchemaType(normalizeReference(reference)) !== undefined) {
      throw new SchemaError(`${name} ${property} must be a named reusable type reference`);
    }
  }
  const condition: Condition = hasEquals
    ? { key, hasEquals: true, equals: rawCondition["equals"], in: [] }
    : { key, hasEquals: false, in: inValues };
  return { condition, thenReference, elseReference };
}

function getDependentRequired(
  name: string,
  path: readonly string[],
  table: TomlTable,
  source: SchemaSource,
): Record<string, readonly string[]> | undefined {
  if (!source.isProperty(table, path, "dependentrequired")) return undefined;
  const dependencies = table["dependentrequired"];
  if (!isTomlTable(dependencies)) {
    throw new SchemaError(`${name} dependentrequired must be a table`);
  }
  const entries = Object.entries(dependencies);
  if (entries.length === 0) {
    throw new SchemaError(`${name} dependentrequired must not be empty`);
  }
  const result: Record<string, string[]> = {};
  for (const [trigger, raw] of entries) {
    if (!isTomlArray(raw) || raw.length === 0) {
      throw new SchemaError(
        `${name} dependentrequired.${trigger} must be a non-empty string array`,
      );
    }
    const seen = new Set<string>();
    const values: string[] = [];
    for (const value of raw) {
      if (typeof value !== "string") {
        throw new SchemaError(`${name} dependentrequired.${trigger} must contain only strings`);
      }
      if (seen.has(value)) {
        throw new SchemaError(
          `${name} dependentrequired.${trigger} contains duplicate ${JSON.stringify(value)}`,
        );
      }
      seen.add(value);
      values.push(value);
    }
    result[trigger] = values;
  }
  return result;
}

function getKeyGroups(
  name: string,
  path: readonly string[],
  table: TomlTable,
  key: string,
  source: SchemaSource,
): string[][] | undefined {
  if (!source.isProperty(table, path, key)) return undefined;
  const groups = table[key];
  if (!isTomlArray(groups) || groups.length === 0) {
    throw new SchemaError(`${name} ${key} must be a non-empty array`);
  }
  return groups.map((rawGroup, index) => {
    if (!isTomlArray(rawGroup) || rawGroup.length < 2) {
      throw new SchemaError(`${name} ${key}[${index}] must contain at least two strings`);
    }
    const seen = new Set<string>();
    const converted: string[] = [];
    for (const rawName of rawGroup) {
      if (typeof rawName !== "string") {
        throw new SchemaError(`${name} ${key}[${index}] must contain only strings`);
      }
      if (seen.has(rawName)) {
        throw new SchemaError(
          `${name} ${key}[${index}] contains duplicate ${JSON.stringify(rawName)}`,
        );
      }
      seen.add(rawName);
      converted.push(rawName);
    }
    return converted;
  });
}

/* -------------------------------------------------------------------------- */
/* Definition parsing                                                         */
/* -------------------------------------------------------------------------- */

export function parseDefinitions(
  prefix: string,
  table: TomlTable | undefined,
  required: boolean,
  source: SchemaSource,
): Record<string, RawDefinition> {
  if (table === undefined) {
    if (required) {
      throw new SchemaError(`missing required [${prefix}] table`);
    }
    return emptyRecord();
  }
  const definitions = emptyRecord<RawDefinition>();
  for (const [key, value] of Object.entries(table)) {
    if (prefix === "types") {
      if (parseSchemaType(key) !== undefined) {
        throw new SchemaError(`[types.${key}] uses a reserved built-in type name`);
      }
      if (key.startsWith("types.")) {
        throw new SchemaError(`[types.${key}] uses the reserved type-reference prefix`);
      }
    }
    if (!isTomlTable(value)) {
      throw new SchemaError(`[${prefix}] entry must be a table: ${key}`);
    }
    definitions[key] = parseDefinition(`${prefix}.${key}`, [prefix, key], value, source);
  }
  return definitions;
}

function isSelectorBearingChild(
  table: TomlTable,
  path: readonly string[],
  source: SchemaSource,
): boolean {
  return ["type", "oneof", "anyof", "if"].some((key) => source.isProperty(table, path, key));
}

export function parseDefinition(
  name: string,
  path: readonly string[],
  table: TomlTable,
  source: SchemaSource,
): RawDefinition {
  const typeSelector = getStringProp(table, "type", name);
  if (propertyValue(table, "type") !== undefined && typeSelector === "") {
    throw new SchemaError(`${name} type must not be blank`);
  }
  let typeName: SchemaType | undefined;
  let reference = "";
  if (typeSelector !== "") {
    const normalizedSelector = normalizeReference(typeSelector);
    const builtIn = parseSchemaType(normalizedSelector);
    if (builtIn !== undefined) {
      typeName = builtIn;
    } else {
      reference = normalizedSelector;
    }
  }
  if (reference !== "") {
    for (const key of Object.keys(table)) {
      if (!NAMED_REFERENCE_KEYS.has(key)) {
        throw new SchemaError(`${name} named type reference cannot define ${key}`);
      }
    }
  }
  const description = getStringProp(table, "description", name);
  const itemReference = getStringProp(table, "itemtype", name);
  if (propertyValue(table, "itemtype") !== undefined && itemReference === "") {
    throw new SchemaError(`${name} itemtype must not be blank`);
  }
  const items = getStringArrayProp(table, "items", name);
  if (propertyValue(table, "items") !== undefined && items.length === 0) {
    throw new SchemaError(`${name} items must contain at least one type reference`);
  }
  const optional = getBoolProp(table, "optional", name);
  const patternResult = getPatternProp(table, "pattern", name);
  const formatValue = propertyValue(table, "format");
  if (formatValue !== undefined && typeof formatValue !== "string") {
    throw new SchemaError(`expected format to be a string (${name})`);
  }
  const format = typeof formatValue === "string" ? parseStringFormat(formatValue) : undefined;
  if (typeof formatValue === "string" && format === undefined) {
    throw new SchemaError(`${name} has unknown string format: ${formatValue}`);
  }
  const keyPatternResult = getPatternProp(table, "keypattern", name);
  const minLength = getIntegerProp(table, "minlength", name);
  const maxLength = getIntegerProp(table, "maxlength", name);
  const allowedValues = getArrayProp(table, "allowedvalues", name) ?? [];
  const hasAllowedValues = propertyValue(table, "allowedvalues") !== undefined;
  if (hasAllowedValues && allowedValues.length === 0) {
    throw new SchemaError(`${name} allowedvalues must contain at least one entry`);
  }
  const hasOneOf = propertyValue(table, "oneof") !== undefined;
  const hasAnyOf = propertyValue(table, "anyof") !== undefined;
  const oneOf = getStringArrayProp(table, "oneof", name);
  const anyOf = getStringArrayProp(table, "anyof", name);
  const allOf = getStringArrayProp(table, "allof", name);
  const { condition, thenReference, elseReference } = getConditional(name, path, table, source);

  for (const [property, references] of [
    ["items", items],
    ["oneof", oneOf],
    ["anyof", anyOf],
    ["allof", allOf],
  ] as const) {
    for (const reference of references) {
      if (reference === "") {
        throw new SchemaError(`${name} ${property} references must not be blank`);
      }
    }
  }
  if (hasOneOf && oneOf.length === 0) {
    throw new SchemaError(`${name} oneof must contain at least one type reference`);
  }
  if (hasAnyOf && anyOf.length === 0) {
    throw new SchemaError(`${name} anyof must contain at least one type reference`);
  }
  if (propertyValue(table, "allof") !== undefined && allOf.length === 0) {
    throw new SchemaError(`${name} allof must contain at least one type reference`);
  }
  rejectBareCollectionReference(name, "itemtype", itemReference);
  rejectBareCollectionReferences(name, "items", items);
  validateAlternativeReferences(name, "oneof", oneOf);
  validateAlternativeReferences(name, "anyof", anyOf);
  validateAlternativeReferences(name, "allof", allOf);
  if (typeSelector !== "" && typeName !== "collection" && normalizeReference(typeSelector) === "collection") {
    throw new SchemaError(`${name} cannot use collection as a bare type reference`);
  }

  let typeSelectors = 0;
  if (typeSelector !== "") typeSelectors++;
  if (hasOneOf) typeSelectors++;
  if (hasAnyOf) typeSelectors++;
  if (condition !== undefined) typeSelectors++;
  if (typeSelectors > 1) {
    throw new SchemaError(`${name} cannot define more than one of type, oneof, anyof, and if`);
  }

  const children = emptyRecord<RawDefinition>();
  const escapedChildren = table["children"];
  const hasEscapeNamespace =
    isTomlTable(escapedChildren) &&
    !isSelectorBearingChild(escapedChildren, [...path, "children"], source);
  if (hasEscapeNamespace) {
    const entries = Object.entries(escapedChildren);
    if (entries.length === 0) {
      throw new SchemaError(`${name} children escape namespace must not be empty`);
    }
    for (const [key, value] of entries) {
      if (!(DEFINITION_KEYS as readonly string[]).includes(key) && key !== "children") {
        throw new SchemaError(
          `${name} children escape namespace contains non-conflicting child: ${key}`,
        );
      }
      if (!isTomlTable(value)) {
        throw new SchemaError(`${name}.children.${key} must be a child definition table`);
      }
      children[key] = parseDefinition(
        `${name}.${key}`,
        [...path, "children", key],
        value,
        source,
      );
    }
  }

  for (const [key, value] of Object.entries(table)) {
    if (key === "children" && hasEscapeNamespace) {
      continue;
    }
    if ((DEFINITION_KEYS as readonly string[]).includes(key) && source.isProperty(table, path, key)) {
      continue;
    }
    if (isTomlTable(value)) {
      if (Object.hasOwn(children, key)) {
        throw new SchemaError(`${name} defines child ${key} more than once`);
      }
      children[key] = parseDefinition(`${name}.${key}`, [...path, key], value, source);
    } else if (!(DEFINITION_KEYS as readonly string[]).includes(key)) {
      throw new SchemaError(`${name} contains unsupported property: ${key}`);
    }
  }

  if (hasOneOf || hasAnyOf) {
    for (const key of Object.keys(table)) {
      if (!UNION_KEYS.has(key)) {
        throw new SchemaError(`${name} union cannot define ${key}`);
      }
    }
  }
  if (condition !== undefined) {
    for (const key of Object.keys(table)) {
      if (!CONDITIONAL_KEYS.has(key)) {
        throw new SchemaError(`${name} conditional selector cannot define ${key}`);
      }
    }
    if (Object.keys(children).length > 0) {
      throw new SchemaError(`${name} conditional selector cannot define child definitions`);
    }
  }
  if (typeName === undefined && reference === "" && !hasOneOf && !hasAnyOf && condition === undefined) {
    if (Object.keys(children).length === 0) {
      if (allOf.length === 0) {
        throw new SchemaError(`${name} must define type, oneof, anyof, or child definitions`);
      }
    } else {
      typeName = "table";
    }
  }
  if (Object.keys(children).length > 0 && typeName !== "table" && typeName !== "collection") {
    throw new SchemaError(`${name} can only define children when type is table or collection`);
  }
  if (typeName !== "array" && typeName !== "collection" && itemReference !== "") {
    throw new SchemaError(`${name} can only define itemtype when type is array or collection`);
  }
  if (typeName !== "array" && items.length > 0) {
    throw new SchemaError(`${name} can only define items when type is array`);
  }
  if (items.length > 0) {
    if (itemReference !== "") {
      throw new SchemaError(`${name} cannot define both items and itemtype`);
    }
    if (minLength !== undefined || maxLength !== undefined) {
      throw new SchemaError(`${name} cannot define minlength or maxlength together with items`);
    }
    if (hasAllowedValues) {
      throw new SchemaError(`${name} cannot define allowedvalues together with items`);
    }
    if (propertyValue(table, "min") !== undefined || propertyValue(table, "max") !== undefined) {
      throw new SchemaError(`${name} cannot define min or max together with items`);
    }
    if (patternResult !== undefined || format !== undefined) {
      throw new SchemaError(`${name} cannot define pattern or format together with items`);
    }
  }
  const min = propertyValue(table, "min");
  const max = propertyValue(table, "max");
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    throw new SchemaError(`${name} minlength must not be greater than maxlength`);
  }
  if (keyPatternResult !== undefined && typeName !== "collection") {
    throw new SchemaError(`${name} can only define keypattern when type is collection`);
  }
  if (
    patternResult !== undefined &&
    typeName !== "string" &&
    typeName !== "array" &&
    typeName !== "collection"
  ) {
    throw new SchemaError(`${name} can only define pattern when type is string`);
  }
  if (format !== undefined && typeName !== "string" && typeName !== "array" && typeName !== "collection") {
    throw new SchemaError(`${name} can only define format when type is string`);
  }
  if (hasAllowedValues && typeName === "table") {
    throw new SchemaError(`${name} can only define allowedvalues for scalar, unconstrained, or array types`);
  }
  if (
    (minLength !== undefined || maxLength !== undefined) &&
    typeName !== "string" &&
    typeName !== "array" &&
    typeName !== "collection"
  ) {
    throw new SchemaError(
      `${name} can only define minlength or maxlength when type is string, array, or collection`,
    );
  }
  if (typeName === "collection" && itemReference === "" && allOf.length === 0) {
    throw new SchemaError(`${name} must define itemtype when type is collection`);
  }
  validateRangeConstraints(name, typeName, min, max);
  validateAllowedValuesConstraints(
    name,
    typeName,
    allowedValues,
    patternResult?.regex,
    format,
    min,
    max,
    minLength,
    maxLength,
  );
  const dependentRequired = getDependentRequired(name, path, table, source);
  const mutuallyExclusive = getKeyGroups(name, path, table, "mutuallyexclusive", source);
  const exactlyOne = getKeyGroups(name, path, table, "exactlyone", source);
  const uniqueItems = getOptionalBoolProp(table, "uniqueitems", name);
  const deprecated = getOptionalBoolProp(table, "deprecated", name);
  const hasDefault = source.isProperty(table, path, "default");
  const defaultValue = hasDefault ? table["default"] : undefined;
  if (condition !== undefined && hasDefault && !isTomlTable(defaultValue)) {
    throw new SchemaError(`${name} conditional default must be a table`);
  }

  const raw: RawDefinition = {
    name,
    ...(typeName !== undefined ? { typeName } : {}),
    ...(reference !== "" ? { reference } : {}),
    ...(description !== "" ? { description } : {}),
    ...(itemReference !== "" ? { itemReference: normalizeReference(itemReference) } : {}),
    ...(items.length > 0 ? { items: normalizeReferences(items) } : {}),
    optional,
    ...(allowedValues.length > 0 ? { allowedValues } : {}),
    ...(patternResult !== undefined
      ? { pattern: patternResult.regex, patternSource: patternResult.source }
      : {}),
    ...(format !== undefined ? { format } : {}),
    ...(keyPatternResult !== undefined
      ? { keyPattern: keyPatternResult.regex, keyPatternSource: keyPatternResult.source }
      : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(oneOf.length > 0 ? { oneOf: normalizeReferences(oneOf) } : {}),
    ...(anyOf.length > 0 ? { anyOf: normalizeReferences(anyOf) } : {}),
    ...(condition !== undefined ? { condition } : {}),
    ...(thenReference !== "" ? { thenReference: normalizeReference(thenReference) } : {}),
    ...(elseReference !== "" ? { elseReference: normalizeReference(elseReference) } : {}),
    ...(allOf.length > 0 ? { allOf: normalizeReferences(allOf) } : {}),
    ...(dependentRequired !== undefined ? { dependentRequired } : {}),
    ...(mutuallyExclusive !== undefined ? { mutuallyExclusive } : {}),
    ...(exactlyOne !== undefined ? { exactlyOne } : {}),
    ...(uniqueItems !== undefined ? { uniqueItems } : {}),
    ...(hasDefault ? { defaultValue } : {}),
    hasDefault,
    deprecated: deprecated ?? false,
    children,
  };
  return raw;
}
