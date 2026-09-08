# The `@automapper/*` ecosystem — full coverage analysis

Scope check against **every** published `@automapper` package, not just `core`.
Surfaces read from the `nartc/mapper` source tree and the npm registry on
2026-09-08.

| Package | Version | Published | Role |
|---|---|---|---|
| `@automapper/core` | 9.0.2 | 2026-07-16 | Engine: mappings, member functions, profiles |
| `@automapper/classes` | 9.0.2 | 2026-07-16 | `@AutoMap` decorator, `classes()` strategy, ts transformer plugin |
| `@automapper/nestjs` | 9.0.2 | 2026-07-16 | Module, DI, `AutomapperProfile`, `MapPipe`, `MapInterceptor` |
| `@automapper/pojos` | 9.0.2 | 2026-07-16 | `PojosMetadataMap` — mapping plain objects with no classes |
| `@automapper/mikro` | 9.0.2 | 2026-07-16 | MikroORM entity strategy |
| `@automapper/sequelize` | 9.0.2 | 2026-07-16 | Sequelize model strategy |
| `@automapper/types` | 6.3.1 | 2021-10-28 | Abandoned |

---

## 1. The gap this analysis found

**Our design cannot describe a source that is not a runtime class.**

`Pick(User, ['id', 'email'])` needs `User` to exist at runtime. That holds for
TypeORM and Mikro entities, which are classes. It does **not** hold for:

- **Prisma** — models are generated TypeScript *types*. There is no class.
- **Kysely / Drizzle** — schemas are objects and inferred types.
- Plain interfaces, GraphQL codegen output, JSON API payloads.

`@automapper/pojos` exists for exactly this, via manual registration:

```ts
PojosMetadataMap.create<UserDto>('UserDto', { id: String, name: String });
```

Prisma is scheduled for 2.1 in our roadmap, and **as currently designed the
Prisma adapter cannot be built** — `SchemaAdapter.supports(type: ClassLike)`
and `describe(type: ClassLike)` both key on a constructor that does not exist.

This is a foundation issue, not a feature gap. It changes the `SchemaAdapter`
port, so it belongs before 2.1 rather than after.

### Proposed fix — `defineSchema()`

A token-keyed descriptor source, feeding the *same* pipeline:

```ts
export const PrismaUser = defineSchema('PrismaUser', {
  id:        { type: 'string', isPrimary: true, isGenerated: true },
  email:     { type: 'string' },
  createdAt: { type: 'date', isCreateDate: true },
});

class ReadUserDto extends extend(Pick(PrismaUser, ['id', 'email']), { … }) {}
```

`defineSchema` returns a real runtime object usable as a type token, so
`ClassLike` widens to `TypeToken = ClassLike | SchemaToken`.

**Why this beats `PojosMetadataMap`:** their metadata map feeds mapping only.
Ours feeds the one descriptor every back-end reads, so a POJO source still gets
projection push-down, OpenAPI generation, reverse mapping, and boot-time
validation. A Prisma user gets `select` push-down that `@automapper/pojos`
structurally cannot offer.

The Prisma adapter then generates these from DMMF instead of hand-writing them.

---

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

### `@automapper/pojos`

| Feature | Ours | Status |
|---|---|---|
| `PojosMetadataMap.create()` | — | ⬜ **blocking gap** — see §1 |

### `@automapper/mikro` and `@automapper/sequelize`

| Feature | Ours | Status |
|---|---|---|
| MikroORM entities | — | ⬜ post-2.2 |
| Sequelize models | — | ⬜ post-2.2 |
| `serializeEntity` (unwrap ORM proxies) | — | ⬜ **new gap** |

Their existence validates the `SchemaAdapter` port: five strategies over one
engine is the same shape we chose. `serializeEntity` is a warning though —
lazy-loaded proxies and reference wrappers need unwrapping before a generated
accessor touches them, and our emitted `s?.["x"]` would read a proxy field.

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

Six items enter the roadmap. Ordered by whether they block something else.

| # | Item | Why now | Lands |
|---|---|---|---|
| 1 | **`defineSchema()` + `TypeToken`** | Blocks the Prisma adapter and every non-class source. Changes the port, so it must precede 2.1. | **Phase 6a** |
| 2 | **Write path — `mapInput` / `MapDtoPipe`** | Half the use case is missing. Pairs naturally with reverse mapping, which already computes the drop list. | **Phase 6** (with CAP-8) |
| 3 | **`forRootAsync`** | Every real Nest app configures from `ConfigService`. Small. | **Phase 6a** |
| 4 | **Named mappers** | Multi-tenant and multi-context apps. `getMapperToken(name)`. | Phase 9 |
| 5 | **`isGetterOnly` / computed entity getters** | Real pattern our adapter cannot see. | Phase 9 |
| 6 | **Proxy unwrapping in adapters** | Lazy relations would otherwise be read straight off a proxy. | With each ORM adapter |

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
