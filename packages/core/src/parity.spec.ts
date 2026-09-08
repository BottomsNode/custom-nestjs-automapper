import { describe, it, expect } from 'vitest';
import { NO_PROVENANCE, type SchemaAdapter, type TypeDescriptor } from './descriptor/types.js';
import { Pick, extend } from './dto/pick.js';
import { defaultTo, from, compute } from './dto/resolver.js';
import { Mapper } from './mapper.js';

class User {
  id!: string;
  nickname!: string | null;
  bio!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  loginCount!: number;
}

const adapter: SchemaAdapter = {
  name: 'fake',
  supports: (t) => t === User,
  describe: (): TypeDescriptor => ({
    type: User,
    fields: [
      { name: 'id', type: 'string', nullable: false, provenance: NO_PROVENANCE },
      { name: 'nickname', type: 'string', nullable: true, provenance: NO_PROVENANCE },
      { name: 'bio', type: 'string', nullable: true, provenance: NO_PROVENANCE },
      { name: 'createdAt', type: 'date', nullable: false, provenance: NO_PROVENANCE },
      { name: 'updatedAt', type: 'date', nullable: false, provenance: NO_PROVENANCE },
      { name: 'loginCount', type: 'number', nullable: false, provenance: NO_PROVENANCE },
    ],
    relations: [],
    producedBy: 'fake',
  }),
};

const sealed = (dtos: Parameters<Mapper['register']>, options = {}) => {
  const m = new Mapper(options).use(adapter).register(...dtos);
  m.seal();
  return m;
};

describe('defaultTo — nullSubstitution and undefinedSubstitution in one', () => {
  class Dto extends extend(Pick(User, ['id']), {
    nickname: defaultTo(from<User, string | null>('nickname'), 'anonymous'),
    bio: defaultTo(compute<User, string | undefined>(['bio'], (u) => u.bio ?? undefined), 'none'),
  }) {}

  const mapper = sealed([Dto]);

  it('substitutes for null', () => {
    expect(mapper.map({ id: '1', nickname: null }, Dto).nickname).toBe('anonymous');
  });

  it('substitutes for undefined', () => {
    expect(mapper.map({ id: '1' }, Dto).bio).toBe('none');
  });

  it('leaves a present value alone, including falsy ones', () => {
    expect(mapper.map({ id: '1', nickname: '' }, Dto).nickname).toBe('');
  });

  it('narrows the field type, so the DTO stops advertising a null it cannot produce', () => {
    const dto = mapper.map({ id: '1', nickname: null }, Dto);
    const narrowed: string = dto.nickname;
    expect(narrowed).toBe('anonymous');
  });
});

describe('type converters — automapper typeConverters, but schema-aware', () => {
  class Dto extends Pick(User, ['id', 'createdAt', 'updatedAt', 'loginCount']) {}

  it('converts every field of a declared type without naming any of them', () => {
    const mapper = sealed([Dto], {
      convert: { date: (v: unknown) => (v as Date).toISOString() },
    });
    const out = mapper.map(
      { id: '1', createdAt: new Date('2020-01-01'), updatedAt: new Date('2021-06-15'), loginCount: 3 },
      Dto,
    );

    // Both dates converted from one rule; nothing else touched.
    expect(out.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(out.updatedAt).toBe('2021-06-15T00:00:00.000Z');
    expect(out.loginCount).toBe(3);
  });

  it('leaves everything alone when no converter is registered', () => {
    const out = sealed([Dto]).map({ id: '1', createdAt: new Date('2020-01-01'), loginCount: 1 }, Dto);
    expect(out.createdAt).toBeInstanceOf(Date);
  });

  it('emits the converter only for fields whose type matches', () => {
    const mapper = sealed([Dto], { convert: { number: (v: unknown) => Number(v) * 2 } });
    mapper.map({ id: '1', loginCount: 5 }, Dto);
    // One converter slot, used by the single numeric field.
    expect(mapper.sourceOf(Dto)).toContain('v[0]');
    expect(mapper.sourceOf(Dto)?.match(/v\[\d+\]/g)).toHaveLength(1);
  });
});
