// NEGATIVE SPIKE: every line below MUST be a compile error.
import { Pick, extend, compute, resolve, visible, map } from './ok';

class Address { street!: string; city!: string; }
class User {
  id!: string; email!: string; firstName!: string; lastName!: string;
  password!: string; createdAt!: Date; address!: Address;
}

// [E1] misspelled dependency path — 'firstNmae' is not a Path<User>
export const D1 = extend(Pick(User, ['id']), {
  fullName: compute<User, string>(['firstNmae', 'lastName'], u => u.firstName),
});

// [E2] bogus nested dependency path — 'address.zip' does not exist
export const D2 = extend(Pick(User, ['id']), {
  zip: compute<User, string>(['address.zip'], u => 'x'),
});

// [E3] Pick of a field that is not on the entity
export const D3 = Pick(User, ['id', 'nickname' as any as 'id' | 'nickname']);

// [E4] sync map() on an async-branded DTO
const Avatar = extend(Pick(User, ['id']), {
  url: resolve<User, string>(['id'], async u => u.id),
});
export const bad = map({} as User, Avatar);

// [E5] a visible()-gated field is string|undefined, not string
const Gated = extend(Pick(User, ['id']), {
  note: visible(c => c.role === 'admin', compute<User, string>(['email'], u => u.email)),
});
declare const g: InstanceType<typeof Gated>;
export const mustBeString: string = g.note;

// [E6] a field that was never picked is not on the DTO
declare const d1: InstanceType<typeof D1>;
export const leaked = d1.password;
