import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../descriptor/registry.js';
import { NO_PROVENANCE, type SchemaAdapter, type TypeDescriptor } from '../descriptor/types.js';
import { AutomapperError } from '../diagnose/automapper-error.js';
import { Pick, extend } from '../dto/pick.js';
import { compute, resolve, visible, ignore, constant, from } from '../dto/resolver.js';
import { buildPlan } from './planner.js';
import { children, walk, type ResolutionNode } from './node.js';

class Address {
  city!: string;
}
class User {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
  password!: string;
  settings!: Record<string, unknown>;
  address!: Address;
}

/** A stand-in for a real ORM adapter, so the planner is tested without one. */
const fakeOrm: SchemaAdapter = {
  name: 'fake-orm',
  supports: (t) => t === User || t === Address,
  describe: (t): TypeDescriptor =>
    t === Address
      ? {
          type: Address,
          fields: [
            { name: 'city', type: 'string', nullable: false, provenance: NO_PROVENANCE },
          ],
          relations: [],
          producedBy: 'fake-orm',
        }
      : {
          type: User,
          fields: [
            {
              name: 'id',
              type: 'string',
              nullable: false,
              nativeName: 'id',
              provenance: { ...NO_PROVENANCE, isPrimary: true, isGenerated: true },
            },
            { name: 'email', type: 'string', nullable: false, provenance: NO_PROVENANCE },
            { name: 'firstName', type: 'string', nullable: false, nativeName: 'first_name', provenance: NO_PROVENANCE },
            { name: 'lastName', type: 'string', nullable: true, provenance: NO_PROVENANCE },
            {
              name: 'password',
              type: 'string',
              nullable: false,
              provenance: { ...NO_PROVENANCE, isSelectByDefault: false },
            },
            { name: 'settings', type: 'json', nullable: false, provenance: NO_PROVENANCE },
          ],
          relations: [
            { name: 'address', target: () => Address, kind: 'one', nullable: true, joinColumns: ['address_id'] },
          ],
          producedBy: 'fake-orm',
        },
};

const registry = () => new AdapterRegistry().use(fakeOrm);

const ok = (r: ReturnType<typeof buildPlan>) => {
  if (!r.ok) throw new Error(`expected a plan, got: ${r.diagnostics.map((d) => d.code).join(', ')}`);
  return r.plan;
};
const nodeFor = (plan: { nodes: readonly ResolutionNode[] }, field: string) =>
  plan.nodes.find((n) => n.field === field);

describe('AD-2 — one top-level node per declared field', () => {
  class Dto extends extend(Pick(User, ['id', 'email']), {
    fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
    kind: constant<User, 'user'>('user'),
    skipped: ignore<User>(),
  }) {}

  const plan = ok(buildPlan(Dto, registry()));

  it('emits exactly one node per destination field', () => {
    expect(plan.nodes.map((n) => n.field)).toEqual(['id', 'email', 'fullName', 'kind', 'skipped']);
  });

  it('keeps a deliberate ignore in the plan', () => {
    // An ignore must be distinguishable from a typo, so it is a node kind
    // rather than an absence.
    expect(nodeFor(plan, 'skipped')?.kind).toBe('ignore');
  });

  it('lowers an unresolved field to a copy', () => {
    expect(nodeFor(plan, 'email')?.kind).toBe('copy');
  });
});

describe('AD-12 — paths are lowered to segments, never left as strings', () => {
  class Dto extends extend(Pick(User, ['id']), {
    city: compute<User, string>(['address.city'], (u) => u.address.city),
    theme: compute<User, unknown>(['settings.theme.color'], (u) => u.settings['theme']),
  }) {}

  const plan = ok(buildPlan(Dto, registry()));

  it('walks a relation into a relation segment then a field segment', () => {
    expect(nodeFor(plan, 'city')?.deps[0]).toEqual([
      { kind: 'relation', name: 'address', target: Address },
      { kind: 'field', name: 'city' },
    ]);
  });

  it('treats a json column as terminal and keeps its interior unexpanded', () => {
    // The projector selects `settings` and never descends — otherwise it would
    // try to select a column named `theme`.
    expect(nodeFor(plan, 'theme')?.deps[0]).toEqual([
      { kind: 'json', name: 'settings', interior: ['theme', 'color'] },
    ]);
  });

  it('carries no dotted strings anywhere in the plan', () => {
    for (const node of plan.nodes.flatMap(walk)) {
      for (const dep of node.deps) {
        expect(Array.isArray(dep)).toBe(true);
      }
    }
  });
});

