/**
 * Direction policy (AD-14). Adapters report provenance; only this decides what
 * it means. Changing a table is a core change, never an adapter's.
 */

import type { FieldMeta, Provenance } from './descriptor/types.js';

/** Provenance flags that make a field database-owned, with the reason shown in errors. */
const WRITE_DROP: ReadonlyArray<readonly [keyof Provenance, string]> = [
  ['isPrimary', 'primary key'],
  ['isGenerated', 'generated'],
  ['isCreateDate', 'create timestamp'],
  ['isUpdateDate', 'update timestamp'],
  ['isDeleteDate', 'delete timestamp'],
  ['isVersion', 'version column'],
  ['isDiscriminator', 'discriminator'],
];

/**
 * Why a field may not be supplied on the write path, or undefined if it may.
 *
 * `isSelectByDefault === false` is deliberately absent: that is the `password`
 * case, which is hidden on read and required on write.
 */
export function writeDropReason(field: FieldMeta): string | undefined {
  return WRITE_DROP.find(([flag]) => field.provenance[flag])?.[1];
}

/** Fields a client may supply. */
export function writableFields(fields: readonly FieldMeta[]): FieldMeta[] {
  return fields.filter((f) => writeDropReason(f) === undefined);
}

/** Excluded from `auto()` and implicit expansion on the read path, but still nameable. */
export function isHiddenOnRead(field: FieldMeta): boolean {
  return field.provenance.isSelectByDefault === false;
}
