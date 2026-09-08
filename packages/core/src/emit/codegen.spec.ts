import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../descriptor/registry.js';
import { NO_PROVENANCE, type SchemaAdapter, type TypeDescriptor } from '../descriptor/types.js';
import { Pick, extend } from '../dto/pick.js';
import { compute, resolve, visible, ignore, constant, from } from '../dto/resolver.js';
import { buildPlan, type MappingPlan } from '../plan/planner.js';
import { compile } from './codegen.js';

class Address {
  city!: string;
}

/** Field names chosen to break a naive emitter. */
class User {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  settings!: Record<string, unknown>;
  address!: Address;
  ['weird"quote']!: string;
  ['new\nline']!: string;
  ['back\\slash']!: string;
  ['"; globalThis.PWNED = 1; //']!: string;
}

const HOSTILE = ['weird"quote', 'new\nline', 'back\\slash', '"; globalThis.PWNED = 1; //'] as const;

const adapter: SchemaAdapter = {
  name: 'fake',
  supports: (t) => t === User || t === Address,
  describe: (t): TypeDescriptor =>
    t === Address
      ? {
          type: Address,
          fields: [{ name: 'city', type: 'string', nullable: false, provenance: NO_PROVENANCE }],
          relations: [],
          producedBy: 'fake',
        }
      : {
          type: User,
          fields: [
            ...['id', 'email', 'firstName', 'lastName', ...HOSTILE].map((name) => ({
              name,
              type: 'string' as const,
              nullable: false,
              provenance: NO_PROVENANCE,
            })),
            { name: 'settings', type: 'json' as const, nullable: false, provenance: NO_PROVENANCE },
          ],
          relations: [
            { name: 'address', target: () => Address, kind: 'one', nullable: true },
          ],
          producedBy: 'fake',
        },
};

const registry = new AdapterRegistry().use(adapter);
const planFor = (dest: Parameters<typeof buildPlan>[0]): MappingPlan => {
  const r = buildPlan(dest, registry);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.code).join(', '));
  return r.plan;
};

describe('AD-3 — no untrusted string is ever emitted as code', () => {
  class Hostile extends extend(Pick(User, HOSTILE), {}) {}
  const compiled = compile(planFor(Hostile));

  it('compiles field names that would break a naive emitter', () => {
    expect(compiled.source).toBeTypeOf('string');
  });

  it('maps hostile field names correctly', () => {
    const source: Record<string, unknown> = {};
    for (const name of HOSTILE) source[name] = `v:${name}`;
    const out = compiled.invoke(source) as Record<string, unknown>;
    for (const name of HOSTILE) expect(out[name]).toBe(`v:${name}`);
  });

  it('does not execute an injected payload', () => {
    compiled.invoke({ '"; globalThis.PWNED = 1; //': 'x' });
    expect((globalThis as Record<string, unknown>)['PWNED']).toBeUndefined();
  });

  it('emits every key as a bracketed string literal, never a bare identifier', () => {
    for (const name of HOSTILE) {
      expect(compiled.source).toContain(`[${JSON.stringify(name)}]`);
    }
  });

  it('never stringifies a resolver into the body', () => {
    class WithFn extends extend(Pick(User, ['id']), {
      shout: compute<User, string>(['email'], (u) => u.email.toUpperCase()),
    }) {}
    // The marker below would appear in the source if the function were inlined.
    expect(compile(planFor(WithFn)).source).not.toContain('toUpperCase');
  });
});

