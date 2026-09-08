// SPIKE: does Pick()/extend() + const+type declaration merging actually work?
// Must prove: runtime-real class, correct type inference, async branding,
// visible() widening, typed dep paths, instanceof, usable as a DI token.

export const FIELDS = Symbol.for('nam.fields');

type ClassLike<T = any> = new (...a: any[]) => T;

// ---------- typed source paths (CAP-10) ----------
type Prim = string | number | boolean | Date | null | undefined;
export type Path<T> = {
  [K in keyof T & string]: T[K] extends Prim ? K : K | `${K}.${Path<T[K]>}`;
}[keyof T & string];

// ---------- resolvers ----------
export interface Resolver<S, R, A extends boolean = false> {
  readonly kind: string;
  readonly deps: readonly string[];
  readonly fn: (s: S) => any;
  readonly __out?: R;
  readonly __async?: A;
}

export function compute<S, R>(deps: readonly Path<S>[], fn: (s: S) => R): Resolver<S, R, false> {
  return { kind: 'compute', deps, fn };
}
export function resolve<S, R>(deps: readonly Path<S>[], fn: (s: S) => Promise<R>): Resolver<S, Awaited<R>, true> {
  return { kind: 'resolve', deps, fn } as any;
}
export function visible<S, R, A extends boolean>(
  pred: (ctx: any) => boolean, inner: Resolver<S, R, A>,
): Resolver<S, R | undefined, A> {
  return { kind: 'visible', deps: inner.deps, fn: inner.fn } as any;
}

// ---------- Pick: returns a REAL runtime class ----------
// NB: naming the function `Pick` does not shadow the built-in `Pick<T,K>` type —
// TypeScript keeps value and type namespaces separate. Proven by the usage below.
export function Pick<T, K extends keyof T & string>(
  Base: ClassLike<T>, keys: readonly K[],
): ClassLike<Pick<T, K>> & { [FIELDS]: string[] } {
  class Picked {
    constructor() {
      for (const k of keys) (this as any)[k] = undefined; // real own-props at runtime
    }
  }
  Object.defineProperty(Picked, 'name', { value: `Pick(${Base.name})` });
  (Picked as any)[FIELDS] = [...keys];
  return Picked as any;
}

// ---------- extend: resolver IS the declaration ----------
type ResolvedShape<R> = { [K in keyof R]: R[K] extends Resolver<any, infer O, any> ? O : never };
type AnyAsync<R> = true extends { [K in keyof R]: R[K] extends Resolver<any, any, true> ? true : false }[keyof R]
  ? true : false;

export function extend<B, R extends Record<string, Resolver<any, any, any>>>(
  Base: ClassLike<B> & { [FIELDS]?: string[] }, resolvers: R,
): ClassLike<B & ResolvedShape<R>> & { [FIELDS]: string[]; __async: AnyAsync<R> } {
  class Extended extends (Base as ClassLike<any>) {}
  (Extended as any)[FIELDS] = [...(Base[FIELDS] ?? []), ...Object.keys(resolvers)];
  (Extended as any).__resolvers = resolvers;
  return Extended as any;
}

// ---------- mapper: sync map rejects an async-branded DTO at COMPILE time ----------
export function map<S, D>(_src: S, dest: ClassLike<D> & { __async: false }): D {
  return new dest();
}
export async function mapAsync<S, D>(_src: S, dest: ClassLike<D> & { __async: boolean }): Promise<D> {
  return new dest();
}

// =====================================================================
// USAGE
// =====================================================================
class Address { street!: string; city!: string; }
class User {
  id!: string; email!: string; firstName!: string; lastName!: string;
  password!: string; createdAt!: Date; address!: Address;
}

export const ReadUserDto = extend(Pick(User, ['id', 'email', 'createdAt']), {
  fullName: compute<User, string>(['firstName', 'lastName'], u => `${u.firstName} ${u.lastName}`),
  city: compute<User, string>(['address.city'], u => u.address.city),   // nested path
  note: visible(c => c.role === 'admin', compute<User, string>(['email'], u => u.email)),
});
export type ReadUserDto = InstanceType<typeof ReadUserDto>;

// --- assertions -------------------------------------------------------
type Expect<T extends true> = T;
type Eq<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

declare const d: ReadUserDto;
type _1 = Expect<Eq<typeof d.id, string>>;              // picked scalar
type _2 = Expect<Eq<typeof d.createdAt, Date>>;         // picked Date survives
type _3 = Expect<Eq<typeof d.fullName, string>>;        // computed type inferred
type _4 = Expect<Eq<typeof d.note, string | undefined>>; // visible() widened
type _5 = Expect<Eq<typeof ReadUserDto.__async, false>>; // no async resolver

// value-position use: DI token / instanceof / construction
const inst = new ReadUserDto();
export const isDto = inst instanceof ReadUserDto;
export const token: ClassLike<ReadUserDto> = ReadUserDto;
export const runtimeFields: string[] = (ReadUserDto as any)[FIELDS];

// sync map accepted on a sync DTO
export const okSync: ReadUserDto = map({} as User, ReadUserDto);

// --- async branding ---------------------------------------------------
export const AvatarDto = extend(Pick(User, ['id']), {
  avatarUrl: resolve<User, string>(['id'], async u => `https://x/${u.id}`),
});
export type AvatarDto = InstanceType<typeof AvatarDto>;
declare const a: AvatarDto;
type _6 = Expect<Eq<typeof a.avatarUrl, string>>;        // Promise unwrapped
type _7 = Expect<Eq<typeof AvatarDto.__async, true>>;    // branded async
export const okAsync: Promise<AvatarDto> = mapAsync({} as User, AvatarDto);