describe('AD-1 — nodes carry the descriptor facts back-ends are denied', () => {
  class Dto extends extend(Pick(User, ['id', 'lastName']), {}) {}
  const plan = ok(buildPlan(Dto, registry()));

  it('denormalises provenance onto the node', () => {
    expect(nodeFor(plan, 'id')?.facts.provenance?.isGenerated).toBe(true);
  });

  it('denormalises nullability and the producing adapter', () => {
    expect(nodeFor(plan, 'lastName')?.facts.nullable).toBe(true);
    expect(nodeFor(plan, 'lastName')?.facts.producedBy).toBe('fake-orm');
  });
});

describe('AD-13 — a plan is total, or it is a report', () => {
  it('reports every defect at once rather than throwing on the first', () => {
    class Bad extends extend(Pick(User, ['id']), {
      a: compute<User, string>(['nope' as never], () => ''),
      b: compute<User, string>(['alsoNope' as never], () => ''),
    }) {}

    const result = buildPlan(Bad, registry());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((d) => d.code === 'DEP_UNKNOWN')).toBe(true);
  });

  it('throws for a structural defect, since planning is impossible', () => {
    class NotADto {}
    expect(() => buildPlan(NotADto, registry())).toThrow(AutomapperError);
  });

  it('throws when no adapter describes the source — also structural', () => {
    expect(() =>
      buildPlan(class extends extend(Pick(User, ['id']), {}) {}, new AdapterRegistry()),
    ).toThrow(/NO_ADAPTER/);
  });
});

describe('AD-9 / AD-10 — async and context are plan properties', () => {
  it('marks a plan async when any node resolves asynchronously', () => {
    class A extends extend(Pick(User, ['id']), {
      url: resolve<User, string>(['id'], async (u) => u.id),
    }) {}
    expect(ok(buildPlan(A, registry())).isAsync).toBe(true);
  });

  it('leaves a plan sync when nothing resolves asynchronously', () => {
    class S extends extend(Pick(User, ['id']), {}) {}
    expect(ok(buildPlan(S, registry())).isAsync).toBe(false);
  });

  it('marks a plan as requiring context when a field is gated', () => {
    class G extends extend(Pick(User, ['id']), {
      secret: visible<User, string, false>(() => true, from<User, string>('email')),
    }) {}
    const plan = ok(buildPlan(G, registry()));
    expect(plan.requiresContext).toBe(true);
    expect(nodeFor(plan, 'secret')?.kind).toBe('gated');
  });
});

describe('AD-2 — a gate is a wrapper node, and children() is the only recursion', () => {
  class G extends extend(Pick(User, ['id']), {
    secret: visible<User, string, false>(() => true, from<User, string>('email')),
  }) {}
  const plan = ok(buildPlan(G, registry()));
  const gate = nodeFor(plan, 'secret')!;

  it('exposes its child through children(), not a flag', () => {
    expect(children(gate)).toHaveLength(1);
    expect(children(gate)[0]?.kind).toBe('copy');
  });

  it('leaves non-wrapper kinds childless', () => {
    expect(children(nodeFor(plan, 'id')!)).toEqual([]);
  });

  /**
   * AD-2's second half. A back-end can satisfy the `never` exhaustiveness check
   * and still drop a field by returning nothing for a wrapper kind — the flat
   * switch below is exactly that bug, and this test is what catches it.
   */
  it('catches a back-end that is exhaustive over kind but drops a wrapper', () => {
    const flatSwitch = (n: ResolutionNode): string =>
      n.kind === 'gated' ? '' : n.field; // exhaustive, still wrong
    const asFold = (n: ResolutionNode): string =>
      n.kind === 'gated' ? asFold(children(n)[0]!) : n.field;

    expect(plan.nodes.map(flatSwitch).filter(Boolean)).toHaveLength(1); // dropped 'secret'
    expect(plan.nodes.map(asFold).filter(Boolean)).toHaveLength(plan.nodes.length);
  });
});

describe('CAP-4 — errors are diagnosable from their text alone', () => {
  it('names the field, source, adapter, and a near miss for a bad dep path', () => {
    class Typo extends extend(Pick(User, ['id']), {
      name: from<User, string>('firstNam' as never),
    }) {}

    const result = buildPlan(Typo, registry());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const text = result.diagnostics[0]!.message;
    expect(text).toContain('DEP_UNKNOWN');
    expect(text).toContain('User');
    expect(text).toContain('fake-orm');
    expect(text).toContain("did you mean 'firstName'?");
  });

});