describe('mapping output', () => {
  class Dto extends extend(Pick(User, ['id', 'email']), {
    fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
    kind: constant<User, 'user'>('user'),
    alias: from<User, string>('email'),
    city: compute<User, string>(['address.city'], (u) => u.address?.city),
    skipped: ignore<User>(),
  }) {}

  const compiled = compile(planFor(Dto));
  const src = {
    id: 'u1',
    email: 'a@b.c',
    firstName: 'Nishit',
    lastName: 'Shivdasani',
    address: { city: 'Pune' },
  } as unknown as User;

  const out = compiled.invoke(src) as Record<string, unknown>;

  it('copies, computes, renames, and applies constants', () => {
    expect(out['id']).toBe('u1');
    expect(out['fullName']).toBe('Nishit Shivdasani');
    expect(out['alias']).toBe('a@b.c');
    expect(out['kind']).toBe('user');
  });

  it('reads a nested source path', () => {
    expect(out['city']).toBe('Pune');
  });

  it('returns an instance of the destination class', () => {
    expect(out).toBeInstanceOf(Dto);
  });

  it('keeps an ignored field present and undefined, never deleted (AD-18)', () => {
    expect(Object.prototype.hasOwnProperty.call(out, 'skipped')).toBe(true);
    expect(out['skipped']).toBeUndefined();
  });

  it('survives a missing relation without throwing', () => {
    const partial = compiled.invoke({ id: 'u2' }) as Record<string, unknown>;
    expect(partial['city']).toBeUndefined();
    expect(partial['id']).toBe('u2');
  });
});

describe('AD-12 — a json segment is terminal', () => {
  class Dto extends extend(Pick(User, ['id']), {
    theme: compute<User, unknown>(['settings.theme.color'], (u) => u.settings?.['theme']),
  }) {}
  const compiled = compile(planFor(Dto));

  it('selects the column and never descends into its interior', () => {
    // Descending would emit ["theme"]["color"] and, for the projector, try to
    // select columns that do not exist.
    expect(compiled.source).not.toContain('"color"');
  });
});

describe('AD-2 — a gate wraps its child rather than replacing it', () => {
  class Dto extends extend(Pick(User, ['id']), {
    secret: visible<User, string, false>(
      (c) => (c as { admin?: boolean })?.admin === true,
      from<User, string>('email'),
    ),
  }) {}
  const compiled = compile(planFor(Dto));

  it('assigns the gated field when the predicate passes', () => {
    const out = compiled.invoke({ id: 'u1', email: 'a@b.c' }, { admin: true }) as Record<string, unknown>;
    expect(out['secret']).toBe('a@b.c');
  });

  it('leaves it undefined but present when the predicate fails', () => {
    const out = compiled.invoke({ id: 'u1', email: 'a@b.c' }, { admin: false }) as Record<string, unknown>;
    expect(out['secret']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out, 'secret')).toBe(true);
  });

  it('emits the child assignment inside the guard, not alongside it', () => {
    expect(compiled.source).toMatch(/if \(p\[0\]\(c\)\) \{[\s\S]*secret[\s\S]*\}/);
  });
});

describe('AD-9 — a plan is emitted sync or async, never both', () => {
  class Sync extends extend(Pick(User, ['id']), {}) {}
  class Async extends extend(Pick(User, ['id']), {
    url: resolve<User, string>(['id'], async (u) => `https://cdn/${u.id}`),
  }) {}

  it('emits a plain function for a sync plan', () => {
    const compiled = compile(planFor(Sync));
    expect(compiled.isAsync).toBe(false);
    expect(compiled.invoke({ id: 'u1' })).not.toBeInstanceOf(Promise);
  });

  it('emits an async function that awaits the resolver', () => {
    const compiled = compile(planFor(Async));
    expect(compiled.isAsync).toBe(true);
    expect(compiled.source).toContain('await');
  });

  it('resolves the awaited value rather than leaving a promise', async () => {
    const out = (await compile(planFor(Async)).invoke({ id: 'u1' })) as Record<string, unknown>;
    expect(out['url']).toBe('https://cdn/u1');
  });
});

describe('compilation happens once', () => {
  it('reuses one emitted function across calls', () => {
    class Dto extends extend(Pick(User, ['id']), {}) {}
    const compiled = compile(planFor(Dto));
    const a = compiled.invoke({ id: '1' });
    const b = compiled.invoke({ id: '2' });
    expect((a as Record<string, unknown>)['id']).toBe('1');
    expect((b as Record<string, unknown>)['id']).toBe('2');
    expect(a).not.toBe(b);
  });
});
