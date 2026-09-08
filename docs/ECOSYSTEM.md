# The `@automapper/*` ecosystem — full coverage analysis

Scope check against the published `@automapper` packages. Surfaces read from
the `nartc/mapper` source tree and the npm registry on 2026-09-08.

Status as of 2026-09-09: every in-scope surface is covered, replaced with
something better, or refused with a stated reason. Nothing is left blank.

**In scope: `core`, `classes`, `nestjs`.** The ORM-strategy packages
(`pojos`, `mikro`, `sequelize`) and the abandoned `types` are out — we
compete on the NestJS + TypeORM path, and each ORM strategy is a separate
adapter that can follow later without changing anything here.

| Package | Version | Published | Role |
|---|---|---|---|
| `@automapper/core` | 9.0.2 | 2026-07-16 | Engine: mappings, member functions, profiles |
| `@automapper/classes` | 9.0.2 | 2026-07-16 | `@AutoMap` decorator, `classes()` strategy, ts transformer plugin |
| `@automapper/nestjs` | 9.0.2 | 2026-07-16 | Module, DI, `AutomapperProfile`, `MapPipe`, `MapInterceptor` |
| ~~`@automapper/pojos`~~ | 9.0.2 | 2026-07-16 | out of scope — plain-object metadata |
| ~~`@automapper/mikro`~~ | 9.0.2 | 2026-07-16 | out of scope — MikroORM strategy |
| ~~`@automapper/sequelize`~~ | 9.0.2 | 2026-07-16 | out of scope — Sequelize strategy |
| ~~`@automapper/types`~~ | 6.3.1 | 2021-10-28 | abandoned since 2021 |

---

## 1. Non-class sources — solved

`Pick(User, [...])` needs `User` at runtime. That holds for TypeORM entities.
It does not for Prisma, whose models are generated TypeScript *types*, nor for
Drizzle, Kysely, or plain interfaces.

`defineSchema()` closes it:

```ts
export const PrismaUser = defineSchema('PrismaUser', {
  id:        { type: 'string', isPrimary: true, isGenerated: true },
  email:     { type: 'string' },
  createdAt: { type: 'date', isCreateDate: true },
});

class ReadUserDto extends Pick(PrismaUser, ['id', 'email']) {}
```

**Why this beats `PojosMetadataMap`:** their metadata map feeds mapping only.
This feeds the one descriptor every back-end reads, so a Prisma source also
gets projection push-down, OpenAPI generation, and the write drop list — none
of which `@automapper/pojos` can offer.

Only the source side of the port widened; destinations stay constructible.
The Prisma adapter is now an adapter package rather than a port change.

## 2. Per-package coverage

### `@automapper/core`

Covered in `ROADMAP.md` §2. Summary: member functions and the mapper API are
largely covered; `nullSubstitution`, `undefinedSubstitution`, `convertUsing`,
`constructUsing`, `beforeMap`/`afterMap`, `typeConverters`, `extend`, and
`forSelf` are scheduled.

Two things worth naming that `core` has and we do not:

| Feature | Theirs | Ours |
|---|---|---|
| `assertUnmappedProperties` + `errorHandler` | Warns at **map** time, configurable | Fails at **boot** and in CI. No custom handler — a diagnostic you can configure away is one you will |
| `dispose()` | Releases mappings | Not needed — no global mutable registry (AD-7) |

### `@automapper/classes`

| Feature | Ours | Status |
|---|---|---|
| `@AutoMap()` per property | `Pick(Entity, [...])` | ✅ replaced |
| `@AutoMap({ type })` nested type hint | adapter relation metadata | ✅ replaced |
| `@AutoMap({ depth })` recursion depth | depth ceiling + identity map | ✅ |
| `@AutoMap({ isGetterOnly })` | `compute()` with declared deps | ⚠️ refused by design — see below |
| `classes()` strategy initializer | schema adapters | ✅ replaced |
| **ts transformer plugin** | not required | ✅ removed by design |

`isGetterOnly` is **deliberately not supported**. Auto-mapping a getter is
unsafe under projection: its source columns cannot be inferred, so the
projector would fetch nothing for it and the getter would compute from
unfetched fields — the exact under-fetch CAP-5 exists to prevent. Getters are
reachable through `compute(['firstName','lastName'], u => u.fullName)`, where
the deps are declared and the projection is therefore correct.

