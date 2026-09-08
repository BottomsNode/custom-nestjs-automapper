/**
 * Resolvers. A resolver IS the declaration of a derived field (AD-19.4): one
 * declaration supplies both the static type and the runtime resolution, so a
 * field is never named twice.
 */

import type { Path } from './path.js';

export type ResolverKind = 'auto' | 'from' | 'compute' | 'resolve' | 'constant' | 'ignore' | 'gated';

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
  /** Phantom carriers. Never read at runtime. */
  readonly __out?: Out;
  readonly __async?: Async;
}

export type AnyResolver = Resolver<never, unknown, boolean>;

/** Copy by convention. Explicit — there is no implicit auto-mapping. */
export function auto<Src, Out>(name: Path<Src>): Resolver<Src, Out, false> {
  return { kind: 'auto', deps: [name], fn: (s) => (s as Record<string, unknown>)[name as string] };
}

/** Rename, or read a nested source path. */
export function from<Src, Out>(path: Path<Src>): Resolver<Src, Out, false> {
  return {
    kind: 'from',
    deps: [path],
    fn: (s) => readPath(s, path as string),
  };
}

/**
 * A derived field. `deps` are declared, not inferred: a lambda is opaque, and
 * projection must know which source columns feed the field or it under-fetches
 * silently. Proxy tracing and `fn.toString()` parsing were both rejected —
 * they under-collect across branches and break under minification.
 */
export function compute<Src, Out>(
  deps: readonly Path<Src>[],
  fn: (source: Src) => Out,
): Resolver<Src, Out, false> {
  return { kind: 'compute', deps: deps as readonly string[], fn: fn as (s: Src) => unknown };
}

/** An async derived field. Unwraps to `Awaited<Out>` and brands the plan async. */
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

export function constant<Src, Out>(value: Out): Resolver<Src, Out, false> {
  return { kind: 'constant', deps: [], fn: () => value, constant: value };
}

export function ignore<Src>(): Resolver<Src, never, false> {
  return { kind: 'ignore', deps: [], fn: () => undefined } as unknown as Resolver<Src, never, false>;
}

/**
 * Context gate. Widens the result to `Out | undefined`, so the DTO's declared
 * type stays honest and gating a required field is a type error rather than a
 * runtime surprise.
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

/** Reads a dotted path. API-surface only — the IR uses `PathSegment[]` (AD-12). */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
