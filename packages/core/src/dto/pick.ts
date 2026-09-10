/**
 * DTO construction (AD-19). `Pick`/`extend` return real runtime classes.
 *
 * The constructor assigns every declared key: without that, a presence check
 * against the destination is always false and every mapping yields `{}` —
 * the v1 defect.
 */

import type { AnySource, ClassLike, Instantiable } from '../descriptor/types.js';
import type { AnyResolver, Resolver } from './resolver.js';

/** Runtime field registry: picked ∪ computed keys, in declaration order. */
export const FIELDS: unique symbol = Symbol.for('@nestjs-automapper/fields');
/** Resolvers by destination field name, reachable at runtime with their deps. */
export const RESOLVERS: unique symbol = Symbol.for('@nestjs-automapper/resolvers');
/** The class this DTO derives from — the source it is declared against (AD-16). */
export const SOURCE: unique symbol = Symbol.for('@nestjs-automapper/source');
/** Write-direction marker. The planner enforces the drop list on these. */
export const WRITE: unique symbol = Symbol.for('@nestjs-automapper/write');

export interface DtoStatics {
  readonly [FIELDS]: readonly string[];
  readonly [RESOLVERS]: Readonly<Record<string, AnyResolver>>;
  readonly [SOURCE]: AnySource | undefined;
  readonly [WRITE]?: true;
}

/** A DTO class: constructible, plus the runtime registry the planner reads. */
export type DtoClass<T> = Instantiable<T> & DtoStatics;

/**
 * Declares a read DTO carrying a subset of `Base`'s fields.
 *
 * Returns a real class: extend it with a class declaration. Picked fields are
 * copied by name and checked against the schema when the mapper seals.
 *
 * @param Base - An entity class, or a token from `defineSchema()`.
 * @param keys - The fields to carry. A key the source does not declare is a compile error.
 *
 * @example
 * ```ts
 * export class UserDto extends Pick(User, ['id', 'email', 'createdAt']) {}
 * ```
 *
 * @remarks
 * Declare `class X extends Pick(...)`. The `const X = Pick(...)` plus
 * `type X = InstanceType<typeof X>` form makes TypeScript widen the DTO back
 * to every field of the source.
 */
export function Pick<T, const K extends readonly (keyof T & string)[]>(
  Base: ClassLike<T> | { readonly name: string; readonly __shape?: T },
  keys: K,
): DtoClass<Pick<T, K[number]>> {
  // Naming this `Pick` does not shadow the built-in `Pick<T, K>`: value and
  // type namespaces are separate, so the return type above can use it.
  //
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

/**
 * Declares a write DTO: the fields a client may send.
 *
 * Like `Pick`, with two checks added:
 * - Declaring a field the database owns (primary key, generated column,
 *   create/update/delete timestamp, version, discriminator) fails `seal()`.
 * - `mapper.mapInput()` and the NestJS `MapBodyPipe` reject any request key
 *   the DTO does not declare.
 *
 * `select: false` columns such as `password` are writable.
 *
 * @example
 * ```ts
 * export class CreateUserDto extends Write(User, ['email', 'password', 'firstName']) {}
 * ```
 */
export function Write<T, const K extends readonly (keyof T & string)[]>(
  Base: ClassLike<T> | { readonly name: string; readonly __shape?: T },
  keys: K,
): DtoClass<Pick<T, K[number]>> {
  const dto = Pick(Base, keys);
  Object.defineProperty(dto, WRITE, { value: true, enumerable: false });
  return dto;
}

/** True for DTOs built with `Write`. */
export function isWriteDto(type: unknown): boolean {
  return (type as Partial<DtoStatics>)?.[WRITE] === true;
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
 * Adds derived fields to a `Pick` or `Write` DTO.
 *
 * Each resolver declares its field once: its output type becomes the field's
 * type, and its function produces the value. Give resolvers their source and
 * output types explicitly (`compute<User, string>`). That is what makes the
 * dependency paths type-checked.
 *
 * @example
 * ```ts
 * export class UserDto extends extend(Pick(User, ['id', 'email']), {
 *   fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
 *   posts: collection<User, PostDto>(() => PostDto),
 * }) {}
 * ```
 *
 * @remarks
 * A DTO with any `resolve()` field is async. Map it with `mapAsync()`, because
 * calling `map()` on it is a type error.
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
  if (isWriteDto(Base)) Object.defineProperty(Extended, WRITE, { value: true, enumerable: false });

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
  source: AnySource | undefined,
): DtoClass<T> {
  Object.defineProperty(ctor, FIELDS, { value: Object.freeze(fields), enumerable: false });
  Object.defineProperty(ctor, RESOLVERS, { value: Object.freeze(resolvers), enumerable: false });
  Object.defineProperty(ctor, SOURCE, { value: source, enumerable: false });
  return ctor as DtoClass<T>;
}
