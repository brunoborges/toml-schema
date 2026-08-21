import { normalizeReference, parseSchemaType, type SchemaType } from "./builtins.js";
import {
  cloneDefinition,
  emptyRecord,
  mergeDependentRequired,
  type Condition,
  type RawDefinition,
} from "./definition.js";
import { DiagnosticCodes, type DiagnosticCode, type DiagnosticPhase } from "./diagnostics.js";
import { SchemaError } from "./errors.js";
import { isValidStringFormat } from "./formats.js";
import { appendPath } from "./paths.js";
import {
  effectiveKind,
  type SchemaData,
} from "./semantics.js";
import {
  compareValues,
  isTomlTable,
  isType,
  scalarLength,
  typeNameOf,
  valuesEqual,
  type TomlTable,
  type TomlValue,
} from "./values.js";

export type Severity = "error" | "warning";

/** A single validation error or warning, addressed to a document path such as `$.a.b[2]`. */
export interface ValidationError {
  readonly phase: DiagnosticPhase;
  readonly severity: Severity;
  readonly code: string;
  readonly path: string;
  readonly schemaPath?: string | undefined;
  readonly message: string;
}

export type Diagnostic = ValidationError;

/** Builds the schema path `def.schemaPath + "." + prop`, or `undefined` when the definition has none. */
function sp(definition: RawDefinition, prop: string): string | undefined {
  return definition.schemaPath !== undefined ? `${definition.schemaPath}.${prop}` : undefined;
}

/**
 * The outcome of validating a document (or a single value) against a schema.
 * `errors` are the hard failures that make the document invalid; `warnings`
 * (for example, `deprecated` usage) do not. `diagnostics` is the concatenation
 * of both, in `errors` then `warnings` order.
 */
export class ValidationResult {
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly Diagnostic[];
  readonly diagnostics: readonly Diagnostic[];

  constructor(errors: readonly ValidationError[], warnings: readonly Diagnostic[]) {
    this.errors = errors;
    this.warnings = warnings;
    this.diagnostics = [...errors, ...warnings];
  }

  /** Whether the document is valid, i.e. has no errors (warnings are permitted). */
  get valid(): boolean {
    return this.errors.length === 0;
  }

