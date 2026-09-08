import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../descriptor/registry.js';
import { NO_PROVENANCE, type SchemaAdapter, type TypeDescriptor } from '../descriptor/types.js';
import { Pick, extend } from '../dto/pick.js';
import { compute, from, ignore, visible } from '../dto/resolver.js';
import { buildPlan, type MappingPlan } from '../plan/planner.js';
import { schemaOf } from './openapi.js';

enum Status {
  Active = 'active',
  Banned = 'banned',
}

class User {
  id!: string;
  email!: string;
  nickname!: string;
  age!: number;
  active!: boolean;
  createdAt!: Date;
  settings!: Record<string, unknown>;
  status!: Status;
  secret!: string;
}

const f = (name: string, type: TypeDescriptor['fields'][number]['type'], nullable = false, enumValues?: unknown[]) => ({
  name,
  type,
  nullable,
  provenance: NO_PROVENANCE,
  ...(enumValues ? { enumValues } : {}),
});

const adapter: SchemaAdapter = {
  name: 'fake',
  supports: (t) => t === User,
  describe: (): TypeDescriptor => ({
    type: User,
    fields: [
      f('id', 'string'),
      f('email', 'string'),
      f('nickname', 'string', true),
      f('age', 'number'),
      f('active', 'boolean'),
      f('createdAt', 'date'),
      f('settings', 'json'),
      f('status', 'enum', false, [Status.Active, Status.Banned]),
      f('secret', 'string'),
    ],
    relations: [],
    producedBy: 'fake',
  }),
};

const registry = new AdapterRegistry().use(adapter);
const planFor = (dest: Parameters<typeof buildPlan>[0]): MappingPlan => {
  const r = buildPlan(dest, registry);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.code).join(', '));
  return r.plan;
};

class ReadUserDto extends extend(Pick(User, ['id', 'email', 'nickname', 'age', 'active', 'createdAt', 'settings', 'status']), {
  label: compute<User, string>(['email'], (u) => u.email),
  hidden: ignore<User>(),
}) {}

const schema = schemaOf(planFor(ReadUserDto));

describe('CAP-9 — schema from the descriptor', () => {
  it('maps each field kind to its JSON type', () => {
    expect(schema.properties['id']).toEqual({ type: 'string' });
    expect(schema.properties['age']).toEqual({ type: 'number' });
    expect(schema.properties['active']).toEqual({ type: 'boolean' });
    expect(schema.properties['createdAt']).toEqual({ type: 'string', format: 'date-time' });
  });

  it('leaves a json column unconstrained rather than guessing a shape', () => {
    expect(schema.properties['settings']).toEqual({});
  });

  it('lists enum values', () => {
    expect(schema.properties['status']).toEqual({ type: 'string', enum: ['active', 'banned'] });
  });

  it('covers a computed field, which has no declaration site to decorate', () => {
    // The whole reason this back-end exists: @ApiProperty cannot reach `label`.
    expect(schema.properties).toHaveProperty('label');
  });

  it('omits an ignored field', () => {
    expect(schema.properties).not.toHaveProperty('hidden');
  });

  it('omits source fields the DTO never picked', () => {
    expect(schema.properties).not.toHaveProperty('secret');
  });
});

describe('AD-18 — the null model decides `required`', () => {
  it('marks a non-nullable column required', () => {
    expect(schema.required).toContain('id');
  });

  it('leaves a nullable column out of required but present in properties', () => {
    // null crosses the wire, so the property exists and is nullable.
    expect(schema.required).not.toContain('nickname');
    expect(schema.properties['nickname']).toEqual({ type: 'string', nullable: true });
  });

  it('treats a gated field as optional whatever its column says', () => {
    class Gated extends extend(Pick(User, ['id']), {
      secret: visible<User, string, false>(() => true, from<User, string>('secret')),
    }) {}
    const gated = schemaOf(planFor(Gated));

    // undefined never crosses the wire, so a gate makes the property optional
    // even though `secret` is a non-nullable column.
    expect(gated.required).toEqual(['id']);
    expect(gated.properties).toHaveProperty('secret');
  });
});

describe('OpenAPI version', () => {
  it('emits nullable: true for 3.0', () => {
    expect(schemaOf(planFor(ReadUserDto), { version: '3.0' }).properties['nickname']).toEqual({
      type: 'string',
      nullable: true,
    });
  });

  it('emits a type union for 3.1, which dropped `nullable`', () => {
    expect(schemaOf(planFor(ReadUserDto), { version: '3.1' }).properties['nickname']).toEqual({
      type: ['string', 'null'],
    });
  });
});
