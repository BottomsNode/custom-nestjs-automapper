# @nestjs-automapper v2 — Design Record

> [!WARNING]
> **SUPERSEDED.** This early draft was replaced by the 2.0 spec. Five decisions
> here are stale: `visible()` and async enforcement moved to compile time; the
> caching section is void (replaced by a per-operation identity map); `createMap`
> is demoted to optional; the DTO-descriptor gap is answered by an entity-derived
> DTO class; and OpenAPI schema generation is new scope not present below. For
> what shipped, read the package READMEs and `docs/ROADMAP.md`. Retained for
> traceability only.


Status: decisions locked, implementation not started.
v1 source archived on branch `v1-archive`; `src/` removed from `master`.

## 1. Why v2 exists

v1 was a runtime-reflection mapper whose decorator pipeline never executed
(metadata was written to `prototype + propertyKey` and read from the
constructor). Rather than repair it, v2 is a rebuild around three capabilities
that `@automapper/core` does not provide:

1. **Schema adapters** — field metadata comes from the ORM you already use,
   so DTOs need no decorators.
2. **Projection push-down** — a DTO derives the ORM `select`/`include`, so you
   fetch exactly what you map. Removes over-fetch and N+1 by construction.
3. **Context-aware mapping** — one DTO whose fields are gated by request
   context (role, tenant, locale), replacing the DTO-per-audience explosion.

## 2. Locked decisions

| # | Area | Decision |
|---|------|----------|
| 1 | Metadata source | `SchemaAdapter` interface; decorators are an optional override layer |
| 2 | Execution | Runtime codegen via `new Function`, one specialized fn per (Source, Dest) pair |
| 3 | Packaging | Monorepo, scope `@nestjs-automapper/*` |
| 4 | v1 disposition | Branch `v1-archive`; `src/` deleted on `master` |
| 5 | Async model | Split `map` / `mapAsync`. Plan records `isAsync` per node; `map()` on an async plan throws at `createMap`, not at call time |
| 6 | Strictness | Unresolved destination field is an error at `createMap`. No silent `undefined` |
| 7 | Context | Explicit `ctx` param in core (auto-threaded into nested maps); AsyncLocalStorage ambient context in `/nestjs` |
| 8 | Resolver deps | Explicitly declared. No proxy tracing, no `fn.toString()` parsing |
| 9 | Config authoring | Plain object keyed by destination field; fluent builder is sugar producing the same object |
| 10 | 2.0 scope | `core` + `typeorm` + `nestjs`. Prisma 2.1, Mongoose/Drizzle 2.2 |
| 11 | Tooling | Nx monorepo |

## 3. Architecture spine

```
  SchemaAdapter(s)  ─┐
  @decorators       ─┼──►  TypeDescriptor
  explicit config   ─┘      { fields, relations, nullability, nativeNames }
                                    │
                                    ▼
                             MappingPlan   ◄── the IR
                     one ResolutionNode per destination field
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        CodeEmitter            Projector             Explainer
     new Function(...)     neutral FieldSelection   per-field trace
      zero reflection       ──► adapter.toNative()   "why undefined"
```

`MappingPlan` is the keystone. Codegen, projection, and diagnostics are all
readers of the same IR — they can never disagree about what a mapping does.

**Core stays zero-dependency.** It cannot emit Prisma or TypeORM shapes, so the
Projector produces a neutral `FieldSelection` tree and the adapter package
translates it to that ORM's native options. A new ORM is a self-contained
adapter, not a change to core.

## 4. The dependency constraint

Projection needs to know which *source* columns feed each *destination* field.
A lambda is opaque:

```ts
fullName: s => s.firstName + ' ' + s.lastName
```

The projector sees destination `fullName`; no such column exists. Without
declared deps it either under-fetches (field resolves to garbage) or falls back
to `SELECT *` (the feature dies). Therefore every computed resolver declares
its source paths as data:

```ts
fullName: compute(['firstName', 'lastName'], s => `${s.firstName} ${s.lastName}`)
```

Rejected alternatives: proxy tracing under-collects on branches and loops;
`fn.toString()` parsing breaks on minification and aliasing. Both reintroduce
the silent-wrong-output class of bug that decision #6 exists to eliminate.

Declared deps are also validated against the source descriptor at `createMap`,
so a typo in a dep path is a boot-time error.

## 5. Public API surface (draft — under review)

### Descriptors