  /** Method form of {@link ValidationResult.valid}, for idiomatic call-site use (`result.isValid()`). */
  isValid(): boolean {
    return this.valid;
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Removes diagnostics that are identical under the SPEC.md dedup identity
 * `(code, instance_path, schema_path)`; message text does not participate, and an
 * absent path compares equal to an absent path.
 */
function dedupeDiagnostics<T extends Diagnostic>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const diagnostic of list) {
    const key = `${diagnostic.code}\u0000${diagnostic.path}\u0000${diagnostic.schemaPath ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}

function conditionMatches(table: TomlTable, condition: Condition): boolean {
  if (!(condition.key in table)) return false;
  const value = table[condition.key];
  if (condition.hasEquals) return valuesEqual(condition.equals, value);
  return condition.in.some((candidate) => valuesEqual(candidate, value));
}

function presentGroupMembers(table: TomlTable, group: readonly string[]): string[] {
  return group.filter((name) => name in table);
}

interface CompositionParts {
  structural: RawDefinition[];
  unions: RawDefinition[];
  conditionals: RawDefinition[];
}

/**
 * Validates a parsed TOML document (or a single value) against a loaded
 * schema's definitions. This is an internal engine; construct it only via
 * {@link Schema.validate}/{@link Schema.validateFile}.
 */
export class DocumentValidator {
  readonly #data: SchemaData;
  readonly #suppressWarnings: boolean;
  readonly errors: ValidationError[] = [];
  readonly warnings: Diagnostic[] = [];

  constructor(data: SchemaData, suppressWarnings = false) {
    this.#data = data;
    this.#suppressWarnings = suppressWarnings;
  }

  toResult(): ValidationResult {
    return new ValidationResult(dedupeDiagnostics(this.errors), dedupeDiagnostics(this.warnings));
  }

  validateTable(path: string, table: TomlTable, definitions: Readonly<Record<string, RawDefinition>>): void {
    for (const [key, definition] of Object.entries(definitions)) {
      let resolved: RawDefinition;
      try {
        resolved = this.resolve(definition, new Set());
      } catch (cause) {
        this.addCause(appendPath(path, key), cause);
        continue;
      }
      const value = table[key];
      const childPath = appendPath(path, key);
      if (value === undefined) {
        if (!resolved.optional)
          this.add(DiagnosticCodes.MISSING_REQUIRED, childPath, definition.schemaPath, "required value is missing");
        continue;
      }
      this.validateValue(childPath, value, resolved);
    }
  }

  validateValue(path: string, value: TomlValue, definition: RawDefinition): void {
    const candidate = new DocumentValidator(this.#data, this.#suppressWarnings);
    candidate.validateValueInternal(path, value, definition);
    this.errors.push(...candidate.errors);
    if (candidate.errors.length === 0) this.appendWarnings(candidate.warnings);
  }

  private validateValueInternal(path: string, value: TomlValue, definition: RawDefinition): void {
    let resolved: RawDefinition;
    try {
      resolved = this.resolve(definition, new Set());
    } catch (cause) {
      this.addCause(path, cause);
      return;
    }
    if (resolved.condition) {
      this.validateConditional(path, value, resolved);
    } else if ((resolved.oneOf?.length ?? 0) > 0 || (resolved.anyOf?.length ?? 0) > 0) {
      this.validateUnion(path, value, resolved);
    } else if ((resolved.allOf?.length ?? 0) > 0) {
      this.validateAllOf(path, value, resolved);
    } else {
      this.validatePlainValue(path, value, resolved);
    }
    if (this.errors.length === 0 && resolved.deprecated) {
      this.warn(path, DiagnosticCodes.DEPRECATED, sp(resolved, "deprecated"), "value is deprecated");
    }
  }

  private validateConditional(path: string, value: TomlValue, definition: RawDefinition): void {
    let reference = definition.elseReference ?? "";
    if (isTomlTable(value) && conditionMatches(value, definition.condition as Condition)) {
      reference = definition.thenReference ?? "";
    }
    let branch: RawDefinition;
    try {
      branch = this.resolveReference(reference, new Set());
    } catch (cause) {
      this.addCause(path, cause);
      return;
    }
    branch = cloneDefinition(branch, { allOf: [...(branch.allOf ?? []), ...(definition.allOf ?? [])] });
    this.validateValue(path, value, branch);
  }

  private validatePlainValue(path: string, value: TomlValue, definition: RawDefinition): void {
    const typeName = definition.typeName ?? "any";
    this.validateType(path, value, typeName, sp(definition, "type"));
    if (!isType(value, typeName)) return;
    this.validateCommonConstraints(path, value, definition);
    switch (typeName) {
      case "table":
        this.validateTableValue(path, value as TomlTable, definition);
        break;
      case "collection":
        this.validateCollection(path, value as TomlTable, definition);
        break;
      case "array":
        this.validateArray(path, value as TomlValue[], definition);
        break;
      default:
        break;
    }
  }

  private validateUnion(path: string, value: TomlValue, definition: RawDefinition): void {
    const alternatives = definition.oneOf?.length ? definition.oneOf : (definition.anyOf ?? []);
    let matches = 0;
    const successes: DocumentValidator[] = [];
    for (const reference of alternatives) {
      let referenced: RawDefinition;
      try {
        referenced = this.resolveReference(reference, new Set());
      } catch (cause) {
        this.addCause(path, cause);
        return;
      }
      referenced = cloneDefinition(referenced, {
        allOf: [...(referenced.allOf ?? []), ...(definition.allOf ?? [])],
        dependentRequired: mergeDependentRequired(referenced.dependentRequired, definition.dependentRequired),
        mutuallyExclusive: [...(referenced.mutuallyExclusive ?? []), ...(definition.mutuallyExclusive ?? [])],
        exactlyOne: [...(referenced.exactlyOne ?? []), ...(definition.exactlyOne ?? [])],
        ...(definition.uniqueItems !== undefined ? { uniqueItems: definition.uniqueItems } : {}),
      });
      const candidate = new DocumentValidator(this.#data, this.#suppressWarnings);
      candidate.validateValue(path, value, referenced);
      if (candidate.errors.length === 0) {
        matches++;
        successes.push(candidate);
      }
    }
    if ((definition.oneOf?.length ?? 0) > 0) {
      if (matches !== 1) {
        this.add(DiagnosticCodes.ONEOF, path, sp(definition, "oneof"), `expected exactly one matching type from oneof but found ${matches}`);
      } else {
        this.appendWarnings(successes[0]?.warnings ?? []);
      }
    }
    if ((definition.anyOf?.length ?? 0) > 0) {
      if (matches === 0) {
        this.add(DiagnosticCodes.ANYOF, path, sp(definition, "anyof"), "expected at least one matching type from anyof");
      } else {
        for (const candidate of successes) this.appendWarnings(candidate.warnings);
      }
    }
  }

  private validateAllOf(path: string, value: TomlValue, definition: RawDefinition): void {
    let kind: SchemaType | undefined;
    let resolved: boolean;
    try {
      ({ kind, resolved } = effectiveKind(this.#data, definition, new Set()));
    } catch (cause) {
      this.addCause(path, cause);
      return;
    }
    if (!resolved) {
      this.add(DiagnosticCodes.INCOMPATIBLE_COMPOSITION, path, sp(definition, "allof"), "allof has no determinate effective kind");
      return;
    }
    if (kind === "table" || kind === "collection") {
      this.validateComposedStructure(path, value, kind, definition, undefined);
      return;
    }
    const local = cloneDefinition(definition, { allOf: [] });
    this.validatePlainValue(path, value, local);
    for (const reference of definition.allOf ?? []) {
      let component: RawDefinition;
      try {
        component = this.resolveReference(reference, new Set());
      } catch (cause) {
        this.addCause(path, cause);
        continue;
      }
      this.validateValue(path, value, component);
    }
  }

  private compositionParts(definition: RawDefinition, visiting: Set<string>): CompositionParts {
    const resolved = this.resolve(definition, new Set());
    const references = resolved.allOf ?? [];
    const withoutAllOf = cloneDefinition(resolved, { allOf: [] });
    const parts: CompositionParts = { structural: [], unions: [], conditionals: [] };
    if (withoutAllOf.condition) parts.conditionals.push(withoutAllOf);
    else if ((withoutAllOf.oneOf?.length ?? 0) > 0 || (withoutAllOf.anyOf?.length ?? 0) > 0) {
      parts.unions.push(withoutAllOf);
    } else parts.structural.push(withoutAllOf);
    for (const reference of references) {
      if (visiting.has(reference)) {
        throw new SchemaError(`cyclic composition reference: ${reference}`);
      }
      visiting.add(reference);
      let nested: CompositionParts;
      try {
        const component = this.resolveReference(reference, new Set());
        nested = this.compositionParts(component, visiting);
      } finally {
        visiting.delete(reference);
      }
      parts.structural.push(...nested.structural);
      parts.unions.push(...nested.unions);
      parts.conditionals.push(...nested.conditionals);
    }
    return parts;
  }

  private validateComposedStructure(
    path: string,
    value: TomlValue,
    kind: SchemaType,
    definition: RawDefinition,
    inheritedKeys: ReadonlySet<string> | undefined,
  ): void {
    if (
      definition.typeName === undefined &&
      !definition.reference &&
      (definition.oneOf?.length ?? 0) === 0 &&
      (definition.anyOf?.length ?? 0) === 0 &&
      !definition.condition
    ) {
      definition = cloneDefinition(definition, { typeName: kind });
    }
    let parts: CompositionParts;
    try {
      parts = this.compositionParts(definition, new Set());
    } catch (cause) {
      this.addCause(path, cause);
      return;
    }
    this.validateComposedParts(path, value, kind, parts, inheritedKeys);
  }

  private validateComposedParts(
    path: string,
    value: TomlValue,
    kind: SchemaType,
    parts: CompositionParts,
    inheritedKeys: ReadonlySet<string> | undefined,
  ): void {
    if (!isTomlTable(value)) {
      this.validateType(path, value, kind, undefined);
      return;
    }
    const table = value;
    const children = new Map<string, RawDefinition[]>();
    let hasFixedStructure = (inheritedKeys?.size ?? 0) > 0;
    for (const component of parts.structural) {
      if (component.typeName !== kind) {
        this.add(DiagnosticCodes.TYPE_MISMATCH, path, sp(component, "type"), `expected ${kind} component but found ${component.typeName}`);
        continue;
      }
      if (Object.keys(component.children).length > 0) hasFixedStructure = true;
      for (const [name, child] of Object.entries(component.children)) {
        children.set(name, [...(children.get(name) ?? []), child]);
      }
    }
    const knownKeys = new Set<string>(inheritedKeys ?? []);
    for (const name of children.keys()) knownKeys.add(name);

    const unions: RawDefinition[] = [];
    const unionKeySets: Set<string>[] = [];
    for (const union of parts.unions) {
      let alternativeKeys: Set<string>;
      try {
        alternativeKeys = this.effectiveClosureKeys(union, value, new Set());
      } catch (cause) {
        this.addCause(path, cause);
        continue;
      }
      if (alternativeKeys.size > 0) hasFixedStructure = true;
      for (const name of alternativeKeys) knownKeys.add(name);
      unions.push(union);
      unionKeySets.push(alternativeKeys);
    }

    const conditionals: RawDefinition[] = [];
    const conditionalKeySets: Set<string>[] = [];
    for (const conditional of parts.conditionals) {
      let branchKeys: Set<string>;
      try {
        branchKeys = this.effectiveClosureKeys(conditional, value, new Set());
      } catch (cause) {
        this.addCause(path, cause);
        continue;
      }
      if (branchKeys.size > 0) hasFixedStructure = true;
      for (const name of branchKeys) knownKeys.add(name);
      conditionals.push(conditional);
      conditionalKeySets.push(branchKeys);
    }

    const selectorKeys = [...unionKeySets, ...conditionalKeySets];

    for (const [name, definitions] of children) {
      const childPath = appendPath(path, name);
      const childValue = table[name];
      const present = childValue !== undefined;
      for (const child of definitions) {
        let resolved: RawDefinition;
        try {
          resolved = this.resolve(child, new Set());
        } catch (cause) {
          this.addCause(childPath, cause);
          continue;
        }
        if (!present) {
          if (!resolved.optional)
            this.add(DiagnosticCodes.MISSING_REQUIRED, childPath, child.schemaPath, "required value is missing");
          continue;
        }
        this.validateValue(childPath, childValue, child);
      }
    }

    unions.forEach((union, index) => {
      // A branch is closed against the keys contributed by the rest of the
      // composition, but not against the keys exclusive to its sibling
      // alternatives.
      const branchKeys = new Set<string>(inheritedKeys ?? []);
      for (const name of children.keys()) branchKeys.add(name);
      selectorKeys.forEach((keys, otherIndex) => {
        if (otherIndex === index) return;
        for (const name of keys) branchKeys.add(name);
      });
      this.validateComposedUnion(path, value, kind, union, branchKeys);
    });

    conditionals.forEach((conditional, index) => {
      const branchKeys = new Set<string>(inheritedKeys ?? []);
      for (const name of children.keys()) branchKeys.add(name);
      const selectorIndex = unions.length + index;
      selectorKeys.forEach((keys, otherIndex) => {
        if (otherIndex === selectorIndex) return;
        for (const name of keys) branchKeys.add(name);
      });
      this.validateComposedConditional(path, value, kind, conditional, branchKeys);
    });

    for (const component of parts.structural) this.validateSiblingRules(path, table, component);
    for (const union of unions) this.validateSiblingRules(path, table, union);

    if (kind === "table") {
      if (hasFixedStructure) {
        for (const key of Object.keys(table)) {
          if (!knownKeys.has(key)) this.add(DiagnosticCodes.UNKNOWN_KEY, appendPath(path, key), undefined, "unexpected key");
        }
      }
    } else {
      for (const component of parts.structural) {
        let dynamicEntries = 0;
        for (const [key, entry] of Object.entries(table)) {
          if (knownKeys.has(key)) continue;
          dynamicEntries++;
          const childPath = appendPath(path, key);
          if (component.keyPattern && !component.keyPattern.test(key)) {
            this.add(DiagnosticCodes.KEYPATTERN, childPath, sp(component, "keypattern"), `key does not match keypattern ${component.keyPatternSource}`);
          }
          this.validateMemberValueConstraints(childPath, entry, component);
          // A composed collection may take its dynamic-entry constraint
          // entirely from another contributor.
          if (!component.itemReference) continue;
          try {
            const item = this.resolveReference(component.itemReference, new Set());
            this.validateValue(childPath, entry, item);
          } catch (cause) {
            this.addCause(childPath, cause);
          }
        }
        this.validateLength(path, dynamicEntries, component);
      }
    }

    for (const component of parts.structural) {
      if (component.deprecated) this.warn(path, DiagnosticCodes.DEPRECATED, sp(component, "deprecated"), "value is deprecated");
    }
    for (const union of unions) {
      if (union.deprecated) this.warn(path, DiagnosticCodes.DEPRECATED, sp(union, "deprecated"), "value is deprecated");
    }
    for (const conditional of conditionals) {
      if (conditional.deprecated) this.warn(path, DiagnosticCodes.DEPRECATED, sp(conditional, "deprecated"), "value is deprecated");
    }
  }

  private effectiveClosureKeys(
    definition: RawDefinition,
    value: TomlValue,
    visiting: Set<string>,
  ): Set<string> {
    const keys = new Set<string>(Object.keys(definition.children));
    const mergeReference = (reference: string): void => {
      if (parseSchemaType(reference) !== undefined) return;
      if (visiting.has(reference)) {
        throw new SchemaError(`cyclic composition reference: ${reference}`);
      }
      visiting.add(reference);
      try {
        const target = this.resolveReference(reference, new Set());
        for (const name of this.effectiveClosureKeys(target, value, visiting)) keys.add(name);
      } finally {
        visiting.delete(reference);
      }
    };
    if (definition.reference) mergeReference(definition.reference);
    for (const reference of definition.allOf ?? []) mergeReference(reference);
    const alternatives = definition.oneOf?.length ? definition.oneOf : (definition.anyOf ?? []);
    for (const reference of alternatives) mergeReference(reference);
    if (definition.condition) {
      let reference = definition.elseReference ?? "";
      if (isTomlTable(value) && conditionMatches(value, definition.condition)) {
        reference = definition.thenReference ?? "";
      }
      mergeReference(reference);
    }
    return keys;
  }

  /**
   * Selects an alternative of a union contributor against the composed
   * value. Alternatives are validated in isolated validators so a failed
   * branch never leaks its own diagnostics; only the aggregate union outcome
   * is reported.
   */
  private validateComposedUnion(
    path: string,
    value: TomlValue,
    kind: SchemaType,
    definition: RawDefinition,
    knownKeys: ReadonlySet<string>,
  ): void {
    const alternatives = definition.oneOf?.length ? definition.oneOf : (definition.anyOf ?? []);
    let matches = 0;
    const successes: DocumentValidator[] = [];
    for (const reference of alternatives) {
      let alternative: RawDefinition;
      try {
        alternative = this.resolveReference(reference, new Set());
      } catch (cause) {
        this.addCause(path, cause);
        return;
      }
      const candidate = new DocumentValidator(this.#data, this.#suppressWarnings);
      try {
        const { kind: alternativeKind, resolved } = effectiveKind(this.#data, alternative, new Set());
        if (!resolved || alternativeKind !== kind) {
          candidate.add(DiagnosticCodes.TYPE_MISMATCH, path, sp(alternative, "type"), `expected ${kind} alternative but found ${alternativeKind}`);
        } else {
          candidate.validateComposedStructure(path, value, kind, alternative, knownKeys);
        }
      } catch (cause) {
        candidate.addCause(path, cause);
      }
      if (candidate.errors.length === 0) {
        matches++;
        successes.push(candidate);
      }
    }
    if ((definition.oneOf?.length ?? 0) > 0) {
      if (matches !== 1) {
        this.add(DiagnosticCodes.ONEOF, path, sp(definition, "oneof"), `expected exactly one matching type from oneof but found ${matches}`);
        return;
      }
      this.appendWarnings(successes[0]?.warnings ?? []);
      return;
    }
    if (matches === 0) {
      this.add(DiagnosticCodes.ANYOF, path, sp(definition, "anyof"), "expected at least one matching type from anyof");
      return;
    }
    for (const candidate of successes) this.appendWarnings(candidate.warnings);
  }

  private validateComposedConditional(
    path: string,
    value: TomlValue,
    kind: SchemaType,
    definition: RawDefinition,
    knownKeys: ReadonlySet<string>,
  ): void {
    let reference = definition.elseReference ?? "";
    if (isTomlTable(value) && conditionMatches(value, definition.condition as Condition)) {
      reference = definition.thenReference ?? "";
    }
    let branch: RawDefinition;
    try {
      branch = this.resolveReference(reference, new Set());
    } catch (cause) {
      this.addCause(path, cause);
      return;
    }
    try {
      const { kind: branchKind, resolved } = effectiveKind(this.#data, branch, new Set());
      if (!resolved || branchKind !== kind) {
        this.add(DiagnosticCodes.TYPE_MISMATCH, path, sp(branch, "type"), `expected ${kind} conditional branch but found ${branchKind}`);
        return;
      }
      this.validateComposedStructure(path, value, kind, branch, knownKeys);
    } catch (cause) {
      this.addCause(path, cause);
    }
  }

  private validateTableValue(path: string, table: TomlTable, definition: RawDefinition): void {
    if (Object.keys(definition.children).length === 0) return;
    this.validateTable(path, table, definition.children);
    for (const key of Object.keys(table)) {
      if (!Object.hasOwn(definition.children, key))
        this.add(DiagnosticCodes.UNKNOWN_KEY, appendPath(path, key), definition.schemaPath, "unexpected key");
    }
    this.validateSiblingRules(path, table, definition);
  }

  private validateCollection(path: string, table: TomlTable, definition: RawDefinition): void {
    let dynamicEntries = 0;
    for (const [key, value] of Object.entries(table)) {
      const childPath = appendPath(path, key);
      const fixedChild = Object.hasOwn(definition.children, key)
        ? definition.children[key]
        : undefined;
      if (fixedChild !== undefined) {
        this.validateValue(childPath, value, fixedChild);
        continue;
      }
      dynamicEntries++;
      if (definition.keyPattern && !definition.keyPattern.test(key)) {
        this.add(DiagnosticCodes.KEYPATTERN, childPath, sp(definition, "keypattern"), `key does not match keypattern ${definition.keyPatternSource}`);
      }
      if (!definition.itemReference) {
        this.add(DiagnosticCodes.SCHEMA_MALFORMED, childPath, definition.schemaPath, "collection entry has no itemtype reference");
        continue;
      }
      try {
        const referenced = this.resolveReference(definition.itemReference, new Set());
        this.validateValue(childPath, value, referenced);
        this.validateMemberValueConstraints(childPath, value, definition);
      } catch (cause) {
        this.addCause(childPath, cause);
      }
    }
    this.validateLength(path, dynamicEntries, definition);
    for (const [key, child] of Object.entries(definition.children)) {
      let resolved: RawDefinition;
      try {
        resolved = this.resolve(child, new Set());
      } catch (cause) {
        this.addCause(appendPath(path, key), cause);
        continue;
      }
      if (!(key in table) && !resolved.optional) {
        this.add(DiagnosticCodes.MISSING_REQUIRED, appendPath(path, key), child.schemaPath, "required value is missing");
      }
    }
    this.validateSiblingRules(path, table, definition);
  }

  private validateArray(path: string, array: readonly TomlValue[], definition: RawDefinition): void {
    this.validateLength(path, array.length, definition);
    if (definition.uniqueItems) {
      for (let index = 0; index < array.length; index++) {
        for (let previous = 0; previous < index; previous++) {
          if (valuesEqual(array[previous], array[index])) {
            this.add(DiagnosticCodes.UNIQUEITEMS, `${path}[${index}]`, sp(definition, "uniqueitems"), `duplicate item equals item at index ${previous}`);
            break;
          }
        }
      }
    }
    if ((definition.items?.length ?? 0) > 0) {
      this.validateTupleArray(path, array, definition);
      return;
    }
    if (!definition.itemReference) {
      if ((definition.allowedValues?.length ?? 0) === 0) return;
      array.forEach((item, index) => this.validateAllowedValues(`${path}[${index}]`, item, definition));
      return;
    }
    let itemDefinition: RawDefinition;
    try {
      itemDefinition = this.resolveReference(definition.itemReference, new Set());
    } catch (cause) {
      this.addCause(path, cause);
      return;
    }
    array.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      this.validateValue(itemPath, item, itemDefinition);
      this.validateMemberValueConstraints(itemPath, item, definition);
    });
  }

  private validateSiblingRules(path: string, table: TomlTable, definition: RawDefinition): void {
    // dependentrequired is evaluated on direct presence only. A mapping whose
    // trigger is absent never fires, so it cannot be reached through another
    // mapping that merely requires the trigger.
    for (const [trigger, dependencies] of Object.entries(definition.dependentRequired ?? {})) {
      if (!(trigger in table)) continue;
      for (const dependency of dependencies) {
        if (!(dependency in table)) {
          this.add(DiagnosticCodes.DEPENDENTREQUIRED, appendPath(path, dependency), sp(definition, "dependentrequired"), `required by dependentrequired triggered by sibling "${trigger}"`);
        }
      }
    }
    for (const group of definition.mutuallyExclusive ?? []) {
      const present = presentGroupMembers(table, group);
      if (present.length > 1) {
        this.add(DiagnosticCodes.MUTUALLYEXCLUSIVE, path, sp(definition, "mutuallyexclusive"), `mutuallyexclusive group has multiple present members: ${present.join(", ")}`);
      }
    }
    for (const group of definition.exactlyOne ?? []) {
      const present = presentGroupMembers(table, group);
      if (present.length !== 1) {
        this.add(DiagnosticCodes.EXACTLYONE, path, sp(definition, "exactlyone"), `exactlyone group requires exactly one present member from: ${group.join(", ")}`);
      }
    }
  }

  private validateTupleArray(path: string, array: readonly TomlValue[], definition: RawDefinition): void {
    const items = definition.items ?? [];
    if (array.length !== items.length) {
      this.add(DiagnosticCodes.TUPLE_LENGTH, path, sp(definition, "items"), `expected array length ${items.length} but found ${array.length}`);
    }
    const upperBound = Math.min(array.length, items.length);
    for (let index = 0; index < upperBound; index++) {
      const itemPath = `${path}[${index}]`;
      let itemDefinition: RawDefinition;
      try {
        itemDefinition = this.resolveReference(items[index] as string, new Set());
      } catch (cause) {
        this.addCause(itemPath, cause);
        continue;
      }
      this.validateValue(itemPath, array[index] as TomlValue, itemDefinition);
    }
  }

  private validateType(
    path: string,
    value: TomlValue,
    typeName: SchemaType,
    schemaPath: string | undefined,
  ): void {
    if (!isType(value, typeName)) {
      this.add(DiagnosticCodes.TYPE_MISMATCH, path, schemaPath, `expected ${typeName} but found ${typeNameOf(value)}`);
    }
  }

  private validateCommonConstraints(path: string, value: TomlValue, definition: RawDefinition): void {
    if (Array.isArray(value)) {
      this.validateLength(path, value.length, definition);
      return;
    }
    if (isTomlTable(value) && definition.typeName === "collection") return;
    this.validateAllowedValues(path, value, definition);
    if ((definition.allowedValues?.length ?? 0) > 0) return;
    this.validateRange(path, value, definition);
    if (typeof value === "string") {
      this.validateLength(path, scalarLength(value), definition);
      if (definition.pattern && !definition.pattern.test(value)) {
        this.add(DiagnosticCodes.PATTERN, path, sp(definition, "pattern"), `does not match pattern ${definition.patternSource}`);
      }
      if (definition.format && !isValidStringFormat(definition.format, value)) {
        this.add(DiagnosticCodes.FORMAT, path, sp(definition, "format"), `is not a valid ${definition.format}`);
      }
    }
  }

  private validateAllowedValues(path: string, value: TomlValue, definition: RawDefinition): void {
    const allowedValues = definition.allowedValues ?? [];
    if (allowedValues.length === 0) return;
    if (allowedValues.some((allowed) => valuesEqual(allowed, value))) return;
    this.add(DiagnosticCodes.ALLOWEDVALUES, path, sp(definition, "allowedvalues"), "value is not in allowedvalues");
  }

  private validateMemberValueConstraints(path: string, value: TomlValue, definition: RawDefinition): void {
    this.validateAllowedValues(path, value, definition);
    if ((definition.allowedValues?.length ?? 0) === 0) this.validateRange(path, value, definition);
    if (typeof value === "string") {
      if (definition.pattern && !definition.pattern.test(value)) {
        this.add(DiagnosticCodes.PATTERN, path, sp(definition, "pattern"), `does not match pattern ${definition.patternSource}`);
      }
      if (definition.format && !isValidStringFormat(definition.format, value)) {
        this.add(DiagnosticCodes.FORMAT, path, sp(definition, "format"), `is not a valid ${definition.format}`);
      }
    }
  }

  private validateRange(path: string, value: TomlValue, definition: RawDefinition): void {
    if (definition.min !== undefined) {
      try {
        if (compareValues(value, definition.min) < 0)
          this.add(DiagnosticCodes.MIN, path, sp(definition, "min"), "value is less than min");
      } catch (cause) {
        this.add(DiagnosticCodes.MIN, path, sp(definition, "min"), errorMessage(cause));
      }
    }
    if (definition.max !== undefined) {
      try {
        if (compareValues(value, definition.max) > 0)
          this.add(DiagnosticCodes.MAX, path, sp(definition, "max"), "value is greater than max");
      } catch (cause) {
        this.add(DiagnosticCodes.MAX, path, sp(definition, "max"), errorMessage(cause));
      }
    }
  }

  private validateLength(path: string, length: number, definition: RawDefinition): void {
    if (definition.minLength !== undefined && length < definition.minLength) {
      this.add(DiagnosticCodes.MINLENGTH, path, sp(definition, "minlength"), "length is less than minlength");
    }
    if (definition.maxLength !== undefined && length > definition.maxLength) {
      this.add(DiagnosticCodes.MAXLENGTH, path, sp(definition, "maxlength"), "length is greater than maxlength");
    }
  }

  resolve(definition: RawDefinition, seenReferences: Set<string>): RawDefinition {
    if (!definition.reference) return definition;
    const referenced = this.resolveReference(definition.reference, seenReferences);
    return cloneDefinition(referenced, {
      name: definition.name,
      ...(definition.description ? { description: definition.description } : {}),
      optional: definition.optional || referenced.optional,
      allOf: [...(referenced.allOf ?? []), ...(definition.allOf ?? [])],
      dependentRequired: mergeDependentRequired(referenced.dependentRequired, definition.dependentRequired),
      mutuallyExclusive: [...(referenced.mutuallyExclusive ?? []), ...(definition.mutuallyExclusive ?? [])],
      exactlyOne: [...(referenced.exactlyOne ?? []), ...(definition.exactlyOne ?? [])],
      ...(definition.uniqueItems !== undefined ? { uniqueItems: definition.uniqueItems } : {}),
      ...(definition.hasDefault
        ? { defaultValue: definition.defaultValue, hasDefault: true }
        : {}),
      deprecated: definition.deprecated || referenced.deprecated,
    });
  }

  resolveReference(reference: string, seenReferences: Set<string>): RawDefinition {
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
    if (seenReferences.has(normalized)) {
      throw new SchemaError(`cyclic type reference: ${normalized}`);
    }
    const definition = this.#data.types[normalized];
    if (!definition) {
      throw new SchemaError(`unknown type reference: ${reference}`);
    }
    seenReferences.add(normalized);
    try {
      return this.resolve(definition, seenReferences);
    } finally {
      seenReferences.delete(normalized);
    }
  }

  add(code: DiagnosticCode, path: string, schemaPath: string | undefined, message: string): void {
    this.errors.push({
      phase: "validation",
      severity: "error",
      code,
      path,
      ...(schemaPath !== undefined ? { schemaPath } : {}),
      message,
    });
  }

  /**
   * Reports a failure that surfaced as a thrown {@link SchemaError} during
   * validation, preserving the error's structured code and schema path. Such
   * failures denote a schema defect that escaped schema-load and are unreachable
   * for the checked-in corpus, but must still carry a registry code.
   */
  private addCause(path: string, cause: unknown): void {
    if (cause instanceof SchemaError) {
      this.add(cause.code as DiagnosticCode, path, cause.schemaPath, cause.message);
    } else {
      this.add(DiagnosticCodes.SCHEMA_MALFORMED, path, undefined, errorMessage(cause));
    }
  }

  private warn(path: string, code: DiagnosticCode, schemaPath: string | undefined, message: string): void {
    if (this.#suppressWarnings) return;
    this.appendWarnings([
      {
        phase: "validation",
        severity: "warning",
        code,
        path,
        ...(schemaPath !== undefined ? { schemaPath } : {}),
        message,
      },
    ]);
  }

  private appendWarnings(warnings: readonly Diagnostic[]): void {
    for (const warning of warnings) {
      const duplicate = this.warnings.some(
        (existing) =>
          existing.code === warning.code &&
          existing.path === warning.path &&
          (existing.schemaPath ?? "") === (warning.schemaPath ?? ""),
      );
      if (!duplicate) this.warnings.push(warning);
    }
  }
}