### `@automapper/nestjs`

The package we compete with most directly, and where we are thinnest.

| Feature | Ours | Status |
|---|---|---|
| `AutomapperModule.forRoot` | ✅ | ✅ |
| **`forRootAsync`** (`useFactory`, `inject`) | ✅ | ✅ · `useClass`/`useExisting` pending |
| `@InjectMapper()` | ✅ | ✅ |
| `getMapperToken(name)` — named mappers | ✅ | ✅ |
| `AutomapperProfile` injectable class | `forRoot({ dtos })` | ⚠️ flat list only |
| `MapInterceptor` (response) | `@MapTo` + `MapToInterceptor` | ✅ |
| **`MapPipe`** (request body → entity) | `MapBodyPipe` + `mapInput` | ✅ stricter — see below |
| `globalErrorHandler` | — | ❌ by design — see `assertUnmappedProperties` above |
| `globalNamingConventions` | adapter-owned (AD-15) | ⚠️ different design |

`MapPipe` was the sharpest omission and is now closed. `MapBodyPipe` reads
`metadata.metatype`, so plain `@Body() dto: CreateUserDto` works with no
factory call at the parameter — and it **rejects** unknown or database-owned
keys rather than mapping whatever it is handed. That is mass-assignment
protection derived from the schema, which `MapPipe` has no way to compute.

### Out of scope

`pojos`, `mikro`, and `sequelize` are strategy packages for sources we are not
targeting in 2.0. Their existence still validates the `SchemaAdapter` port —
five strategies over one engine is the shape we chose — and one detail is
worth carrying forward regardless: `mikro`'s `serializeEntity` exists to
unwrap lazy-loaded proxies and reference wrappers. That warning has been
acted on — `RelationMeta.isLazy` forces the plan async and makes the emitter
await, so a lazy relation never lands in a DTO as a promise.

---

## 3. What we offer that no package in the ecosystem does

Unchanged by this analysis, and still the reason to switch:

| | Why it is impossible for them |
|---|---|
| **Projection push-down** | Requires schema knowledge *and* declared deps. No strategy exposes either. |
| **Boot-time validation** | They validate at map time, because a plan is not built until first map. |
| **Diagnosable errors** | No registry of what *should* exist, so nothing to diff against. |
| **Typed dependency paths** | `forMember` selectors carry no path type. |
| **Reverse mapping** | Deleted from the predecessor precisely because there was no schema to read. |
| **OpenAPI from the descriptor** | No descriptor exists to generate from. |
| **Async as a compile error** | Sync/async is a call-site choice there, not a plan property. |
| **No transformer plugin** | `@automapper/classes` requires one, and it is a TS-compiler-API consumer. |

---

## 4. Plan status

Everything scheduled is done.

| # | Item | Status |
|---|---|---|
| 1 | Write path — `mapInput` / `MapBodyPipe` | ✅ Phase 6 |
| 2 | `forRootAsync` (+ `useClass`/`useExisting`) | ✅ Phase 6 / gap pass |
| 3 | Named mappers (`getMapperToken`) | ✅ Phase 9 |
| 4 | `isGetterOnly` | ❌ refused — unsafe under projection |
| 5 | `defaultTo`, type converters | ✅ Phase 10 |
| — | `defineSchema()` / `TypeToken` | deferred with Prisma — §1 |
| — | Proxy unwrapping | deferred with the ORMs that need it |

### Refused, with reasons

- **`beforeMap` / `afterMap`** — a hook for something the caller does in one
  line either side of the call. It buys indirection, not capability.
- **`constructUsing`** — the DTO constructor is generated and must assign every
  declared key (AD-19). A user-supplied constructor would silently reintroduce
  the v1 empty-object defect.
- **`dispose()`** — nothing to release; there is no global mutable registry.
- **`globalNamingConventions`** — AD-15 gives conversion exactly one owner.
- **`isGetterOnly`** — see above.

### Where the write path lands

`Write(User, [...])` marks the direction; the planner rejects a
database-owned field at seal, and `mapInput` rejects one arriving in a
request body.

```ts
@Post()
create(@Body() dto: CreateUserDto) { … }
// A client sending `id` or `createdAt` gets a 400 — the database owns them.
```

`MapPipe` maps whatever it is given. Ours knows which fields the client is not
allowed to supply, because it read the schema.
