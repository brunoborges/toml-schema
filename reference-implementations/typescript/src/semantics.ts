import { isRangeComparable, normalizeReference, parseSchemaType, type SchemaType } from "./builtins.js";
import { cloneDefinition, emptyRecord, type RawDefinition } from "./definition.js";
import { SchemaError } from "./errors.js";
import { validateOrderedRange } from "./schemaParser.js";
import {
  boundaryMatchesType,
  isType,
  valuesEqual,
  type TomlValue,
} from "./values.js";

/** The parsed `types` and `elements` tables of a loaded schema. */
export interface SchemaData {
  readonly types: Readonly<Record<string, RawDefinition>>;
  readonly elements: Readonly<Record<string, RawDefinition>>;
}

function isBuiltIn(reference: string): boolean {
  return parseSchemaType(reference) !== undefined;
}

/** Resolves a bare type-selector string (built-in name or `[types.*]` reference) to a definition. */
export function definitionForReference(data: SchemaData, reference: string): RawDefinition {
  const normalized = normalizeReference(reference);
  const builtIn = parseSchemaType(normalized);
  if (builtIn !== undefined) {
    return {
      name: normalized,
      typeName: builtIn,
      optional: false,
      hasDefault: false,
      deprecated: false,
      children: emptyRecord(),
    };
  }
  const definition = data.types[normalized];
  if (!definition) {
    throw new SchemaError(`unknown type reference: ${reference}`);
  }
  return definition;
}

/* -------------------------------------------------------------------------- */
/* Effective kind / fixed children / collection item constraint resolution   */
/* -------------------------------------------------------------------------- */

interface EffectiveKindResult {
  kind: SchemaType | undefined;
  resolved: boolean;
}

export function effectiveKind(
  data: SchemaData,
  definition: RawDefinition,
  visiting: Set<string>,
): EffectiveKindResult {
  let result: EffectiveKindResult;
  if (definition.reference) {
    const reference = definition.reference;
    const target = data.types[reference];
    if (!target) throw new SchemaError(`unknown type reference: ${reference}`);
    if (visiting.has(reference)) throw new SchemaError(`cyclic type reference: ${reference}`);
    visiting.add(reference);
    try {
      result = effectiveKind(data, target, visiting);
    } finally {
      visiting.delete(reference);
    }
  } else if ((definition.oneOf?.length ?? 0) > 0 || (definition.anyOf?.length ?? 0) > 0) {
    const alternatives = definition.oneOf?.length ? definition.oneOf : (definition.anyOf ?? []);
    let kind: SchemaType | undefined;
    let resolved = false;
    for (const reference of alternatives) {
      const alternative = definitionForReference(data, reference);
      const alternativeResult = effectiveKind(data, alternative, visiting);
      if (!alternativeResult.resolved || (resolved && alternativeResult.kind !== kind)) {
        resolved = false;
        kind = undefined;
        break;
      }
      kind = alternativeResult.kind;
      resolved = true;
    }
    result = { kind, resolved };
  } else if (definition.condition) {
    let kind: SchemaType | undefined;
    let resolved = false;
    for (const reference of [definition.thenReference, definition.elseReference]) {
      const branch = definitionForReference(data, reference ?? "");
      const branchResult = effectiveKind(data, branch, visiting);
      if (!branchResult.resolved || (resolved && branchResult.kind !== kind)) {
        throw new SchemaError("conditional branches have incompatible effective kinds");
      }
      kind = branchResult.kind;
      resolved = true;
    }
    result = { kind, resolved };
  } else {
    result = { kind: definition.typeName, resolved: definition.typeName !== undefined };
  }
  const allOf = definition.allOf ?? [];
  if (allOf.length === 0) return result;
  if (!result.resolved || result.kind === "any") {
    throw new SchemaError("allof requires a determinate effective kind");
  }
  for (const reference of allOf) {
    const component = definitionForReference(data, reference);
    const componentResult = effectiveKind(data, component, visiting);
    if (!componentResult.resolved || componentResult.kind === "any" || componentResult.kind !== result.kind) {
      throw new SchemaError(`allof component ${reference} has incompatible effective kind`);
    }
  }
  return { kind: result.kind, resolved: true };
}

