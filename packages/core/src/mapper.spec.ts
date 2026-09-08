import { describe, it, expect } from 'vitest';
import { NO_PROVENANCE, type SchemaAdapter, type TypeDescriptor } from './descriptor/types.js';
import { Pick, extend } from './dto/pick.js';
import { compute, from, visible } from './dto/resolver.js';
import { Mapper } from './mapper.js';

class User {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  password!: string;
}

const adapter: SchemaAdapter = {
  name: 'fake',
  supports: (t) => t === User,
  describe: (): TypeDescriptor => ({
    type: User,
    fields: ['id', 'email', 'firstName', 'lastName', 'password'].map((name) => ({
      name,
      type: 'string' as const,
      nullable: false,
      provenance: NO_PROVENANCE,
    })),
    relations: [],
    producedBy: 'fake',
  }),
  toNativeProjection: (selection) => ({
    select: Object.fromEntries(selection.fields.map((f) => [f, true])),
  }),
};

class ReadUserDto extends extend(Pick(User, ['id', 'email']), {
  fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
}) {}

const sealed = (...dtos: Parameters<Mapper['register']>) =>
  new Mapper().use(adapter).register(...dtos);

const row = { id: 'u1', email: 'a@b.c', firstName: 'Nishit', lastName: 'Shivdasani' };

describe('AD-16 — declare, seal, serve', () => {
  it('refuses to map before seal, so lazy first-call planning is unreachable', () => {
    const mapper = sealed(ReadUserDto);
    expect(() => mapper.map(row, ReadUserDto)).toThrow(/REGISTRY_UNSEALED/);
  });

  it('refuses to declare after seal', () => {
    const mapper = sealed(ReadUserDto);
    mapper.seal();
    expect(() => mapper.register(ReadUserDto)).toThrow(/REGISTRY_SEALED/);
    expect(() => mapper.use(adapter)).toThrow(/REGISTRY_SEALED/);
  });

  it('reports the sealed pairs', () => {
    const report = sealed(ReadUserDto).seal();
    expect(report.ok).toBe(true);
    expect(report.pairs).toEqual(['User::ReadUserDto']);
  });

  it('returns diagnostics rather than throwing, leaving lifetime to the host (AD-8)', () => {
    class Broken extends extend(Pick(User, ['id']), {
      bad: from<User, string>('nope' as never),
    }) {}

    const report = sealed(Broken).seal();
    expect(report.ok).toBe(false);
    expect(report.diagnostics[0]?.code).toBe('DEP_UNKNOWN');
  });
});

describe('mapping', () => {
  const mapper = sealed(ReadUserDto);
  mapper.seal();

  it('maps one object', () => {
    const dto = mapper.map(row, ReadUserDto);
    expect(dto.id).toBe('u1');
    expect(dto.fullName).toBe('Nishit Shivdasani');
    expect(dto).toBeInstanceOf(ReadUserDto);
  });

  it('maps an array', () => {
    const dtos = mapper.mapArray([row, { ...row, id: 'u2' }], ReadUserDto);
    expect(dtos.map((d) => d.id)).toEqual(['u1', 'u2']);
  });

  it('reuses one compiled function across calls', () => {
    mapper.map(row, ReadUserDto);
    expect(mapper.sourceOf(ReadUserDto)).toContain('new D()');
  });

  it('names registered destinations when a mapping is missing', () => {
    class Unregistered extends extend(Pick(User, ['id']), {}) {}
    expect(() => mapper.map(row, Unregistered)).toThrow(/MAPPING_NOT_FOUND/);
  });
});

describe('projection', () => {
  const mapper = sealed(ReadUserDto);
  mapper.seal();

  it('projects only the columns the DTO consumes', () => {
    expect([...mapper.projectionFor(ReadUserDto).fields].sort()).toEqual([
      'email',
      'firstName',
      'id',
      'lastName',
    ]);
  });

  it('hands the adapter native shape straight to the ORM', () => {
    expect(mapper.nativeProjectionFor(ReadUserDto)).toEqual({
      select: { id: true, email: true, firstName: true, lastName: true },
    });
  });

  it('requires context when the plan gates', () => {
    class Gated extends extend(Pick(User, ['id']), {
      secret: visible<User, string, false>(
        (c) => (c as { admin?: boolean } | undefined)?.admin === true,
        from<User, string>('password'),
      ),
    }) {}
    const gated = sealed(Gated);
    gated.seal();

    expect(() => gated.projectionFor(Gated)).toThrow(/CONTEXT_REQUIRED/);
    expect([...gated.projectionFor(Gated, { ctx: { admin: true } }).fields].sort()).toEqual([
      'id',
      'password',
    ]);
  });
});

describe('async plans', () => {
  it('rejects a sync map of an async plan', async () => {
    const { resolve } = await import('./dto/resolver.js');
    class AvatarDto extends extend(Pick(User, ['id']), {
      url: resolve<User, string>(['id'], async (u) => `https://cdn/${u.id}`),
    }) {}

    const mapper = sealed(AvatarDto);
    mapper.seal();

    expect(() => mapper.map(row, AvatarDto)).toThrow(/use mapAsync/);
    await expect(mapper.mapAsync(row, AvatarDto)).resolves.toMatchObject({
      url: 'https://cdn/u1',
    });
  });
});
