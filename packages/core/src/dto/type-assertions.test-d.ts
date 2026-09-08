/**
 * Compile-time test suite.
 *
 * CAP-10 and AD-19.4 are claims about the type system, so a runtime test cannot
 * reach them. This file is type-checked and never emitted or executed: if it
 * compiles, the claims hold; if it does not, the build fails.
 *
 * Positive claims use `AssertEqual`. Negative claims use `@ts-expect-error`,
 * which itself errors when the line below it *stops* being an error — so the
 * guardrails cannot silently rot into permissiveness.
 */

import { Pick, extend } from './pick.js';
import { compute, resolve, visible, from, constant, auto } from './resolver.js';
import type { Path } from './path.js';

// --- assertion helpers -------------------------------------------------
type AssertEqual<T, U> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Assignable<From, To> = [From] extends [To] ? true : false;

// --- fixtures ----------------------------------------------------------
class Address {
  street!: string;
  city!: string;
}

class User {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  password!: string;
  createdAt!: Date;
  address!: Address;
  tags!: string[];
}

// =======================================================================
// Path<T> — CAP-10
// =======================================================================
type UserPath = Path<User>;

export type P1 = Expect<Assignable<'email', UserPath>>;
export type P2 = Expect<Assignable<'address.city', UserPath>>;
export type P3 = Expect<Assignable<'createdAt', UserPath>>;
export type P4 = Expect<Assignable<`tags.${number}`, UserPath>>;

// A Date must terminate a path rather than exploding into its method names,
// or every DTO gains hundreds of bogus candidates and the union stops helping.
export type P5 = Expect<Assignable<'createdAt.getTime', UserPath> extends true ? false : true>;

// =======================================================================
// Pick / extend inference — AD-19
// =======================================================================
/**
 * The supported public form: a class declaration extending the expression.
 * One name serving as both value and type, no alias.
 *
 * The `const X = extend(...)` + `type X = InstanceType<typeof X>` form is NOT
 * supported: the self-referential alias makes TypeScript break the cycle by
 * falling back to the key parameter's constraint, so the DTO silently regains
 * every field of the source — password included.
 */
class ReadUserDto extends extend(Pick(User, ['id', 'email', 'createdAt']), {
  fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
  city: compute<User, string>(['address.city'], (u) => u.address.city),
  tagCount: compute<User, number>(['tags'], (u) => u.tags.length),
  alias: from<User, string>('email'),
  kind: constant<User, 'user'>('user'),
  mail: auto<User, string>('email'),
}) {}

declare const dto: ReadUserDto;

export type A1 = Expect<AssertEqual<typeof dto.id, string>>;
export type A2 = Expect<AssertEqual<typeof dto.email, string>>;
// A picked Date stays a Date — it is not widened or stringified.
export type A3 = Expect<AssertEqual<typeof dto.createdAt, Date>>;
// A derived field's type comes from its resolver's return type: one declaration.
export type A4 = Expect<AssertEqual<typeof dto.fullName, string>>;
export type A5 = Expect<AssertEqual<typeof dto.tagCount, number>>;
export type A6 = Expect<AssertEqual<typeof dto.kind, 'user'>>;

// Unpicked source fields must not appear on the DTO. Asserted by member access
// rather than `keyof`, because member access is what a caller actually writes.

// =======================================================================
// visible() widening — the gate must make the declared type honest
// =======================================================================
class GatedDto extends extend(Pick(User, ['id']), {
  note: visible<User, string, false>(
    () => true,
    compute<User, string>(['email'], (u) => u.email),
  ),
}) {}
declare const gated: GatedDto;

export type G1 = Expect<AssertEqual<typeof gated.note, string | undefined>>;

// =======================================================================
// resolve() unwrapping and async branding — AD-9
// =======================================================================
const AvatarDto = extend(Pick(User, ['id']), {
  avatarUrl: resolve<User, string>(['id'], async (u) => `https://cdn/${u.id}`),
});
class AvatarDtoC extends AvatarDto {}
declare const avatar: AvatarDtoC;

// The mapped field is the resolved value, never a Promise.
export type R1 = Expect<AssertEqual<typeof avatar.avatarUrl, string>>;

export type R3 = Expect<AssertEqual<typeof AvatarDto.__async, true>>;

// =======================================================================
// NEGATIVE — each must remain an error
// =======================================================================

// A misspelled dependency path. TypeScript reports the near-miss itself.
export const N1 = extend(Pick(User, ['id']), {
  // @ts-expect-error — 'firstNmae' is not a Path<User>
  bad: compute<User, string>(['firstNmae'], (u) => u.firstName),
});

// A nested path that does not exist.
export const N2 = extend(Pick(User, ['id']), {
  // @ts-expect-error — 'address.zip' is not a Path<User>
  zip: compute<User, string>(['address.zip'], () => ''),
});

// Picking a field the entity does not declare.
// @ts-expect-error — 'nickname' is not a key of User
export const N3 = Pick(User, ['id', 'nickname']);

// A gated field is not assignable to a non-optional target.
// @ts-expect-error — string | undefined is not assignable to string
export const N4: string = gated.note;

// An unpicked field is not reachable.
// @ts-expect-error — 'password' does not exist on the DTO
export const N5 = dto.password;

// A resolver's declared output must match what its function returns.
export const N6 = extend(Pick(User, ['id']), {
  // @ts-expect-error — returns number, declared string
  wrong: compute<User, string>(['tags'], (u) => u.tags.length),
});
