import { describe, it, expect } from 'vitest';
import { NO_PROVENANCE, type SchemaAdapter, type TypeDescriptor } from './descriptor/types.js';
import { Pick, Write, extend, isWriteDto } from './dto/pick.js';
import { compute } from './dto/resolver.js';
import { Mapper } from './mapper.js';
import { writableFields, writeDropReason } from './policy.js';

class User {
  id!: string;
  email!: string;
  password!: string;
  displayName!: string;
  createdAt!: Date;
  updatedAt!: Date;
  version!: number;
}

const owned = (flag: string) => ({ ...NO_PROVENANCE, [flag]: true });

const fields = [
  { name: 'id', type: 'string' as const, nullable: false, provenance: owned('isPrimary') },
  { name: 'email', type: 'string' as const, nullable: false, provenance: NO_PROVENANCE },
  {
    name: 'password',
    type: 'string' as const,
    nullable: false,
    // Hidden on read, required on write — must survive the drop list.
    provenance: { ...NO_PROVENANCE, isSelectByDefault: false },
  },
  { name: 'displayName', type: 'string' as const, nullable: true, provenance: NO_PROVENANCE },
  { name: 'createdAt', type: 'date' as const, nullable: false, provenance: owned('isCreateDate') },
  { name: 'updatedAt', type: 'date' as const, nullable: false, provenance: owned('isUpdateDate') },
  { name: 'version', type: 'number' as const, nullable: false, provenance: owned('isVersion') },
];

const adapter: SchemaAdapter = {
  name: 'fake',
  supports: (t) => t === User,
  describe: (): TypeDescriptor => ({ type: User, fields, relations: [], producedBy: 'fake' }),
};

class CreateUserDto extends Write(User, ['email', 'password', 'displayName']) {}

const sealed = (...dtos: Parameters<Mapper['register']>) => {
  const mapper = new Mapper().use(adapter).register(...dtos);
  return mapper;
};

describe('AD-14 — the write drop list', () => {
  it('drops every database-owned flag', () => {
    const dropped = fields.filter((f) => writeDropReason(f)).map((f) => f.name);
    expect(dropped).toEqual(['id', 'createdAt', 'updatedAt', 'version']);
  });

  it('keeps a hidden-on-read column writable', () => {
    // password is select:false, which is a READ concern. Treating it as a write
    // drop would make it impossible to ever set one.
    expect(writeDropReason(fields.find((f) => f.name === 'password')!)).toBeUndefined();
    expect(writableFields(fields).map((f) => f.name)).toContain('password');
  });

  it('names the reason, so the error can explain itself', () => {
    expect(writeDropReason(fields[0]!)).toBe('primary key');
    expect(writeDropReason(fields.find((f) => f.name === 'version')!)).toBe('version column');
  });
});

describe('Write DTOs', () => {
  it('marks the class, and extend carries the mark through', () => {
    expect(isWriteDto(CreateUserDto)).toBe(true);
    expect(isWriteDto(Pick(User, ['email']))).toBe(false);

    class Wider extends extend(Write(User, ['email']), {
      slug: compute<User, string>(['email'], (u) => u.email.split('@')[0] ?? ''),
    }) {}
    expect(isWriteDto(Wider)).toBe(true);
  });

  it('rejects a database-owned field at seal rather than dropping it silently', () => {
    class Bad extends Write(User, ['email', 'id', 'createdAt']) {}
    const report = sealed(Bad).seal();

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((d) => d.code)).toEqual([
      'WRITE_FIELD_REJECTED',
      'WRITE_FIELD_REJECTED',
    ]);
    expect(report.diagnostics[0]?.message).toContain('primary key');
  });

  it('seals cleanly when it declares only writable fields', () => {
    expect(sealed(CreateUserDto).seal().ok).toBe(true);
  });
});

describe('mapInput — the trust boundary', () => {
  const mapper = sealed(CreateUserDto);
  mapper.seal();

  it('maps an accepted body', () => {
    const dto = mapper.mapInput(
      { email: 'a@b.c', password: 'secret', displayName: 'Nishit' },
      CreateUserDto,
    );
    expect(dto).toMatchObject({ email: 'a@b.c', password: 'secret', displayName: 'Nishit' });
    expect(dto).toBeInstanceOf(CreateUserDto);
  });

  it('rejects a body carrying a database-owned field', () => {
    // Mass assignment: silently ignoring `id` is how a client overwrites a
    // primary key. It is an error, not a no-op.
    expect(() => mapper.mapInput({ email: 'a@b.c', id: 'attacker-chosen' }, CreateUserDto)).toThrow(
      /INPUT_FIELDS_REJECTED/,
    );
  });

  it('rejects an unknown field', () => {
    expect(() => mapper.mapInput({ email: 'a@b.c', isAdmin: true }, CreateUserDto)).toThrow(
      /isAdmin/,
    );
  });

  it('lists what was rejected and what is accepted', () => {
    try {
      mapper.mapInput({ id: 'x', role: 'admin' }, CreateUserDto);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('id, role');
      expect(message).toContain('email');
    }
  });

  it('accepts a partial body', () => {
    expect(mapper.mapInput({ email: 'a@b.c' }, CreateUserDto).email).toBe('a@b.c');
  });

  it('refuses a read DTO, so the check cannot be bypassed by using map()', () => {
    class ReadUserDto extends Pick(User, ['email']) {}
    const m = sealed(ReadUserDto);
    m.seal();
    expect(() => m.mapInput({ email: 'a@b.c' }, ReadUserDto)).toThrow();
  });
});
