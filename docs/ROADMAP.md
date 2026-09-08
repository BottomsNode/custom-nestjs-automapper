# @nestjs-automapper 2.0 — Build Tracker

Phase-by-phase status, plus what we cover from `@automapper/core` and what we
add that it does not have.

**Contract:** `_bmad-output/specs/spec-nestjs-automapper-2/SPEC.md` (CAP-1…CAP-10)
**Invariants:** `_bmad-output/planning-artifacts/architecture/architecture-custom-nestjs-automapper-2026-09-08/ARCHITECTURE-SPINE.md` (AD-1…AD-20)

Last updated: 2026-09-08 · branch `v2` · 97 tests passing

---

## 1. Phase status

| Phase | Scope | Capabilities | Status |
|---|---|---|---|
| **0** | Nx + pnpm workspace, 3 packages, dual ESM/CJS, TS 6/7 split | — | ✅ done |
| **1** | Descriptors, `Pick`/`extend`, typed paths | CAP-1, CAP-2, CAP-10 | ✅ done |
| **2** | `MappingPlan` IR, planner, error taxonomy | CAP-4 | ✅ done · CAP-3 partial |
| **3** | Codegen emitter | — | ✅ done |
| **4** | Projector + TypeORM adapter | CAP-5 | ✅ done · CAP-6 pending |
| **5** | `Mapper` facade, NestJS module, seal lifecycle | CAP-3 | ✅ done · CLI pending |
| **6** | Reverse mapping (scalars) | CAP-8 | ⬜ next |
| **7** | `schemaOf` → OpenAPI | CAP-9 | ⬜ |
| **8** | Nested/collection + identity map | CAP-6, CAP-7 | ⬜ |

### Phase 0 — Workspace ✅

Nx 23.2 + pnpm 12.3.4. Packages: `core` (zero deps), `typeorm`, `nestjs`.
Dual ESM + CJS with explicit `exports` maps (AD-20). Emit on TypeScript 6.0.3
via the `@typescript/typescript6` alias; CI additionally type-checks under
7.0.2 (AD-11). `scripts/tsc6.mjs` hard-fails if it resolves a non-6.x
compiler, because `node_modules/.bin/tsc` is the 7.x line. CI asserts `core`
declares zero dependencies.

### Phase 1 — DTO contract ✅

`Pick(Entity, [...])` and `extend(Base, resolvers)` return real runtime
classes. Constructors assign every declared key, which is the direct fix for
the v1 defect where a presence check against the destination was always false
and every mapping produced `{}`.

Enforced by a compile-time assertion suite (`type-assertions.test-d.ts`) run
on both TypeScript lines. It caught three defects that review and runtime
tests both missed — see §4.

### Phase 2 — IR and diagnostics ✅

`ResolutionNode` closed union, `children()` as the only recursion, one
top-level node per destination field. Paths lower to `PathSegment[]` before
entering the IR (AD-12). `buildPlan` returns aggregated diagnostics rather
than throwing on the first defect (AD-13). Errors carry structured payloads
closed per code, rendered only by `core` (AD-5), with did-you-mean.

CAP-3 is partial: defects are *detected* here, but nothing converts them to a
boot failure until Phase 5 supplies `seal()`.

### Phase 3 — Codegen ✅

One specialised function per plan via `new Function`. Keys are emitted as
bracketed string literals through `JSON.stringify`, identifiers come from a
fixed emitter-controlled alphabet, and resolver functions are passed as
closure arguments rather than stringified (AD-3). Tested against a column
literally named `"; globalThis.PWNED = 1; //`.

### Phase 4 — Projection ✅

`projectionFor(plan)` → neutral `FieldSelection`; the TypeORM adapter
translates it to `{ select, relations }`. Core never emits an ORM shape.
A gated plan throws without a context rather than projecting the union of all
contexts, which would silently over-fetch (AD-10).

### Phase 5 — Mapper facade + NestJS ✅

