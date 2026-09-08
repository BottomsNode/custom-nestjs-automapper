/**
 * The DTO construction contract (AD-19).
 *
 * `Pick` and `extend` return a REAL runtime class. That is what gives a DTO a
 * descriptor without decorators and without a transformer plugin — and it is
 * the fix for the v1 defect, where a DTO's fields existed only in the type
 * system, a presence check against the destination was always false, and every
 * mapping silently produced an empty object.
 *
 * Verified identical on the TypeScript 6.x and 7.x lines.
 */

import type { ClassLike, Instantiable } from '../descriptor/types.js';
import type { AnyResolver, Resolver } from './resolver.js';

/** Runtime field registry: picked ∪ computed keys, in declaration order. */
export const FIELDS: unique symbol = Symbol.for('@nestjs-automapper/fields');
/** Resolvers by destination field name, reachable at runtime with their deps. */
export const RESOLVERS: unique symbol = Symbol.for('@nestjs-automapper/resolvers');
/** The class this DTO derives from — the source it is declared against (AD-16). */
export const SOURCE: unique symbol = Symbol.for('@nestjs-automapper/source');

export interface DtoStatics {
  readonly [FIELDS]: readonly string[];
  readonly [RESOLVERS]: Readonly<Record<string, AnyResolver>>;
  readonly [SOURCE]: ClassLike | undefined;
}

/** A DTO class: constructible, plus the runtime registry the planner reads. */
export type DtoClass<T> = Instantiable<T> & DtoStatics;

/**
 * Declare a DTO carrying a subset of `Base`'s fields.
 *
 * Naming this `Pick` does not shadow TypeScript's built-in `Pick<T, K>` — value
 * and type namespaces are separate, which is why the return type below can use
 * the built-in inside a function of the same name.
 */
export function Pick<T, const K extends readonly (keyof T & string)[]>(
  Base: ClassLike<T>,
  keys: K,
): DtoClass<Pick<T, K[number]>> {
  // `const K` over the tuple, rather than `K extends keyof T & string` over the
  // element: with the element form, calling Pick inline as an argument resolves
  // K before T and falls back to K's constraint — `keyof T` — which readmits
  // every source field. It only behaved correctly when assigned to a variable
  // first, which is exactly the kind of bug that survives review.
  const declared: readonly string[] = [...keys];

  class Picked {
    constructor() {
      // AD-19.2, non-negotiable: assign EVERY declared key so instances carry
      // real own-properties. Omitting this reproduces the v1 empty-object bug,
      // and it is why AD-18 forbids `delete` as an "omit" implementation.
      for (const key of declared) {
        (this as Record<string, unknown>)[key] = undefined;
      }
    }
  }

  Object.defineProperty(Picked, 'name', { value: `Pick(${Base.name})` });
  return attach(Picked as Instantiable<Pick<T, K[number]>>, declared, {}, Base);
}

type ResolvedShape<R> = {
  [K in keyof R]: R[K] extends Resolver<never, infer Out, boolean> ? Out : never;
};

type AnyAsync<R> = true extends {
  [K in keyof R]: R[K] extends Resolver<never, unknown, true> ? true : false;
}[keyof R]
  ? true
  : false;

/** A DTO carrying an async resolver: `map()` on it is a compile error (AD-9). */
export type AsyncBrand<A extends boolean> = { readonly __async: A };

/**
 * Attach derived fields to a DTO. Each resolver is the field's single
 * declaration site — its return type becomes the field's static type, and its
 * function becomes the runtime resolution (AD-19.4).
 */
export function extend<
  // Inferred from the concrete class, then narrowed with InstanceType. Inferring
  // a bare `B` positionally out of `DtoClass<B>` widens it — the intersection in
  // DtoClass gives inference two candidates and it picks the loose one, which
  // silently readmits source fields that were deliberately not picked.
  TBase extends Instantiable<object> & DtoStatics,
  // `Record<keyof R, …>` rather than `Record<string, …>`: the latter widens R to
  // carry a string index signature, making every key readable on the result.
  R extends Record<keyof R, Resolver<never, unknown, boolean>>,
>(
  Base: TBase,
  resolvers: R,
): DtoClass<InstanceType<TBase> & ResolvedShape<R>> & AsyncBrand<AnyAsync<R>> {
  const added = Object.keys(resolvers);
  const declared = [...Base[FIELDS], ...added];

  // A generic parameter's instance type cannot be extended directly (TS2509),
  // so widen to a constructor with statically known members before subclassing.
  const BaseCtor = Base as unknown as new () => Record<string, unknown>;

  class Extended extends BaseCtor {
    constructor() {
      super();
      for (const key of added) {
        (this as Record<string, unknown>)[key] = undefined;
      }
    }
  }

  Object.defineProperty(Extended, 'name', { value: Base.name });

  return attach(
    Extended as unknown as Instantiable<InstanceType<TBase> & ResolvedShape<R>>,
    declared,
    { ...Base[RESOLVERS], ...(resolvers as unknown as Record<string, AnyResolver>) },
    Base[SOURCE],
  ) as DtoClass<InstanceType<TBase> & ResolvedShape<R>> & AsyncBrand<AnyAsync<R>>;
}

/** True when `type` was produced by `Pick`/`extend` — the built-in adapter's predicate (AD-17). */
export function isDtoClass(type: unknown): type is DtoClass<unknown> {
  return typeof type === 'function' && Array.isArray((type as Partial<DtoStatics>)[FIELDS]);
}

function attach<T>(
  ctor: Instantiable<T>,
  fields: readonly string[],
  resolvers: Readonly<Record<string, AnyResolver>>,
  source: ClassLike | undefined,
): DtoClass<T> {
  Object.defineProperty(ctor, FIELDS, { value: Object.freeze(fields), enumerable: false });
  Object.defineProperty(ctor, RESOLVERS, { value: Object.freeze(resolvers), enumerable: false });
  Object.defineProperty(ctor, SOURCE, { value: source, enumerable: false });
  return ctor as DtoClass<T>;
}
