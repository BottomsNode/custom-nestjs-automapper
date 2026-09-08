import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../descriptor/registry.js';
import { NO_PROVENANCE, type FieldSelection, type SchemaAdapter, type TypeDescriptor } from '../descriptor/types.js';
import { Pick, extend } from '../dto/pick.js';
import { compute, visible, ignore, constant, from } from '../dto/resolver.js';
import { buildPlan, type MappingPlan } from '../plan/planner.js';
import { projectionFor, mergeSelection, EMPTY_SELECTION } from './projector.js';

class Address {
  city!: string;
  postcode!: string;
}
class User {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  password!: string;
  bio!: string;
  avatar!: string;
  settings!: Record<string, unknown>;
  address!: Address;
}

const field = (name: string, type: 'string' | 'json' = 'string') => ({
  name,
  type,
  nullable: false,
  provenance: NO_PROVENANCE,
});

const adapter: SchemaAdapter = {
  name: 'fake',
  supports: (t) => t === User || t === Address,
  describe: (t): TypeDescriptor =>
    t === Address
      ? {
          type: Address,
          fields: [field('city'), field('postcode')],
          relations: [],
          producedBy: 'fake',
        }
      : {
          type: User,
          fields: [
            field('id'),
            field('email'),
            field('firstName'),
            field('lastName'),
            field('password'),
            field('bio'),
            field('avatar'),
            field('settings', 'json'),
          ],
          relations: [{ name: 'address', target: () => Address, kind: 'one', nullable: true }],
          producedBy: 'fake',
        },
};

const registry = new AdapterRegistry().use(adapter);
const planFor = (dest: Parameters<typeof buildPlan>[0]): MappingPlan => {
  const r = buildPlan(dest, registry);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.code).join(', '));
  return r.plan;
};
const sorted = (s: FieldSelection) => [...s.fields].sort();

describe('CAP-5 — fetch only what the DTO uses', () => {
  class ReadUserDto extends extend(Pick(User, ['id', 'email']), {
    fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
  }) {}

  const selection = projectionFor(planFor(ReadUserDto));

  it('selects the picked columns plus every declared dependency', () => {
    expect(sorted(selection)).toEqual(['email', 'firstName', 'id', 'lastName']);
  });

  it('omits source columns the DTO never reads', () => {
    // The whole point: 8 columns exist, 4 are fetched.
    expect(selection.fields).not.toContain('password');
    expect(selection.fields).not.toContain('bio');
    expect(selection.fields).not.toContain('avatar');
  });

  it('projects the deps of a computed field, not the field name itself', () => {
    // `fullName` is not a column. A projector that guessed from the
    // destination shape would select nothing and the field would resolve to
    // "undefined undefined".
    expect(selection.fields).not.toContain('fullName');
    expect(selection.fields).toContain('firstName');
    expect(selection.fields).toContain('lastName');
  });

  it('deduplicates a column two fields both depend on', () => {
    class Twice extends extend(Pick(User, ['email']), {
      upper: compute<User, string>(['email'], (u) => u.email.toUpperCase()),
      lower: compute<User, string>(['email'], (u) => u.email.toLowerCase()),
    }) {}
    expect(projectionFor(planFor(Twice)).fields).toEqual(['email']);
  });
});

describe('relations and json', () => {
  class Dto extends extend(Pick(User, ['id']), {
    city: compute<User, string>(['address.city'], (u) => u.address.city),
    theme: compute<User, unknown>(['settings.theme.color'], (u) => u.settings['theme']),
  }) {}

  const selection = projectionFor(planFor(Dto));

  it('nests a relation rather than flattening it into fields', () => {
    expect(selection.relations['address']).toEqual({ fields: ['city'], relations: {} });
  });

  it('does not join a relation the DTO never touches', () => {
    const plain = projectionFor(planFor(class extends extend(Pick(User, ['id']), {}) {}));
    expect(Object.keys(plain.relations)).toEqual([]);
  });

  it('selects a json column without descending into its interior', () => {
    // Descending would ask the database for a column named `theme`.
    expect(selection.fields).toContain('settings');
    expect(selection.fields).not.toContain('theme');
  });
});

describe('nodes that read nothing contribute nothing', () => {
  class Dto extends extend(Pick(User, ['id']), {
    kind: constant<User, 'user'>('user'),
    skipped: ignore<User>(),
  }) {}

  it('fetches no column for a constant or an ignore', () => {
    expect(projectionFor(planFor(Dto)).fields).toEqual(['id']);
  });
});

describe('AD-10 — context changes what must be fetched', () => {
  class Gated extends extend(Pick(User, ['id']), {
    secret: visible<User, string, false>(
      (c) => (c as { admin?: boolean } | undefined)?.admin === true,
      from<User, string>('password'),
    ),
  }) {}
  const plan = planFor(Gated);

  it('throws when the plan gates but no context is supplied', () => {
    // Projecting the union would over-fetch silently — the exact failure CAP-5
    // exists to prevent, and one no code review would catch.
    expect(() => projectionFor(plan)).toThrow(/CONTEXT_REQUIRED/);
  });

  it('fetches the gated column for a context that passes', () => {
    expect(sorted(projectionFor(plan, { ctx: { admin: true } }))).toEqual(['id', 'password']);
  });

  it('omits it for a context that fails', () => {
    expect(projectionFor(plan, { ctx: { admin: false } }).fields).toEqual(['id']);
  });

  it('names the gated fields in the error so the fix is obvious', () => {
    try {
      projectionFor(plan);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('secret');
    }
  });
});

describe('mergeSelection', () => {
  it('unions fields and deep-merges relations', () => {
    const a: FieldSelection = { fields: ['id'], relations: { address: { fields: ['city'], relations: {} } } };
    const b: FieldSelection = { fields: ['email'], relations: { address: { fields: ['postcode'], relations: {} } } };
    const merged = mergeSelection(a, b);

    expect(sorted(merged)).toEqual(['email', 'id']);
    expect(sorted(merged.relations['address']!)).toEqual(['city', 'postcode']);
  });

  it('treats an empty field list as EXACTLY NONE, never as everything', () => {
    expect(mergeSelection(EMPTY_SELECTION, { fields: ['id'], relations: {} }).fields).toEqual(['id']);
  });

  it('lets `all` absorb that level and propagate no further', () => {
    const all: FieldSelection = { fields: [], relations: {}, all: true };
    const merged = mergeSelection(all, { fields: ['id'], relations: { address: { fields: ['city'], relations: {} } } });

    expect(merged.all).toBe(true);
    expect(merged.fields).toEqual([]);
    expect(merged.relations['address']?.all).toBeUndefined();
  });
});