`Mapper` implements declare → seal → serve (AD-16): `map` before `seal()`
throws, `register` after it throws, so lazy first-call planning is
unreachable and CAP-3 cannot be silently opted out of.
`AutomapperModule.forRoot({ adapters, dtos })` seals on `onModuleInit` and
fails boot on a diagnostic. Ships `@InjectMapper`, `@MapTo` +
`MapToInterceptor` (registered via `APP_INTERCEPTOR`).

Deferred: the `automapper check` CLI, so CAP-3's "detectable in CI without
starting the application" is not yet met — boot failure covers dev.
`@Projection` is also deferred: as a param decorator it needs either a
service locator or an injectable-pipe dance, and
`mapper.nativeProjectionFor(Dto)` already covers it from a service.
`forFeature` waits for a real multi-module case.

### Phase 6 — Reverse mapping ⬜

`reverse()` deriving a write DTO, dropping fields the write policy owns —
primary keys, generated columns, create/update/delete timestamps, version,
discriminator (AD-14). `isSelectByDefault === false` is explicitly *not* a
drop reason; that is the `password` case. Relation → foreign-key reversal
stays SHOULD-tier.

### Phase 7 — OpenAPI ⬜

`schemaOf(Dto)` from the descriptor. Promoted to MUST because `extend`
removes the syntactic declaration site `@ApiProperty` needs, so shipping
`extend` without it would ship a Swagger regression.

### Phase 8 — Graphs ⬜

`nested()`/`collection()` resolvers, then CAP-6 auto-registration and the
per-operation identity map: cycle detection by ancestor chain, nested dedupe,
resolver memoisation (AD-7). Deliberately last — every piece of it is
unreachable until nested nodes have a producer.

---

## 2. Parity with `@automapper/core`

Surface enumerated from its published source tree on 2026-09-08.

### Mapping configuration

| `@automapper/core` | Ours | Status |
|---|---|---|
| `forMember` | `compute` / `from` / `constant` | ✅ |
| `autoMap` + `@AutoMap()` per property | `Pick(Entity, [...])` | ✅ replaced — no decorators, no plugin |
| `namingConventions` | adapter owns conversion (AD-15) | ⚠️ adapter-side only |
| `extend` (map inheritance) | — | ⬜ Phase 6 |
| `constructUsing` | — | ⬜ Phase 6 |
| `beforeMap` / `afterMap` | — | ⬜ Phase 6 |
| `beforeMapArray` / `afterMapArray` | — | ⬜ Phase 6 |
| `typeConverters` | — | ⬜ Phase 6 |
| `forSelf` | — | ⬜ Phase 8 |

### Member functions

| `@automapper/core` | Ours | Status |
|---|---|---|
| `mapFrom` | `from(path)` | ✅ |
| `fromValue` | `constant(value)` | ✅ |
| `ignore` | `ignore()` | ✅ |
| `mapInitialize` | implicit copy | ✅ |
| `mapWithArguments` | `ctx` parameter | ✅ richer — typed, request-scoped |
| `condition` / `preCondition` | `visible(pred, inner)` | ⚠️ context-gated; value predicates pending |
| `nullSubstitution` | — | ⬜ Phase 6 |
| `undefinedSubstitution` | — | ⬜ Phase 6 |
| `convertUsing` | — | ⬜ Phase 6 |
| `mapWith` / `mapDefer` | `nested()` / `collection()` | ⬜ Phase 8 |

### Mapper API

| `@automapper/core` | Ours | Status |
|---|---|---|
| `map` | `Mapper.map` | ✅ |
| `mapArray` | `Mapper.mapArray` | ✅ |
| `mapAsync` / `mapArrayAsync` | `Mapper.mapAsync` / `mapArrayAsync` | ✅ |
| `mapMutate` | — | ⬜ not scheduled |
| Profiles | `forRoot({ dtos })` | ⚠️ flat list; profile classes are SHOULD tier |
| `addProfile` | `forFeature` | ⬜ deferred |
| Strategies (`classes` / `pojos`) | schema adapters | ✅ replaced — pluggable per ORM |
| Transformer plugin | **not required** | ✅ removed by design |