export function determinateFixedChildren(
  data: SchemaData,
  definition: RawDefinition,
  visiting: Set<string>,
): Set<string> {
  const fixed = new Set<string>(Object.keys(definition.children));
  const references: string[] = [
    ...(definition.allOf ?? []),
    ...(definition.reference ? [definition.reference] : []),
  ];
  for (const reference of references) {
    const targetFixed = determinateReferenceFixedChildren(data, reference, visiting);
    for (const name of targetFixed) fixed.add(name);
  }
  return fixed;
}

function determinateReferenceFixedChildren(
  data: SchemaData,
  reference: string,
  visiting: Set<string>,
): Set<string> {
  if (isBuiltIn(reference)) return new Set();
  if (visiting.has(reference)) throw new SchemaError(`cyclic composition reference: ${reference}`);
  const target = data.types[reference];
  if (!target) throw new SchemaError(`unknown type reference: ${reference}`);
  visiting.add(reference);
  try {
    return determinateFixedChildren(data, target, visiting);
  } finally {
    visiting.delete(reference);
  }
}

/**
 * Reports whether a dynamic-entry constraint is supplied by this definition,
 * by the definition it references, or by a structurally contributing allof
 * component.
 */
export function hasCollectionItemConstraint(
  data: SchemaData,
  definition: RawDefinition,
  visiting: Set<string>,
): boolean {
  if ((definition.oneOf?.length ?? 0) > 0 || (definition.anyOf?.length ?? 0) > 0 || definition.condition) {
    return true;
  }
  if (definition.itemReference) return true;
  if (definition.reference) {
    const target = data.types[definition.reference];
    if (!target) throw new SchemaError(`unknown type reference: ${definition.reference}`);
    visiting.add(definition.reference);
    try {
      if (hasCollectionItemConstraint(data, target, visiting)) return true;
    } finally {
      visiting.delete(definition.reference);
    }
  }
  for (const reference of definition.allOf ?? []) {
    if (isBuiltIn(reference)) continue;
    if (visiting.has(reference)) throw new SchemaError(`cyclic composition reference: ${reference}`);
    const target = data.types[reference];
    if (!target) throw new SchemaError(`unknown type reference: ${reference}`);
    if ((target.oneOf?.length ?? 0) > 0 || (target.anyOf?.length ?? 0) > 0 || target.condition) {
      continue;
    }
    visiting.add(reference);
    let found: boolean;
    try {
      found = hasCollectionItemConstraint(data, target, visiting);
    } finally {
      visiting.delete(reference);
    }
    if (found) return true;
  }
  return false;
}

export function resolveItemKind(
  data: SchemaData,
  reference: string | undefined,
  seen: Set<string>,
): EffectiveKindResult {
  const normalized = normalizeReference(reference ?? "");
  if (normalized === "") return { kind: undefined, resolved: false };
  const builtIn = parseSchemaType(normalized);
  if (builtIn !== undefined) return { kind: builtIn, resolved: true };
  if (seen.has(normalized)) throw new SchemaError(`cyclic type reference: ${normalized}`);
  const definition = data.types[normalized];
  if (!definition) throw new SchemaError(`unknown type reference: ${reference}`);
  seen.add(normalized);
  try {
    if (definition.reference) return resolveItemKind(data, definition.reference, seen);
    if (definition.condition) {
      let kind: SchemaType | undefined;
      for (const ref of [definition.thenReference, definition.elseReference]) {
        const branch = resolveItemKind(data, ref, seen);
        if (!branch.resolved || (kind !== undefined && branch.kind !== kind)) return { kind: undefined, resolved: false };
        kind = branch.kind;
      }
      return kind !== undefined ? { kind, resolved: true } : { kind: undefined, resolved: false };
    }
    const alternatives = definition.oneOf?.length ? definition.oneOf : (definition.anyOf ?? []);
    if (alternatives.length === 0) {
      return definition.typeName !== undefined
        ? { kind: definition.typeName, resolved: true }
        : { kind: undefined, resolved: false };
    }
    let resolvedType: SchemaType | undefined;
    for (const alternative of alternatives) {
      const alternativeResult = resolveItemKind(data, alternative, seen);
      if (!alternativeResult.resolved || (resolvedType !== undefined && alternativeResult.kind !== resolvedType)) {
        return { kind: undefined, resolved: false };
      }
      resolvedType = alternativeResult.kind;
    }
    return resolvedType !== undefined ? { kind: resolvedType, resolved: true } : { kind: undefined, resolved: false };
  } finally {
    seen.delete(normalized);
  }
}

