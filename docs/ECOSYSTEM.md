# The `@automapper/*` ecosystem — full coverage analysis

Scope check against the published `@automapper` packages. Surfaces read from
the `nartc/mapper` source tree and the npm registry on 2026-09-08.

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

## 1. Deferred: non-class sources

`Pick(User, [...])` needs `User` to exist at runtime. That holds for TypeORM
entities. It does not hold for Prisma, whose models are generated TypeScript
*types*, nor for Drizzle, Kysely, or plain interfaces.

`@automapper/pojos` solves this with a manual metadata map. With that package
out of scope, the only remaining driver is the Prisma adapter — which is 2.1,
after this release. So a `defineSchema()` token source is **deferred to
whenever Prisma lands**, not built now.

The one cost of deferring: widening `SchemaAdapter` later is a breaking change
for third-party adapter authors. There are none yet, so the cost is currently
zero and paying it early would be scaffolding.

When it is built, it should feed the same descriptor every back-end reads —
so a Prisma source still gets projection push-down, OpenAPI, and reverse
mapping. `PojosMetadataMap` feeds mapping only.

## 2. Per-package coverage

### `@automapper/core`

Covered in `ROADMAP.md` §2. Summary: member functions and the mapper API are
largely covered; `nullSubstitution`, `undefinedSubstitution`, `convertUsing`,
`constructUsing`, `beforeMap`/`afterMap`, `typeConverters`, `extend`, and
`forSelf` are scheduled.

Two things worth naming that `core` has and we do not:

| Feature | Theirs | Ours |
|---|---|---|
| `assertUnmappedProperties` + `errorHandler` | Warns at **map** time, configurable | Fails at **boot** — strictly better placement, but no custom handler yet |
| `dispose()` | Releases mappings | Not needed — no global mutable registry (AD-7) |

### `@automapper/classes`

| Feature | Ours | Status |
|---|---|---|
| `@AutoMap()` per property | `Pick(Entity, [...])` | ✅ replaced |
| `@AutoMap({ type })` nested type hint | adapter relation metadata | ✅ replaced |
| `@AutoMap({ depth })` recursion depth | depth ceiling (AD-7) | ⬜ Phase 8 |
| `@AutoMap({ isGetterOnly })` | — | ⬜ **new gap** — entities with computed getters |
| `classes()` strategy initializer | schema adapters | ✅ replaced |
| **ts transformer plugin** | not required | ✅ removed by design |

`isGetterOnly` is a genuine miss: a `get fullName()` on an entity is a real
pattern, and our adapter reads columns only, so it never sees one.

### `@automapper/nestjs`

The package we compete with most directly, and where we are thinnest.

| Feature | Ours | Status |
|---|---|---|
| `AutomapperModule.forRoot` | ✅ | ✅ |
| **`forRootAsync`** (`useFactory`, `inject`, `useClass`) | — | ⬜ **new gap** — standard for `ConfigService` |
| `@InjectMapper()` | ✅ | ✅ |
| `getMapperToken(name)` — **named mappers** | single mapper | ⬜ **new gap** |
| `AutomapperProfile` injectable class | `forRoot({ dtos })` | ⚠️ flat list only |
| `MapInterceptor` (response) | `@MapTo` + `MapToInterceptor` | ✅ |
| **`MapPipe`** (request body → entity) | — | ⬜ **new gap** — the entire write path |
| `globalErrorHandler` | — | ⬜ |
| `globalNamingConventions` | adapter-owned (AD-15) | ⚠️ different design |

`MapPipe` is the sharpest omission. We map responses out; we do not map
requests in. That is half of what a mapper is for.

### Out of scope

`pojos`, `mikro`, and `sequelize` are strategy packages for sources we are not
targeting in 2.0. Their existence still validates the `SchemaAdapter` port —
five strategies over one engine is the shape we chose — and one detail is
worth carrying forward regardless: `mikro`'s `serializeEntity` exists to
unwrap lazy-loaded proxies and reference wrappers. Our emitted `s?.["x"]`
would read a proxy field directly, so any adapter for a proxying ORM needs the
same unwrap step.

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

## 4. Revised plan

Four items enter the roadmap; two are deferred.

| # | Item | Why | Lands |
|---|---|---|---|
| 1 | **Write path — `mapInput` / `MapDtoPipe`** | `MapPipe` maps request bodies; we only map responses out. Half the use case. Reuses the reverse drop list. | **Phase 6** |
| 2 | **`forRootAsync`** | Every real Nest app configures from `ConfigService`. | **Phase 6** |
| 3 | **Named mappers** (`getMapperToken`) | Multi-tenant and multi-context apps. | Phase 9 |
| 4 | **`isGetterOnly`** | A `get fullName()` on an entity is a real pattern our adapter cannot see. | Phase 9 |
| — | `defineSchema()` / `TypeToken` | Deferred with Prisma — see §1. | 2.1 |
| — | Proxy unwrapping | Deferred with the ORMs that need it. | post-2.0 |

Deliberately **not** adopted: `dispose()` (no global mutable registry to
release), and `globalNamingConventions` (AD-15 gives conversion exactly one
owner — the adapter).

### Where the write path lands

`reverse()` already derives the drop list from provenance. The pipe is that
same computation applied to input, and it does something `MapPipe` cannot:

```ts
@Post()
create(@Body(MapDtoPipe(CreateUserDto)) user: User) { … }
// A client sending `id` or `createdAt` is rejected — the database owns them.
```

`MapPipe` maps whatever it is given. Ours knows which fields the client is not
allowed to supply, because it read the schema.