**Deliberately not carried over:** the ts transformer plugin (a compiler-API
consumer, so it cannot run under TypeScript 7), and `@AutoMap()` on every
property of both sides.

---

## 3. What we add that `@automapper/core` does not have

| Capability | What it does | Status |
|---|---|---|
| **Projection push-down** (CAP-5) | The DTO decides which columns are fetched. 8-column entity, 4-field DTO → 4 columns in the `SELECT`. | ✅ Phase 4 |
| **Schema adapters** (CAP-1) | Field metadata from the ORM you already use. Zero decorators, zero build plugin. | ✅ Phase 4 |
| **Context-gated fields** | One DTO whose fields vary by role/tenant, instead of a DTO per audience. Projection respects the gate. | ✅ Phase 4 |
| **Diagnosable errors** (CAP-4) | Names the field, the source, the adapter, and a did-you-mean. Structurally impossible without descriptors. | ✅ Phase 2 |
| **Typed dependency paths** (CAP-10) | A mistyped source path is a compile error; TypeScript volunteers the correction. | ✅ Phase 1 |
| **Real codegen** (AD-3) | One emitted function per plan. No reflection in the hot path, and injection-safe. | ✅ Phase 3 |
| **Async branding** (AD-9) | Synchronously mapping an async DTO is a compile error, not a runtime throw. | ✅ Phase 1 |
| **Boot-time validation** (CAP-3) | An unresolved field fails `nest start`, not a request. | ✅ Phase 5 · CLI pending |
| **Reverse mapping** (CAP-8) | Derives the write DTO, dropping database-owned fields from schema flags. Deleted from the incumbent because it had no schema to read. | ⬜ Phase 6 |
| **OpenAPI generation** (CAP-9) | Schema from the descriptor — types, nullability, enums — with no `@ApiProperty`. | ⬜ Phase 7 |
| **Cycle-safe graphs** (CAP-7) | Ancestor-chain detection, so shared references still map while true cycles terminate. | ⬜ Phase 8 |
| **DTO-to-query compilation** | Skip entity hydration entirely. | ❌ 3.0 — see `scope-tiers.md` |

---

## 4. Defects the tests caught

Kept as a record of what earned its keep.

| Found by | Defect |
|---|---|
| Compile-time assertions | `ClassLike` used `never[]`, failing `InstanceType`'s constraint — every DTO type degraded to `any` and **all assertions passed vacuously**. |
| Compile-time assertions | `Pick`'s key parameter was per-element, so calling it inline resolved `K` before `T` and fell back to `keyof T`, readmitting `password`. Correct only when assigned to a variable first. |
| Compile-time assertions | `extend` inferred a positional `B` from an intersection, which widens. |
| Architecture review | AD-1 forbade back-ends from reading descriptors but nothing said the plan carried those facts — CAP-4, CAP-8 and CAP-9 were unimplementable. |
| Architecture review | AD-4 mandated `WeakMap`, which is not enumerable, making CAP-4's "maps registered from X" impossible. Two ADs contradicted each other. |
| Version review | The TS 7 "moat" was overstated: the incumbent's plugin works under the standard alias setup. Downgraded to an ergonomic edge. |
| Version review | TypeORM exposes `isVersion`, `isDiscriminator`, `isSelectByDefault` — all three missing from the original design, all three load-bearing for CAP-8. |

---

## 5. Known gaps

- **`describe()` has no live-DataSource test.** `toFindOptions` is pure and tested; `describe()` needs a real driver. Mocking TypeORM's metadata classes would only test the mock.
- **No `automapper check` CLI**, so CAP-3 is met at boot but not yet in CI.
- **Implicit primary key in projections.** Nothing yet adds the PK when a DTO omits it. TypeORM often needs it to hydrate relations.
- **`@nestjs-automapper` npm org not created.** Package names verified free; the org needs `npm org create` under your account.