export function collectReferenceTypes(
  data: SchemaData,
  reference: string,
  seen: Set<string>,
  types: Set<SchemaType>,
): void {
  const normalized = normalizeReference(reference);
  const builtIn = parseSchemaType(normalized);
  if (builtIn !== undefined) {
    types.add(builtIn);
    return;
  }
  if (seen.has(normalized)) throw new SchemaError(`cyclic type reference: ${normalized}`);
  const definition = data.types[normalized];
  if (!definition) throw new SchemaError(`unknown type reference: ${reference}`);
  seen.add(normalized);
  try {
    if (definition.reference) {
      collectReferenceTypes(data, definition.reference, seen, types);
      return;
    }
    if (definition.condition) {
      for (const ref of [definition.thenReference, definition.elseReference]) {
        collectReferenceTypes(data, ref ?? "", seen, types);
      }
      return;
    }
    const alternatives = definition.oneOf?.length ? definition.oneOf : (definition.anyOf ?? []);
    if (alternatives.length === 0) {
      if (definition.typeName !== undefined) types.add(definition.typeName);
      return;
    }
    for (const alternative of alternatives) {
      collectReferenceTypes(data, alternative, seen, types);
    }
  } finally {
    seen.delete(normalized);
  }
}

/* -------------------------------------------------------------------------- */
/* Schema-load-time semantic validation                                      */
/* -------------------------------------------------------------------------- */

export function validateSemantics(data: SchemaData): void {
  for (const definitions of [data.types, data.elements]) {
    for (const definition of Object.values(definitions)) {
      validateDefinitionSemantics(data, definition);
    }
  }
}

