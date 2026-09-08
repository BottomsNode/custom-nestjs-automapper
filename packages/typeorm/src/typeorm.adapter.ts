/**
 * TypeORM schema adapter (AD-1, AD-14).
 *
 * `describe()` returns everything the schema declares and applies no policy:
 * filtering here would make `password` unmappable, and a private drop list
 * would leak a generated column. Verified against typeorm@1.1.1.
 */

import type {
  ClassLike,
  FieldKind,
  FieldMeta,
  FieldSelection,
  Provenance,
  RelationMeta,
  SchemaAdapter,
  TypeDescriptor,
} from '@nestjs-automapper/core';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';
import type { EntityMetadata } from 'typeorm/metadata/EntityMetadata.js';
import type { RelationMetadata } from 'typeorm/metadata/RelationMetadata.js';
import type { DataSource } from 'typeorm';

export const ADAPTER_NAME = 'typeorm';

/** TypeORM find options, as far as this adapter produces them. */
export interface TypeOrmProjection {
  readonly select: Record<string, unknown>;
  readonly relations?: Record<string, unknown>;
}

export function typeorm(dataSource: DataSource): SchemaAdapter {
  return {
    name: ADAPTER_NAME,

    // AD-17: pure and non-throwing. `hasMetadata` is the only honest answer
    // here — anything that queries or throws breaks arbitration.
    supports: (type: ClassLike): boolean => {
      try {
        return dataSource.hasMetadata(type as never);
      } catch {
        return false;
      }
    },

    describe: (type: ClassLike): TypeDescriptor => {
      const meta = dataSource.getMetadata(type as never);
      return {
        type,
        fields: meta.columns.map(toFieldMeta),
        relations: meta.relations.map(toRelationMeta),
        producedBy: ADAPTER_NAME,
      };
    },

    toNativeProjection: (selection: FieldSelection, type: ClassLike): TypeOrmProjection =>
      toFindOptions(selection, dataSource.getMetadata(type as never).primaryColumns.map((c) => c.propertyName)),
  };
}

/**
 * Every provenance flag is set explicitly (AD-14). `false` must mean "checked
 * and no", never "not looked at" — otherwise a future adapter under-populates
 * the write drop list and a generated column leaks into a create DTO.
 */
function toProvenance(column: ColumnMetadata): Provenance {
  return {
    isPrimary: column.isPrimary === true,
    isGenerated: column.isGenerated === true,
    isCreateDate: column.isCreateDate === true,
    isUpdateDate: column.isUpdateDate === true,
    isDeleteDate: column.isDeleteDate === true,
    isVersion: column.isVersion === true,
    isDiscriminator: column.isDiscriminator === true,
    hasDefault: column.default !== undefined,
    // Named for what it means. TypeORM's `isSelect` reads as a double negative
    // in this context, and this is the `password` case: excluded from implicit
    // expansion, still reachable by name, never a write-drop reason.
    isSelectByDefault: column.isSelect !== false,
  };
}

function toFieldMeta(column: ColumnMetadata): FieldMeta {
  const enumValues = column.enum as readonly unknown[] | undefined;
  return {
    // AD-15: the class property name, verbatim. Never a transform of the
    // database name — naming-convention conversion is this adapter's job on
    // the way out, never on the way in.
    name: column.propertyName,
    nativeName: column.databaseName,
    type: toFieldKind(column),
    nullable: column.isNullable === true,
    provenance: toProvenance(column),
    ...(enumValues && enumValues.length > 0 ? { enumValues } : {}),
  };
}

function toRelationMeta(relation: RelationMetadata): RelationMeta {
  const joinColumns = relation.joinColumns?.map((c) => c.databaseName) ?? [];
  return {
    name: relation.propertyName,
    // Lazy, so circular entity imports resolve.
    target: () => resolveTarget(relation),
    kind: relation.isOneToMany || relation.isManyToMany ? 'many' : 'one',
    nullable: relation.isNullable === true,
    ...(joinColumns.length > 0 ? { joinColumns } : {}),
  };
}

function resolveTarget(relation: RelationMetadata): ClassLike {
  const inverse = relation.inverseEntityMetadata as EntityMetadata | undefined;
  const target = inverse?.target;
  if (typeof target === 'function') return target as ClassLike;
  throw new Error(
    `typeorm adapter: relation '${relation.propertyName}' has no class target ` +
      `(entity schemas defined as objects are not supported)`,
  );
}

/**
 * TypeORM's own type tokens are wide: a constructor, a string, or an object.
 * Only the coarse category matters here — a back-end needs to know that a
 * column is json (so its path terminates) or an enum (so OpenAPI can list the
 * values), not its exact SQL type.
 */
function toFieldKind(column: ColumnMetadata): FieldKind {
  if (column.enum !== undefined) return 'enum';

  const type = column.type;
  if (type === String || type === 'varchar' || type === 'text' || type === 'char') return 'string';
  if (type === Number || type === 'int' || type === 'integer' || type === 'float') return 'number';
  if (type === Boolean || type === 'boolean' || type === 'bool') return 'boolean';
  if (type === Date || type === 'timestamp' || type === 'date' || type === 'datetime') return 'date';
  if (type === 'json' || type === 'jsonb' || type === 'simple-json') return 'json';

  const name = typeof type === 'string' ? type : '';
  if (name.includes('char') || name.includes('text')) return 'string';
  if (name.includes('int') || name.includes('decimal') || name.includes('numeric')) return 'number';
  if (name.includes('timestamp') || name.includes('date') || name.includes('time')) return 'date';
  if (name.includes('json')) return 'json';

  return 'unknown';
}

/**
 * Neutral selection → TypeORM find options. This translation is the whole
 * reason `core` stays zero-dependency: it knows nothing about `select` or
 * `relations`, and a second ORM is a second function like this one.
 */
export function toFindOptions(
  selection: FieldSelection,
  primaryKeys: readonly string[] = [],
): TypeOrmProjection {
  const select: Record<string, unknown> = {};
  for (const field of selection.fields) select[field] = true;

  // TypeORM needs the primary key to hydrate relations and to dedupe rows, so
  // it is added here rather than in the neutral selection — core reports what
  // the DTO consumes, the adapter adds what the ORM requires.
  for (const key of primaryKeys) select[key] = true;

  const relations: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(selection.relations)) {
    const nested = toFindOptions(child);
    // TypeORM nests a relation's columns inside `select` under the relation
    // name, and declares the join separately in `relations`.
    select[name] = nested.select;
    relations[name] = nested.relations ?? true;
  }

  return Object.keys(relations).length > 0 ? { select, relations } : { select };
}
