/**
 * Resolvers. A resolver IS the declaration of a derived field (AD-19.4): one
 * declaration supplies both the static type and the runtime resolution, so a
 * field is never named twice.
 */

import type { Path } from './path.js';

export type ResolverKind =
  | 'auto'
  | 'from'
  | 'compute'
  | 'resolve'
  | 'constant'
  | 'ignore'
  | 'gated'
  | 'nested'
  | 'collection';

/**
 * `Out` is the mapped field's type. `Async` brands the resolver, and the brand
 * propagates to the DTO so that synchronously mapping an async DTO is a
 * compile error rather than a runtime throw (AD-9).
 */
export interface Resolver<Src, Out, Async extends boolean = false> {
  readonly kind: ResolverKind;
  /** Declared source paths. Required — never inferred (SPEC constraint). */
  readonly deps: readonly string[];
  readonly fn: (source: Src) => unknown;
  /** A gate wraps its child; a gate is never a flag on another node (AD-2). */
  readonly child?: Resolver<Src, unknown, boolean>;
  readonly predicate?: (ctx: unknown) => boolean;
  readonly constant?: unknown;
  /** Destination DTO for a relation. Lazy, so circular DTO imports resolve. */
  readonly target?: () => unknown;
  /** Phantom carriers. Never read at runtime. */
  readonly __out?: Out;
  readonly __async?: Async;
}

export type AnyResolver = Resolver<never, unknown, boolean>;

/**
 * Copies the source field `name`. `Pick` already copies picked fields, so this
 * is only needed inside `extend`.
 */
export function auto<Src, Out>(name: Path<Src>): Resolver<Src, Out, false> {
  return { kind: 'auto', deps: [name], fn: (s) => (s as Record<string, unknown>)[name as string] };
}

/**
 * Reads a source field under a different name, or follows a dotted path.
 *
 * @example
 * ```ts
 * city: from<User, string>('address.city'),
 * ```
 */
export function from<Src, Out>(path: Path<Src>): Resolver<Src, Out, false> {
  return {
    kind: 'from',
    deps: [path],
    fn: (s) => readPath(s, path as string),
  };
}

/**
 * A field computed from other source fields.
 *
 * `deps` must list every source path `fn` reads. Projection fetches exactly
 * those columns, so a missing dep means `fn` runs on data that was never
 * loaded. The paths are type-checked against `Src`.
 *
 * @typeParam Src - The source entity.
 * @typeParam Out - The field's type.
 *
 * @example
 * ```ts
 * fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
 * ```
 */
export function compute<Src, Out>(
  deps: readonly Path<Src>[],
  fn: (source: Src) => Out,
): Resolver<Src, Out, false> {
  // Declared, not inferred: a lambda is opaque. Proxy tracing and
  // `fn.toString()` parsing were rejected — they under-collect across branches
  // and break under minification.
  return { kind: 'compute', deps: deps as readonly string[], fn: fn as (s: Src) => unknown };
}

/**
 * An async computed field. The field's type is the awaited value.
 *
 * The DTO becomes async: map it with `mapAsync()` or `mapArrayAsync()`.
 * Calling `map()` on it is a type error.
 *
 * @example
 * ```ts
 * avatarUrl: resolve<User, string>(['id'], (u) => storage.signedUrl(u.id)),
 * ```
 */
export function resolve<Src, Out>(
  deps: readonly Path<Src>[],
  fn: (source: Src) => Promise<Out>,
): Resolver<Src, Awaited<Out>, true> {
  return {
    kind: 'resolve',
    deps: deps as readonly string[],
    fn: fn as (s: Src) => unknown,
  } as Resolver<Src, Awaited<Out>, true>;
}

/** The same fixed value on every mapped object. */
export function constant<Src, Out>(value: Out): Resolver<Src, Out, false> {
  return { kind: 'constant', deps: [], fn: () => value, constant: value };
}

/** Leaves the field unmapped on purpose, so the mapper does not report it as unresolved. */
export function ignore<Src>(): Resolver<Src, never, false> {
  return { kind: 'ignore', deps: [], fn: () => undefined } as unknown as Resolver<Src, never, false>;
}

/**
 * Includes the field only when `predicate` passes for the context given at map
 * time. Otherwise it is `undefined`, so the field's type is `Out | undefined`.
 *
 * Projection needs the context too. `projectionFor(Dto)` without `{ ctx }`
 * throws `CONTEXT_REQUIRED` rather than fetching every gated column.
 *
 * @example
 * ```ts
 * email: visible<User, string, false>(
 *   (ctx: { isAdmin: boolean }) => ctx.isAdmin,
 *   from<User, string>('email'),
 * ),
 *
 * mapper.map(user, UserDto, { ctx: { isAdmin: true } });
 * ```
 */
export function visible<Src, Out, Async extends boolean>(
  predicate: (ctx: never) => boolean,
  inner: Resolver<Src, Out, Async>,
): Resolver<Src, Out | undefined, Async> {
  return {
    kind: 'gated',
    deps: inner.deps,
    fn: inner.fn,
    child: inner as Resolver<Src, unknown, boolean>,
    predicate: predicate as (ctx: unknown) => boolean,
  } as Resolver<Src, Out | undefined, Async>;
}

/**
 * Uses `fallback` when the inner resolver yields `null` or `undefined`, and
 * removes `null | undefined` from the field's type.
 *
 * @example
 * ```ts
 * avatarUrl: defaultTo(from<User, string | null>('avatarUrl'), '/static/avatar.png'),
 * ```
 */
export function defaultTo<Src, Out, A extends boolean>(
  inner: Resolver<Src, Out, A>,
  fallback: NonNullable<Out>,
): Resolver<Src, NonNullable<Out>, A> {
  // Composes into a compute rather than adding a node kind, so no back-end has
  // to learn about it (AD-2).
  return {
    kind: inner.kind === 'resolve' ? 'resolve' : 'compute',
    deps: inner.deps,
    fn: (source: Src) => {
      const value = inner.fn(source);
      if (value instanceof Promise) return value.then((v) => v ?? fallback);
      return value ?? fallback;
    },
  } as Resolver<Src, NonNullable<Out>, A>;
}

/**
 * A to-one relation, mapped with the `target` DTO.
 *
 * Reads the source field with the same name; pass `path` when it differs. The
 * target DTO is registered automatically when the mapper seals, and cycles and
 * shared references are handled.
 *
 * `target` is a function so DTOs can reference each other. A DTO that
 * references itself needs the return type annotated:
 * `nested<Category, unknown>((): unknown => CategoryDto)`.
 *
 * @example
 * ```ts
 * author: nested<Post, AuthorDto>(() => AuthorDto),
 * ```
 */
export function nested<Src, Out>(
  target: () => unknown,
  path?: Path<Src>,
): Resolver<Src, Out | undefined, false> {
  return {
    kind: 'nested',
    deps: path ? [path] : [],
    fn: () => undefined,
    target,
  } as Resolver<Src, Out | undefined, false>;
}

/**
 * A to-many relation, each element mapped with the `target` DTO. A missing
 * relation maps to `[]`. See `nested()` for how `target` and `path` work.
 *
 * @example
 * ```ts
 * posts: collection<User, PostSummaryDto>(() => PostSummaryDto),
 * ```
 */
export function collection<Src, Out>(
  target: () => unknown,
  path?: Path<Src>,
): Resolver<Src, Out[], false> {
  return {
    kind: 'collection',
    deps: path ? [path] : [],
    fn: () => undefined,
    target,
  } as Resolver<Src, Out[], false>;
}

/** Reads a dotted path. API-surface only — the IR uses `PathSegment[]` (AD-12). */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