function validateDefinitionSemantics(data: SchemaData, definition: RawDefinition): void {
  let kind: SchemaType | undefined;
  let resolved: boolean;
  try {
    ({ kind, resolved } = effectiveKind(data, definition, new Set()));
  } catch (cause) {
    throw new SchemaError(`${definition.name}: ${errorMessage(cause)}`);
  }
  const hasSiblingRules =
    Object.keys(definition.dependentRequired ?? {}).length > 0 ||
    (definition.mutuallyExclusive?.length ?? 0) > 0 ||
    (definition.exactlyOne?.length ?? 0) > 0;
  if (hasSiblingRules) {
    if (!resolved || (kind !== "table" && kind !== "collection")) {
      throw new SchemaError(`${definition.name} sibling rules require an effective table or collection`);
    }
    let fixed: Set<string>;
    try {
      fixed = determinateFixedChildren(data, definition, new Set());
    } catch (cause) {
      throw new SchemaError(`${definition.name}: ${errorMessage(cause)}`);
    }
    const checkName = (property: string, operand: string): void => {
      if (!fixed.has(operand)) {
        throw new SchemaError(`${definition.name} ${property} contains unknown fixed child "${operand}"`);
      }
    };
    for (const [trigger, dependencies] of Object.entries(definition.dependentRequired ?? {})) {
      checkName("dependentrequired", trigger);
      for (const dependency of dependencies) checkName("dependentrequired", dependency);
    }
    for (const [property, groups] of [
      ["mutuallyexclusive", definition.mutuallyExclusive ?? []],
      ["exactlyone", definition.exactlyOne ?? []],
    ] as const) {
      for (const group of groups) {
        for (const operand of group) checkName(property, operand);
      }
    }
  }
  if (definition.uniqueItems !== undefined && (!resolved || kind !== "array")) {
    throw new SchemaError(`${definition.name} uniqueitems requires an effective array`);
  }
  if (resolved && kind === "collection") {
    let hasItemConstraint: boolean;
    try {
      hasItemConstraint = hasCollectionItemConstraint(data, definition, new Set());
    } catch (cause) {
      throw new SchemaError(`${definition.name}: ${errorMessage(cause)}`);
    }
    if (!hasItemConstraint) {
      throw new SchemaError(`${definition.name} effective collection must define at least one itemtype`);
    }
  }
  if (definition.condition && (!resolved || (kind !== "table" && kind !== "collection"))) {
    throw new SchemaError(
      `${definition.name} conditional selector requires compatible table or collection branches`,
    );
  }
  for (const child of Object.values(definition.children)) {
    validateDefinitionSemantics(data, child);
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function validateReferences(data: SchemaData, definitions: Readonly<Record<string, RawDefinition>>): void {
  for (const definition of Object.values(definitions)) {
    const references: (string | undefined)[] = [
      definition.reference,
      definition.itemReference,
      ...(definition.items ?? []),
      ...(definition.oneOf ?? []),
      ...(definition.anyOf ?? []),
      ...(definition.condition ? [definition.thenReference, definition.elseReference] : []),
      ...(definition.allOf ?? []),
    ];
    for (const reference of references) {
      if (!reference) continue;
      if (isBuiltIn(reference)) continue;
      if (!Object.hasOwn(data.types, reference)) {
        throw new SchemaError(`${definition.name} contains unknown type reference: ${reference}`);
      }
    }
    validateReferences(data, definition.children);
  }
}

export function validateSelectorCycles(data: SchemaData): void {
  const visited = new Set<string>();
  for (const typeName of Object.keys(data.types)) {
    validateSelectorCycle(data, typeName, new Set(), visited);
  }
}

function validateSelectorCycle(
  data: SchemaData,
  typeName: string,
  visiting: Set<string>,
  visited: Set<string>,
): void {
  if (isBuiltIn(typeName) || visited.has(typeName)) return;
  if (visiting.has(typeName)) {
    throw new SchemaError(`cyclic type selector reference involving types.${typeName}`);
  }
  const definition = data.types[typeName];
  if (!definition) return;
  visiting.add(typeName);
  const references: (string | undefined)[] = [
    definition.reference,
    ...(definition.oneOf ?? []),
    ...(definition.anyOf ?? []),
    ...(definition.condition ? [definition.thenReference, definition.elseReference] : []),
    ...(definition.allOf ?? []),
  ];
  for (const reference of references) {
    if (reference) validateSelectorCycle(data, reference, visiting, visited);
  }
  visiting.delete(typeName);
  visited.add(typeName);
}

export function validateArrayRanges(data: SchemaData): void {
  const validateDefinition = (definition: RawDefinition): void => {
    if (definition.typeName === "array" && (definition.min !== undefined || definition.max !== undefined)) {
      let itemResult: EffectiveKindResult;
      try {
        itemResult = resolveItemKind(data, definition.itemReference, new Set());
      } catch (cause) {
        throw new SchemaError(`${definition.name} has invalid itemtype: ${errorMessage(cause)}`);
      }
      if (!itemResult.resolved || !isRangeComparable(itemResult.kind)) {
        throw new SchemaError(
          `${definition.name} can only define min or max when itemtype resolves to one comparable built-in type`,
        );
      }
      const itemType = itemResult.kind as SchemaType;
      if (definition.min !== undefined && !boundaryMatchesType(definition.min, itemType)) {
        throw new SchemaError(`${definition.name} min must be comparable with ${itemType}`);
      }
      if (definition.max !== undefined && !boundaryMatchesType(definition.max, itemType)) {
        throw new SchemaError(`${definition.name} max must be comparable with ${itemType}`);
      }
      validateOrderedRange(definition.name, definition.min, definition.max, itemType);
    }
    for (const child of Object.values(definition.children)) validateDefinition(child);
  };
  for (const definitions of [data.types, data.elements]) {
    for (const definition of Object.values(definitions)) validateDefinition(definition);
  }
}

export function validateAllowedValueTypes(data: SchemaData): void {
  const validateDefinition = (definition: RawDefinition): void => {
    const allowedValues = definition.allowedValues ?? [];
    if (allowedValues.length > 0) {
      const permittedTypes = new Set<SchemaType>();
      if (definition.typeName === "array") {
        if (definition.itemReference) {
          collectReferenceTypes(data, definition.itemReference, new Set(), permittedTypes);
        }
      } else if (definition.typeName !== undefined) {
        permittedTypes.add(definition.typeName);
      }
      allowedValues.forEach((value, index) => {
        const matches =
          permittedTypes.size === 0 || [...permittedTypes].some((typeName) => isType(value, typeName));
        if (!matches) {
          throw new SchemaError(
            `${definition.name} allowedvalues[${index}] does not match the permitted TOML type`,
          );
        }
      });
    }
    for (const child of Object.values(definition.children)) validateDefinition(child);
  };
  for (const definitions of [data.types, data.elements]) {
    for (const definition of Object.values(definitions)) validateDefinition(definition);
  }
}

/* -------------------------------------------------------------------------- */
/* Effective annotation resolution (description / deprecated / default)       */
/* -------------------------------------------------------------------------- */

export function effectiveDescription(
  data: SchemaData,
  definition: RawDefinition,
  visiting: Set<string>,
): string | undefined {
  if (definition.description) return definition.description;
  const reference = definition.reference;
  if (!reference || isBuiltIn(reference) || visiting.has(reference)) return undefined;
  const target = data.types[reference];
  if (!target) return undefined;
  visiting.add(reference);
  try {
    return effectiveDescription(data, target, visiting);
  } finally {
    visiting.delete(reference);
  }
}

export function effectiveDeprecated(
  data: SchemaData,
  definition: RawDefinition,
  visiting: Set<string>,
): boolean {
  if (definition.deprecated) return true;
  const references = [...(definition.allOf ?? []), ...(definition.reference ? [definition.reference] : [])];
  for (const reference of references) {
    if (isBuiltIn(reference) || visiting.has(reference)) continue;
    const target = data.types[reference];
    if (!target) continue;
    visiting.add(reference);
    let deprecated: boolean;
    try {
      deprecated = effectiveDeprecated(data, target, visiting);
    } finally {
      visiting.delete(reference);
    }
    if (deprecated) return true;
  }
  return false;
}

export function effectiveDefault(
  data: SchemaData,
  definition: RawDefinition,
  visiting: Set<string>,
): { value: TomlValue | undefined; found: boolean } {
  if (definition.hasDefault) return { value: definition.defaultValue, found: true };
  let value: TomlValue | undefined;
  let found = false;
  const references = definition.reference
    ? [definition.reference, ...(definition.allOf ?? [])]
    : [...(definition.allOf ?? [])];
  for (const reference of references) {
    if (isBuiltIn(reference)) continue;
    if (visiting.has(reference)) throw new SchemaError(`cyclic default reference: ${reference}`);
    const target = data.types[reference];
    if (!target) continue;
    visiting.add(reference);
    let candidate: { value: TomlValue | undefined; found: boolean };
    try {
      candidate = effectiveDefault(data, target, visiting);
    } finally {
      visiting.delete(reference);
    }
    if (!candidate.found) continue;
    if (found && !valuesEqual(value, candidate.value)) {
      throw new SchemaError(`${definition.name} has conflicting inherited defaults`);
    }
    value = candidate.value;
    found = true;
  }
  return { value, found };
}

/**
 * `validateDefaultValue` is injected by the document validator to break the
 * mutual dependency between schema-load-time default validation and the
 * document-validation engine (which itself needs `effectiveKind` et al.).
 */
export type DefaultValueValidator = (definition: RawDefinition, value: TomlValue) => string | undefined;

export function validateDefaults(data: SchemaData, validateValue: DefaultValueValidator): void {
  const validateDefinition = (definition: RawDefinition): void => {
    const { value, found } = effectiveDefault(data, definition, new Set());
    if (found) {
      const error = validateValue(definition, value as TomlValue);
      if (error !== undefined) {
        throw new SchemaError(`${definition.name} default is invalid: ${error}`);
      }
    }
    for (const child of Object.values(definition.children)) validateDefinition(child);
  };
  for (const definitions of [data.types, data.elements]) {
    for (const definition of Object.values(definitions)) validateDefinition(definition);
  }
}

/* -------------------------------------------------------------------------- */
/* Effective-annotation resolution for the public Definition accessors        */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the full effective annotation tree (description/deprecated/default,
 * and reference/allof/union/conditional flattening for direct child lookups)
 * for a definition, guarding against re-entering a definition already being
 * expanded (legal self-referential recursion through children).
 */
export class AnnotationResolver {
  readonly #data: SchemaData;
  readonly #resolveReferenceValue: (definition: RawDefinition) => RawDefinition;
  readonly #visiting = new Set<string>();
  readonly #resolved = new Map<string, RawDefinition>();

  constructor(data: SchemaData, resolveReferenceValue: (definition: RawDefinition) => RawDefinition) {
    this.#data = data;
    this.#resolveReferenceValue = resolveReferenceValue;
  }

  resolve(definition: RawDefinition): RawDefinition {
    return this.resolveInternal(definition).definition;
  }

  private resolveInternal(definition: RawDefinition): { definition: RawDefinition; complete: boolean } {
    const key = `${definition.name}\u0000${definition.reference ?? ""}`;
    const cached = this.#resolved.get(key);
    if (cached) return { definition: cached, complete: true };
    let effective = this.annotate(definition);
    if (this.#visiting.has(key)) return { definition: effective, complete: false };
    this.#visiting.add(key);
    let complete = true;
    const children = emptyRecord<RawDefinition>();
    for (const [name, child] of Object.entries(effective.children)) {
      const resolvedChild = this.resolveInternal(child);
      complete = complete && resolvedChild.complete;
      children[name] = resolvedChild.definition;
    }
    effective = { ...effective, children };
    this.#visiting.delete(key);
    if (complete) this.#resolved.set(key, effective);
    return { definition: effective, complete };
  }

  private annotate(definition: RawDefinition): RawDefinition {
    let resolved = definition;
    try {
      resolved = this.#resolveReferenceValue(definition);
    } catch {
      // Fall through with the original definition, mirroring Go's `if err == nil`.
    }
    let result = resolved;
    try {
      const { value, found } = effectiveDefault(this.#data, definition, new Set());
      if (found) result = cloneDefinition(result, { defaultValue: value, hasDefault: true });
    } catch {
      // Ignore; validated separately at schema-load time.
    }
    result = cloneDefinition(result, {
      deprecated: effectiveDeprecated(this.#data, definition, new Set()),
    });
    if (!result.description) {
      result = cloneDefinition(result, {
        description: effectiveDescription(this.#data, definition, new Set()),
      });
    }
    return result;
  }
}

export { isBuiltIn };