```ts
type ClassLike<T = any> = abstract new (...args: any[]) => T;

interface FieldMeta {
  name: string;             // property on the type
  nativeName?: string;      // DB column, e.g. created_at
  type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'enum' | 'unknown';
  nullable: boolean;
  isPrimary?: boolean;
  enumValues?: readonly unknown[];
}

interface RelationMeta {
  name: string;
  target: () => ClassLike;  // lazy, tolerates circular imports
  kind: 'one' | 'many';
  nullable: boolean;
  nativeName?: string;
}

interface TypeDescriptor {
  type: ClassLike;
  fields: FieldMeta[];
  relations: RelationMeta[];
  producedBy: string;       // adapter name, surfaced in errors
}

interface FieldSelection {
  fields: string[];
  relations: Record<string, FieldSelection>;
}

interface SchemaAdapter {
  readonly name: string;
  supports(type: ClassLike): boolean;
  describe(type: ClassLike): TypeDescriptor;
  toNativeProjection?(sel: FieldSelection, type: ClassLike): unknown;
}
```

### Resolvers (config values)

```ts
auto()                              // convention copy; explicit opt-in
from(path)                          // rename or nested source path
compute(deps, fn)                   // computed; deps required
resolve(deps, asyncFn)              // async; forces mapAsync
nested(() => Dto, opts?)            // to-one relation
collection(() => Dto, opts?)        // to-many relation
constant(value)
ignore()
visible(pred, inner?)               // context gate; wraps another resolver
```

Resolvers compose: `email: visible(c => c.role === 'admin', from('emailAddress'))`.

### Mapper

```ts
class Mapper<Ctx = unknown> {
  constructor(options?: MapperOptions<Ctx>);

  use(adapter: SchemaAdapter): this;
  createMap<S, D>(source: ClassLike<S>, dest: ClassLike<D>,
                  config?: MappingConfig<S, D, Ctx>,
                  options?: MapOptions<S, D, Ctx>): this;

  map<S, D>(src: S, dest: ClassLike<D>, opts?: { ctx?: Ctx }): D;
  mapArray<S, D>(src: S[], dest: ClassLike<D>, opts?: { ctx?: Ctx }): D[];
  mapAsync<S, D>(src: S, dest: ClassLike<D>, opts?: { ctx?: Ctx }): Promise<D>;
  mapArrayAsync<S, D>(src: S[], dest: ClassLike<D>, opts?: { ctx?: Ctx }): Promise<D[]>;

  projectionFor<S, D>(source: ClassLike<S>, dest: ClassLike<D>,
                      opts?: { ctx?: Ctx }): FieldSelection;
  nativeProjectionFor<S, D>(source: ClassLike<S>, dest: ClassLike<D>,
                            opts?: { ctx?: Ctx }): unknown;

  explain<S, D>(source: ClassLike<S>, dest: ClassLike<D>): MappingExplanation;
}
```

`projectionFor` takes `ctx` because context-gated fields change what needs
fetching — an admin request projects more columns than a public one.

### NestJS package

```ts
AutomapperModule.forRoot({ adapters, profiles, strict, contextFactory });
AutomapperModule.forFeature([UserProfile]);

@InjectMapper() private readonly mapper: Mapper<AppCtx>;

@Get()
@MapTo(ReadUserDto)                         // interceptor maps the return value
findAll(@Projection(ReadUserDto) select) {  // native find options, injected
  return this.repo.find(select);
}
```

### TypeORM adapter

```ts
new TypeOrmAdapter(dataSource)
// describe()             <- dataSource.getMetadata(Entity)
// toNativeProjection()   -> { select: {...}, relations: {...} }
```

## 6. Open questions

1. **Default cycle policy.** Options: `throw`, `null`, `ref` (emit `{ $ref: id }`,
   changes payload shape), `prune` (omit the back-edge). `prune` conflicts with
   strict mode when the back-reference field is non-optional.
2. **`visible()` under strict.** A context-gated field is absent for some
   contexts. Proposal: strict requires such fields to be optional or nullable in
   the destination descriptor, and rejects `visible()` on a required field.
3. **Nx package manager.** Nx supports npm/yarn/pnpm. Repo currently has
   `yarn.lock`. pnpm's strict resolution best protects the zero-dep guarantee
   for core.
4. **Codegen and CSP.** `new Function` is fine on Node. If a browser build is
   ever wanted, the CLI emitter (2.3) becomes the fallback path.
