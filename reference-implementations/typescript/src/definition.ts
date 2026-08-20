import type { SchemaType } from "./builtins.js";
import type { StringFormat } from "./formats.js";
import type { TomlValue } from "./values.js";

/** A parsed `if` selector: `{ key = "...", equals = ... }` or `{ key = "...", in = [...] }`. */
export interface Condition {
  readonly key: string;
  readonly hasEquals: boolean;
  readonly equals?: TomlValue | undefined;
  readonly in: readonly TomlValue[];
}

/**
 * The internal, mutable-at-parse-time representation of a single schema
 * definition node (an element, a named type, or a nested child). This
 * mirrors the Go reference implementation's `Definition` struct field for
 * field; the public, read-only `Definition` class wraps a resolved instance
 * of this shape for consumers.
 */
export interface RawDefinition {
  name: string;
  typeName?: SchemaType | undefined;
  reference?: string | undefined;
  description?: string | undefined;
  itemReference?: string | undefined;
  items?: readonly string[] | undefined;
  optional: boolean;
  allowedValues?: readonly TomlValue[] | undefined;
  pattern?: RegExp | undefined;
  patternSource?: string | undefined;
  format?: StringFormat | undefined;
  keyPattern?: RegExp | undefined;
  keyPatternSource?: string | undefined;
  min?: TomlValue | undefined;
  max?: TomlValue | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  oneOf?: readonly string[] | undefined;
  anyOf?: readonly string[] | undefined;
  condition?: Condition | undefined;
  thenReference?: string | undefined;
  elseReference?: string | undefined;
  allOf?: readonly string[] | undefined;
  dependentRequired?: Readonly<Record<string, readonly string[]>> | undefined;
  mutuallyExclusive?: readonly (readonly string[])[] | undefined;
  exactlyOne?: readonly (readonly string[])[] | undefined;
  uniqueItems?: boolean | undefined;
  defaultValue?: TomlValue | undefined;
  hasDefault: boolean;
  deprecated: boolean;
  children: Readonly<Record<string, RawDefinition>>;
}

/** Creates a string-keyed record without inherited Object prototype members. */
export function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Returns a shallow clone of `definition` with `overrides` applied. */
export function cloneDefinition(
  definition: RawDefinition,
  overrides: Partial<RawDefinition> = {},
): RawDefinition {
  return { ...definition, ...overrides };
}

/** Merges two dependentrequired maps (used when composing/resolving references). */
export function mergeDependentRequired(
  left: Readonly<Record<string, readonly string[]>> | undefined,
  right: Readonly<Record<string, readonly string[]>> | undefined,
): Record<string, readonly string[]> | undefined {
  if (!left && !right) return undefined;
  const merged = emptyRecord<string[]>();
  for (const [trigger, dependencies] of Object.entries(left ?? {})) {
    merged[trigger] = [...(merged[trigger] ?? []), ...dependencies];
  }
  for (const [trigger, dependencies] of Object.entries(right ?? {})) {
    merged[trigger] = [...(merged[trigger] ?? []), ...dependencies];
  }
  return merged;
}

/**
 * Public, read-only accessor over a resolved schema definition node.
 *
 * Instances are returned by {@link Schema.element}, {@link Schema.type}, and
 * {@link Definition.child}, always with inherited/effective annotations
 * (`description`, `deprecated`, `default`) already resolved through
 * references and `allof` composition.
 */
export class Definition {
  readonly #raw: RawDefinition;

  /** @internal */
  constructor(raw: RawDefinition) {
    this.#raw = raw;
  }

  /** @internal */
  get raw(): RawDefinition {
    return this.#raw;
  }

  /** The definition's simple name (its key within its parent table). */
  get name(): string {
    return this.#raw.name;
  }

  /** The effective `description`, inherited from a named type reference if unset locally. */
  get description(): string | undefined {
    return this.#raw.description;
  }

  /** The effective `deprecated` flag, propagated through references and `allof`. */
  get deprecated(): boolean {
    return this.#raw.deprecated;
  }

  /** Whether this definition declares an effective, non-materializing `default`. */
  hasDefault(): boolean {
    return this.#raw.hasDefault;
  }

  /** The effective `default` value, or `undefined` if none is declared. */
  default(): TomlValue | undefined {
    return this.#raw.defaultValue;
  }

  /** Whether the parent may omit this value. */
  get optional(): boolean {
    return this.#raw.optional;
  }

  /** Looks up a fixed child definition by name (for `table`/`collection` kinds). */
  child(name: string): Definition | undefined {
    const child = this.#raw.children[name];
    return child ? new Definition(child) : undefined;
  }

  /** Lists the names of all fixed child definitions. */
  childNames(): string[] {
    return Object.keys(this.#raw.children);
  }
}
