/**
 * AD-19 is only real if it is tested. Each block below corresponds to one of
 * the four properties the DTO construction contract promises, and fails when
 * that property is violated.
 */
import { describe, it, expect } from 'vitest';
import { Pick, extend, isDtoClass, FIELDS, RESOLVERS, SOURCE } from './pick.js';
import { compute, resolve, visible, from } from './resolver.js';

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
}

const ReadUserDto = extend(Pick(User, ['id', 'email', 'createdAt']), {
  fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
  city: compute<User, string>(['address.city'], (u) => u.address.city),
  note: visible<User, string, false>(
    () => true,
    compute<User, string>(['email'], (u) => u.email),
  ),
});

describe('AD-19.1 — usable as a DI token', () => {
  it('is a function with a prototype', () => {
    expect(typeof ReadUserDto).toBe('function');
    expect(typeof ReadUserDto.prototype).toBe('object');
  });

  it('holds instanceof through composition', () => {
    expect(new ReadUserDto()).toBeInstanceOf(ReadUserDto);
  });

  it('keeps the prototype chain intact', () => {
    expect(Object.getPrototypeOf(ReadUserDto.prototype)).not.toBeNull();
  });
});

describe('AD-19.2 — instances carry real own-properties (the v1 regression)', () => {
  const instance = new ReadUserDto();

  it.each(['id', 'email', 'createdAt', 'fullName', 'city', 'note'])(
    'declares %s as an own-property',
    (key) => {
      expect(Object.prototype.hasOwnProperty.call(instance, key)).toBe(true);
    },
  );

  it("answers 'in' for every declared key", () => {
    // v1 tested `key in dest` and always got false, so every mapping produced {}.
    for (const key of ReadUserDto[FIELDS]) {
      expect(key in instance).toBe(true);
    }
  });

  it('assigns keys added by extend, not only those from Pick', () => {
    expect(Object.prototype.hasOwnProperty.call(instance, 'fullName')).toBe(true);
  });
});

describe('AD-19.3 — runtime registry', () => {
  it('equals picked ∪ computed, in declaration order', () => {
    expect([...ReadUserDto[FIELDS]]).toEqual([
      'id',
      'email',
      'createdAt',
      'fullName',
      'city',
      'note',
    ]);
  });

  it('exposes resolvers with their declared deps', () => {
    expect(Object.keys(ReadUserDto[RESOLVERS])).toEqual(['fullName', 'city', 'note']);
    expect(ReadUserDto[RESOLVERS]['city']?.deps).toEqual(['address.city']);
  });

  it('records the source the DTO was declared against', () => {
    expect(ReadUserDto[SOURCE]).toBe(User);
  });

  it('is recognised by the built-in adapter predicate', () => {
    expect(isDtoClass(ReadUserDto)).toBe(true);
    expect(isDtoClass(User)).toBe(false);
    expect(isDtoClass({})).toBe(false);
  });

  it('freezes the registry so nothing mutates it after declaration', () => {
    expect(Object.isFrozen(ReadUserDto[FIELDS])).toBe(true);
    expect(Object.isFrozen(ReadUserDto[RESOLVERS])).toBe(true);
  });
});

describe('AD-19.4 — resolvers execute and read their declared paths', () => {
  const source = {
    firstName: 'Nishit',
    lastName: 'Shivdasani',
    email: 'x@example.com',
    address: { city: 'Pune', street: 'Main' },
  } as unknown as User;

  it('executes a computed resolver', () => {
    expect(ReadUserDto[RESOLVERS]['fullName']?.fn(source as never)).toBe('Nishit Shivdasani');
  });

  it('executes a resolver over a nested path', () => {
    expect(ReadUserDto[RESOLVERS]['city']?.fn(source as never)).toBe('Pune');
  });

  it('carries a gate as a wrapper node, never a flag (AD-2)', () => {
    const gate = ReadUserDto[RESOLVERS]['note'];
    expect(gate?.kind).toBe('gated');
    expect(gate?.child).toBeDefined();
    expect(gate?.child?.kind).toBe('compute');
  });
});

describe('async branding (AD-9)', () => {
  const AvatarDto = extend(Pick(User, ['id']), {
    avatarUrl: resolve<User, string>(['id'], async (u) => `https://cdn/${u.id}`),
  });

  it('marks the resolver async', () => {
    expect(AvatarDto[RESOLVERS]['avatarUrl']?.kind).toBe('resolve');
  });

  it('still materialises the key as an own-property', () => {
    expect(Object.prototype.hasOwnProperty.call(new AvatarDto(), 'avatarUrl')).toBe(true);
  });
});

describe('composition', () => {
  it('does not leak unpicked source fields', () => {
    expect(ReadUserDto[FIELDS]).not.toContain('password');
    expect(Object.prototype.hasOwnProperty.call(new ReadUserDto(), 'password')).toBe(false);
  });

  it('supports extending an already-extended DTO without losing keys', () => {
    const Wider = extend(ReadUserDto, {
      initials: compute<User, string>(['firstName'], (u) => u.firstName[0] ?? ''),
    });
    expect(Wider[FIELDS]).toContain('fullName');
    expect(Wider[FIELDS]).toContain('initials');
    expect(Object.prototype.hasOwnProperty.call(new Wider(), 'fullName')).toBe(true);
  });

  it('keeps from() reading a renamed source path', () => {
    const Renamed = extend(Pick(User, ['id']), {
      mail: from<User, string>('email'),
    });
    expect(Renamed[RESOLVERS]['mail']?.fn({ email: 'a@b.c' } as User as never)).toBe('a@b.c');
  });
});
