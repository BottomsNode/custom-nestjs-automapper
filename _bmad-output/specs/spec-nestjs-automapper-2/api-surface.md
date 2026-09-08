# Draft public API surface

Companion to `SPEC.md`. Identifier names are **provisional**; the shapes and the information each carries are **load-bearing** — a capability depends on each one. Where a name changes during implementation, the obligation it satisfies does not.

## Descriptors

The metadata contract. `CAP-1`, `CAP-3`, `CAP-4`, `CAP-5`, `CAP-6`, `CAP-8`, and `CAP-9` all read from these.

```ts
// `any[]`, not `never[]` — with never[] these fail InstanceType's own
// constraint and every DTO instance type silently degrades to `any`.
type ClassLike<T = unknown>    = abstract new (...args: any[]) => T;
type Instantiable<T = unknown> = new (...args: any[]) => T;

// AD-14: every provenance flag is REQUIRED. An adapter that cannot determine
// one sets it explicitly to false, so "unknown" can never read as "no".
interface Provenance {
  isPrimary: boolean;  isGenerated: boolean;  isCreateDate: boolean;
  isUpdateDate: boolean;  isDeleteDate: boolean;  isVersion: boolean;
  isDiscriminator: boolean;  hasDefault: boolean;
  isSelectByDefault: boolean;   // false = the `password` case
}

interface FieldMeta {
  name: string;                 // class property name, verbatim (AD-15)
  nativeName?: string;          // DB column; adapter translation + did-you-mean only
  type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'enum' | 'unknown';
  nullable: boolean;
  enumValues?: readonly unknown[];
  provenance: Provenance;
}

interface RelationMeta {
  name: string;
  target: () => ClassLike;      // lazy: tolerates circular imports
  kind: 'one' | 'many';
  nullable: boolean;
  joinColumns?: readonly string[];   // CAP-8 relation reversal
}

interface TypeDescriptor {
  type: ClassLike;
  fields: readonly FieldMeta[];
  relations: readonly RelationMeta[];
  producedBy: string;           // adapter name; appears in CAP-4 errors
}

// AD-10: `fields: []` means EXACTLY NONE. `all` is the explicit escape hatch —
// the empty array is never overloaded to mean "everything".
interface FieldSelection {
  fields: readonly string[];
  relations: Readonly<Record<string, FieldSelection>>;
  all?: true;
}

interface SchemaAdapter {
  readonly name: string;
  supports(type: ClassLike): boolean;      // pure, non-throwing (AD-17)
  describe(type: ClassLike): TypeDescriptor;
  toNativeProjection?(sel: FieldSelection, type: ClassLike): unknown;
}
```

## DTO construction

`Pick` returns a **real runtime class**, which is what gives a DTO a descriptor without decorators (`CAP-1`). `extend` attaches resolvers such that one declaration yields both the static type and the runtime resolution (`CAP-2`).

```ts
export class ReadUserDto extends extend(Pick(User, ['id', 'email', 'createdAt']), {
  fullName: compute(['firstName', 'lastName'], u => `${u.firstName} ${u.lastName}`),
}) {}
```

A class declaration extending the expression — the same shape as Nest's `PickType`, so the form is already familiar. One name serves as both value and type, with no alias.

**Corrected during implementation.** The earlier draft of this document specified `export const X = extend(...)` plus `export type X = InstanceType<typeof X>`. That form is **not supported and must not be used**: the self-referential alias makes TypeScript break the cycle by falling back to the key parameter's constraint, so the DTO silently regains *every* field of the source entity — `password` included. It type-checks, it looks right, and it quietly defeats the entire point of `Pick`.

**Verified working**, and the live suite now lives in the repo rather than a scratch spike: `packages/core/src/dto/type-assertions.test-d.ts` (compile-time assertions on every inference claim, plus six `@ts-expect-error` negatives that fail the build if they ever stop erroring) and `pick.spec.ts` (24 runtime assertions). Both pass under TypeScript 6.0.3 and 7.0.2.

Four findings, each of which cost a real bug during implementation:

- Naming the helper `Pick` does **not** shadow TypeScript's built-in `Pick<T, K>` type — value and type namespaces stay separate.
- The constructor must assign every declared key (even as `undefined`) so instances carry real own-properties. Omitting this reproduces the v1 defect exactly.
- `ClassLike`/`Instantiable` must use `(...args: any[])`, not `never[]`. With `never[]` they fail to satisfy `InstanceType`'s own constraint, so `InstanceType<typeof SomeDto>` silently resolves to `any` and **every type assertion passes vacuously** — the tests go green while proving nothing.
- `Pick`'s key parameter must be a `const` tuple (`const K extends readonly (keyof T & string)[]`), not a per-element `K extends keyof T & string`. With the element form, calling `Pick` inline as an argument resolves `K` before `T` and falls back to `K`'s constraint, readmitting every source field. It behaved correctly only when assigned to a variable first.

