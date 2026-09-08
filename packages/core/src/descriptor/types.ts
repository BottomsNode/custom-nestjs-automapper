/**
 * The metadata contract. Front-ends (schema adapters) produce these; the
 * planner is their only consumer (AD-1).
 */

/*
 * `any[]` for the parameter list is deliberate and load-bearing, not laziness.
 * With `never[]`, these fail to match `InstanceType`'s own constraint
 * (`abstract new (...args: any) => any`), so `InstanceType<typeof SomeDto>`
 * silently resolves to `any` and every downstream type assertion passes
 * vacuously. The compile-time test suite catches this; nothing else does.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ClassLike<T = unknown> = abstract new (...args: any[]) => T;
export type Instantiable<T = unknown> = new (...args: any[]) => T;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type FieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'json'
  | 'enum'
  | 'unknown';

/**
 * Provenance flags.
 *
 * AD-14: every flag is REQUIRED, not optional. An adapter that cannot
 * determine one must set it explicitly to `false`, so that "unknown" can never
 * be silently read as "no" — which is how a future adapter would otherwise
 * under-populate the write drop list and leak a generated column.
 */
export interface Provenance {
  readonly isPrimary: boolean;
  readonly isGenerated: boolean;
  readonly isCreateDate: boolean;
  readonly isUpdateDate: boolean;
  readonly isDeleteDate: boolean;
  readonly isVersion: boolean;
  readonly isDiscriminator: boolean;
  readonly hasDefault: boolean;
  /**
   * Whether the column is selected by default.
   *
   * Named for what it means rather than TypeORM's `isSelect`, which reads as a
   * double negative in this context. `false` is the `password` case: excluded
   * from `auto()` and implicit expansion, still reachable by naming it, and
   * explicitly NOT a write-drop reason (AD-14).
   */
  readonly isSelectByDefault: boolean;
}

export interface FieldMeta {
  /** The class property name, verbatim. Never a transform of the DB name (AD-15). */
  readonly name: string;
  /** The database name. Exists only for adapter translation and did-you-mean (AD-15). */
  readonly nativeName?: string;
  readonly type: FieldKind;
  readonly nullable: boolean;
  readonly enumValues?: readonly unknown[];
  readonly provenance: Provenance;
}

export interface RelationMeta {
  readonly name: string;
  /** Lazy, so circular entity imports resolve. */
  readonly target: () => ClassLike;
  readonly kind: 'one' | 'many';
  readonly nullable: boolean;
  /** Foreign key columns — what a write-side reversal maps to (CAP-8). */
  readonly joinColumns?: readonly string[];
}

export interface TypeDescriptor {
  readonly type: ClassLike;
  readonly fields: readonly FieldMeta[];
  readonly relations: readonly RelationMeta[];
  /** Adapter name, surfaced in diagnostics (AD-5). */
  readonly producedBy: string;
}

/**
 * Neutral selection tree. `core` emits this and never an ORM-native shape
 * (AD-10); only adapters translate.
 *
 * `fields: []` means EXACTLY NONE. `all: true` is the explicit escape hatch —
 * the empty array is never overloaded to mean "everything".
 */
export interface FieldSelection {
  readonly fields: readonly string[];
  readonly relations: Readonly<Record<string, FieldSelection>>;
  readonly all?: true;
}

/**
 * The port. `supports()` must be a pure, non-throwing predicate: no I/O, and
 * an adapter that cannot answer returns `false` (AD-17).
 */
export interface SchemaAdapter {
  readonly name: string;
  supports(type: ClassLike): boolean;
  describe(type: ClassLike): TypeDescriptor;
  toNativeProjection?(selection: FieldSelection, type: ClassLike): unknown;
}

/** Every flag false — the base an adapter overrides for what it can determine. */
export const NO_PROVENANCE: Provenance = Object.freeze({
  isPrimary: false,
  isGenerated: false,
  isCreateDate: false,
  isUpdateDate: false,
  isDeleteDate: false,
  isVersion: false,
  isDiscriminator: false,
  hasDefault: false,
  isSelectByDefault: true,
});
