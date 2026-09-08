/**
 * Schema tokens — sources that have no runtime class (AD-1, AD-17).
 *
 * `Pick(User, …)` needs `User` to exist at runtime. Prisma models are generated
 * types; Drizzle and Kysely schemas are objects. A token stands in, and feeds
 * the same descriptor every back-end reads — so a non-class source still gets
 * projection, OpenAPI, and the write drop list.
 */

import type { ClassLike, FieldKind, FieldMeta, Provenance, RelationMeta, SchemaAdapter, TypeDescriptor } from './types.js';
import { NO_PROVENANCE } from './types.js';

export const SCHEMA: unique symbol = Symbol.for('@nestjs-automapper/schema');

/** One field's declaration. Provenance flags are optional here and defaulted. */
export interface FieldSpec extends Partial<Provenance> {
  readonly type: FieldKind;
  readonly nullable?: boolean;
  readonly enumValues?: readonly unknown[];
  readonly nativeName?: string;
}

export interface RelationSpec {
  readonly target: () => TypeToken;
  readonly kind: 'one' | 'many';
  readonly nullable?: boolean;
  readonly joinColumns?: readonly string[];
}

export type SchemaSpec = Record<string, FieldSpec>;

/** Maps a declared field kind to the TypeScript type it produces. */
type TsType<K extends FieldKind> = K extends 'string'
  ? string
  : K extends 'number'
    ? number
    : K extends 'boolean'
      ? boolean
      : K extends 'date'
        ? Date
        : K extends 'enum'
          ? string | number
          : unknown;

/** The object shape a spec describes, with nullability applied. */
export type ShapeOf<S extends SchemaSpec> = {
  -readonly [K in keyof S]: S[K]['nullable'] extends true
    ? TsType<S[K]['type']> | null
    : TsType<S[K]['type']>;
};

export interface SchemaToken<T = unknown> {
  readonly name: string;
  readonly [SCHEMA]: { fields: FieldMeta[]; relations: RelationMeta[] };
  /** Phantom. Carries the shape for inference; never read at runtime. */
  readonly __shape?: T;
}

/** A mapping source: a class, or a token standing in for one. */
export type TypeToken<T = unknown> = ClassLike<T> | SchemaToken<T>;

export function isSchemaToken(type: unknown): type is SchemaToken {
  return typeof type === 'object' && type !== null && SCHEMA in type;
}

/**
 * Declares a source that has no runtime class.
 *
 * ```ts
 * export const PrismaUser = defineSchema('PrismaUser', {
 *   id:        { type: 'string', isPrimary: true, isGenerated: true },
 *   email:     { type: 'string' },
 *   createdAt: { type: 'date', isCreateDate: true },
 * });
 *
 * class ReadUserDto extends Pick(PrismaUser, ['id', 'email']) {}
 * ```
 */
export function defineSchema<S extends SchemaSpec>(
  name: string,
  fields: S,
  relations: Record<string, RelationSpec> = {},
): SchemaToken<ShapeOf<S>> {
  return {
    name,
    [SCHEMA]: {
      fields: Object.entries(fields).map(([key, spec]) => toFieldMeta(key, spec)),
      relations: Object.entries(relations).map(([key, spec]) => ({
        name: key,
        target: spec.target,
        kind: spec.kind,
        nullable: spec.nullable ?? true,
        ...(spec.joinColumns ? { joinColumns: spec.joinColumns } : {}),
      })),
    },
  };
}

function toFieldMeta(name: string, spec: FieldSpec): FieldMeta {
  // Provenance stays complete: a partially-populated flag set is how a
  // generated column leaks onto the write path (AD-14).
  const provenance: Provenance = {
    ...NO_PROVENANCE,
    isPrimary: spec.isPrimary ?? false,
    isGenerated: spec.isGenerated ?? false,
    isCreateDate: spec.isCreateDate ?? false,
    isUpdateDate: spec.isUpdateDate ?? false,
    isDeleteDate: spec.isDeleteDate ?? false,
    isVersion: spec.isVersion ?? false,
    isDiscriminator: spec.isDiscriminator ?? false,
    hasDefault: spec.hasDefault ?? false,
    isSelectByDefault: spec.isSelectByDefault ?? true,
  };

  return {
    name,
    type: spec.type,
    nullable: spec.nullable ?? false,
    provenance,
    ...(spec.nativeName ? { nativeName: spec.nativeName } : {}),
    ...(spec.enumValues ? { enumValues: spec.enumValues } : {}),
  };
}

/** Built-in adapter for tokens. Imports nothing, so AD-6 does not apply. */
export const schemaAdapter: SchemaAdapter = {
  name: 'schema',
  supports: isSchemaToken,
  describe: (type): TypeDescriptor => {
    const token = type as unknown as SchemaToken;
    return {
      type,
      fields: token[SCHEMA].fields,
      relations: token[SCHEMA].relations,
      producedBy: 'schema',
    };
  },
};