## Resolvers

```ts
auto()                      // convention copy, explicit
from(path)                  // rename or nested source path
compute(deps, fn)           // derived; deps typed as Path<S>  → CAP-10
resolve(deps, asyncFn)      // async; marks the plan async
nested(() => Dto)           // to-one relation
collection(() => Dto)       // to-many relation
constant(value)
ignore()
visible(pred, inner?)       // context gate (SHOULD tier)
```

Composable: `email: visible(c => c.role === 'admin', from('emailAddress'))`.

Two typing obligations:
- `visible()` widens its result to `T | undefined`, so a gated field's declared type stays honest and gating a required field is a type error rather than a runtime check.
- `resolve()` unwraps to `Awaited<R>` and marks the DTO async, so the mapped field type is the resolved value, not a promise.

## Mapper

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

  projectionFor<S, D>(s: ClassLike<S>, d: ClassLike<D>, o?: { ctx?: Ctx }): FieldSelection;
  nativeProjectionFor<S, D>(s: ClassLike<S>, d: ClassLike<D>, o?: { ctx?: Ctx }): unknown;

  reverse<S, D, W>(s: ClassLike<S>, d: ClassLike<D>, write: ClassLike<W>): this;
  schemaOf<D>(dest: ClassLike<D>): OpenApiSchema;
  explain<S, D>(s: ClassLike<S>, d: ClassLike<D>): MappingExplanation;
  validateAll(): PlanReport;          // the boot sweep behind CAP-3
}
```

`projectionFor` accepts context because context-gated fields change what must be fetched — an admin request projects more columns than a public one.

## Error format

`CAP-4`'s obligation, illustrated. The information shown is required; the layout is not.

```
MappingNotFoundError: no map User → ReadUserDto

  Maps registered from User:  AdminUserDto, UserSummaryDto
  Did you mean AdminUserDto?

  Register it:  createMap(User, ReadUserDto)
  Nearest profile: src/mapping/user.profile.ts:14
```

```
MappingPlanError: ReadUserDto has 1 unresolved field

  .displayName   no source 'displayName' on User (adapter: typeorm)
                 did you mean 'display_name'?

  Resolve it, or mark it ignore().
```

## NestJS integration

```ts
AutomapperModule.forRoot({
  adapters: [typeorm(dataSource)],
  validate: true,            // build every plan onModuleInit; fail boot → CAP-3
  contextFactory: req => ({ role: req.user.role }),
});

AutomapperModule.forFeature([UserProfile]);   // non-global; multi-source DTOs

@InjectMapper() private readonly mapper: Mapper<AppCtx>;

@Get()
@MapTo(ReadUserDto)
findAll(@Projection(ReadUserDto) find: FindManyOptions<User>) {
  return this.repo.find(find);
}
```

Request context reaches the mapper through `AsyncLocalStorage` in this package; `core` keeps the explicit parameter form.

CI equivalent of the boot sweep: `npx automapper check`.

## TypeORM adapter

```ts
typeorm(dataSource)
// describe()            ← dataSource.getMetadata(Entity)
// provenance flags      ← column.isGenerated / isPrimary / isCreateDate /
//                         isUpdateDate / isDeleteDate
// joinColumns           ← relation.joinColumns
// toNativeProjection()  → { select: {...}, relations: {...} }
```

## Reference hello-world

The shape the Success signal is measured against.

```ts
// app.module.ts
AutomapperModule.forRoot({ adapters: [typeorm(dataSource)], validate: true })

// user.dto.ts
export class ReadUserDto extends extend(Pick(User, ['id', 'email', 'createdAt']), {
  fullName: compute(['firstName', 'lastName'], u => `${u.firstName} ${u.lastName}`),
}) {}

// user.controller.ts
@Get()
@MapTo(ReadUserDto)
findAll(@Projection(ReadUserDto) find: FindManyOptions<User>) {
  return this.repo.find(find);
}
```

No mapping decorators, no transformer plugin, no profile class. The issued query selects `id`, `email`, `created_at`, `first_name`, `last_name` and nothing else.
