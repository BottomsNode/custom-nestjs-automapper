import { describe, it, expect } from 'vitest';
import { defineSchema, isSchemaToken } from './descriptor/schema.js';
import { Pick, Write, extend } from './dto/pick.js';
import { compute } from './dto/resolver.js';
import { Mapper } from './mapper.js';

/**
 * Stands in for a Prisma model: a generated TypeScript type with no runtime
 * class, so `Pick(PrismaUser, …)` has nothing to reference without a token.
 */
const PrismaUser = defineSchema('PrismaUser', {
  id: { type: 'string', isPrimary: true, isGenerated: true },
  email: { type: 'string' },
  firstName: { type: 'string' },
  lastName: { type: 'string' },
  password: { type: 'string', isSelectByDefault: false },
  bio: { type: 'string', nullable: true },
  createdAt: { type: 'date', isCreateDate: true },
});

class ReadUserDto extends extend(Pick(PrismaUser, ['id', 'email', 'bio']), {
  fullName: compute<{ firstName: string; lastName: string }, string>(
    ['firstName', 'lastName'],
    (u) => `${u.firstName} ${u.lastName}`,
  ),
}) {}

const sealed = (...dtos: Parameters<Mapper['register']>) => {
  const m = new Mapper().register(...dtos);
  m.seal();
  return m;
};

describe('a source with no runtime class', () => {
  it('is recognised as a token', () => {
    expect(isSchemaToken(PrismaUser)).toBe(true);
    expect(isSchemaToken(class Real {})).toBe(false);
  });

  it('needs no adapter registration — the built-in one is terminal', () => {
    expect(sealed(ReadUserDto).planOf(ReadUserDto)?.key).toBe('PrismaUser::ReadUserDto');
  });

  it('maps', () => {
    const dto = sealed(ReadUserDto).map(
      { id: 'u1', email: 'a@b.c', firstName: 'Nishit', lastName: 'Shivdasani', bio: null },
      ReadUserDto,
    );
    expect(dto).toMatchObject({ id: 'u1', fullName: 'Nishit Shivdasani', bio: null });
  });
});

describe('a token feeds every back-end, not just mapping', () => {
  const mapper = sealed(ReadUserDto);

  it('projects — which PojosMetadataMap cannot do', () => {
    expect([...mapper.projectionFor(ReadUserDto).fields].sort()).toEqual([
      'bio',
      'email',
      'firstName',
      'id',
      'lastName',
    ]);
  });

  it('generates an OpenAPI schema', () => {
    const schema = mapper.schemaOf(ReadUserDto);
    expect(schema.properties['bio']).toEqual({ type: 'string', nullable: true });
    expect(schema.required).toContain('id');
    expect(schema.required).not.toContain('bio');
  });

  it('reports the write drop list from the declared provenance', () => {
    const { writable, dropped } = mapper.reverseOf(ReadUserDto);
    expect(dropped.map((d) => d.field)).toEqual(['id', 'createdAt']);
    // select:false is hidden on read, not database-owned.
    expect(writable).toContain('password');
  });

  it('enforces the drop list on a write DTO declared from a token', () => {
    class BadCreate extends Write(PrismaUser, ['email', 'id']) {}
    const report = new Mapper().register(BadCreate).seal();
    expect(report.ok).toBe(false);
    expect(report.diagnostics[0]?.code).toBe('WRITE_FIELD_REJECTED');
  });
});

describe('shape inference', () => {
  it('types picked fields from their declared kind', () => {
    const dto = sealed(ReadUserDto).map(
      { id: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B', bio: null },
      ReadUserDto,
    );
    const id: string = dto.id;
    const bio: string | null = dto.bio;
    const createdAt = (dto as unknown as Record<string, unknown>)["createdAt"];

    expect(id).toBe('u1');
    expect(bio).toBeNull();
    // Not picked, so not present.
    expect(createdAt).toBeUndefined();
  });
});
