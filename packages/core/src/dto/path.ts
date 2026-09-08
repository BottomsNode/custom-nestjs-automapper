/**
 * Typed source paths (CAP-10). Dotted at the API surface only — the planner
 * lowers them to `PathSegment[]` before they reach the IR (AD-12).
 */

import type { ClassLike } from '../descriptor/types.js';

/** Values a path may terminate on. */
type Terminal = string | number | boolean | bigint | symbol | Date | null | undefined;

/**
 * Every addressable dotted path on `T`, as a union of string literals.
 *
 * A typo is therefore a compile error, and TypeScript volunteers the correction
 * — `'firstNmae'` reports `Did you mean '"firstName"'?` with no work from us.
 */
export type Path<T> = {
  [K in keyof T & string]: NonNullable<T[K]> extends Terminal
    ? K
    : NonNullable<T[K]> extends readonly (infer E)[]
      ? K | `${K}.${number}` | `${K}.${number}.${Path<NonNullable<E>>}`
      : K | `${K}.${Path<NonNullable<T[K]>>}`;
}[keyof T & string];

/**
 * A resolved path segment. Produced by the planner, consumed by back-ends,
 * which never parse, split, or join a path string (AD-12).
 */
export type PathSegment =
  | { readonly kind: 'field'; readonly name: string }
  | { readonly kind: 'relation'; readonly name: string; readonly target: ClassLike }
  | { readonly kind: 'index' }
  /** Terminal for projection: select `name`, never descend into `interior`. */
  | { readonly kind: 'json'; readonly name: string; readonly interior: readonly string[] };

/** The only separator. A property whose name contains `.` is not addressable in 2.0. */
export const PATH_SEPARATOR = '.';
