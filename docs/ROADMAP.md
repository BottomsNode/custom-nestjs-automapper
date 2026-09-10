# @nestjs-automapper 2.0 — Build Tracker

Phase-by-phase status, plus what we cover from `@automapper/core` and what we
add that it does not have.

> **Tests are not in this repository.** They are kept locally and are neither
> committed nor published — see `TESTING.md`. Test counts quoted below are
> historical, recorded at the time each phase was verified.

**Contract:** `_bmad-output/specs/spec-nestjs-automapper-2/SPEC.md` (CAP-1…CAP-10)
**Invariants:** `_bmad-output/planning-artifacts/architecture/architecture-custom-nestjs-automapper-2026-09-08/ARCHITECTURE-SPINE.md` (AD-1…AD-20)

Last updated: 2026-09-11 · **2.0.1 published to npm**

---

## 1. Phase status

| Phase | Scope | Capabilities | Status |
|---|---|---|---|
| **0** | Nx + pnpm workspace, 3 packages, dual ESM/CJS, TS 6/7 split | — | ✅ done |
| **1** | Descriptors, `Pick`/`extend`, typed paths | CAP-1, CAP-2, CAP-10 | ✅ done |
| **2** | `MappingPlan` IR, planner, error taxonomy | CAP-4 | ✅ done |
| **3** | Codegen emitter | — | ✅ done |
| **4** | Projector + TypeORM adapter | CAP-5 | ✅ done |
| **5** | `Mapper` facade, NestJS module, seal lifecycle | CAP-3 | ✅ done |
| **6** | Write path, drop-list policy, `forRootAsync` | CAP-8 | ✅ done |
| **7** | `schemaOf` → OpenAPI | CAP-9 | ✅ done |
| **8** | Nested/collection + identity map | CAP-6, CAP-7 | ✅ done |
| **9** | Named mappers, `automapper check` CLI | CAP-3 | ✅ done |
| **10** | `defaultTo`, type converters | — | ✅ done |
| **11** | READMEs, LICENSE, CI | — | ✅ done |
| **12** | Schema tokens, lazy relations, release pipeline | — | ✅ done |

### Capability status

| | Capability | Landed |
|---|---|---|
| CAP-1 | DTO without restating the entity | Phase 1 · 4 |
| CAP-2 | Derived field declared once | Phase 1 |
| CAP-3 | Broken mappings fail at boot **and in CI** | Phase 5 · 9 |
| CAP-4 | Errors diagnosable from their text | Phase 2 |
| CAP-5 | Fetch only what the DTO uses | Phase 4 |
| CAP-6 | Nested pairs auto-registered | Phase 8 |
| CAP-7 | Cyclic and shared graphs | Phase 8 |
| CAP-8 | Write-side drop list | Phase 6 · 7 |
| CAP-9 | OpenAPI from the descriptor | Phase 7 |
| CAP-10 | Dependency typos are compile errors | Phase 1 |

All ten are implemented and tested.

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

Defects are detected here; Phase 5's `seal()` is what converts them into a
boot failure, and Phase 9's CLI does the same for CI.

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

### Phase 6 — Write path ✅

`reverse()` deriving a write DTO, dropping fields the write policy owns —
primary keys, generated columns, create/update/delete timestamps, version,
discriminator (AD-14). `isSelectByDefault === false` is explicitly *not* a
drop reason; that is the `password` case. Relation → foreign-key reversal
stays SHOULD-tier.

`Write(User, [...])` marks a write DTO; the planner rejects a
database-owned field at seal (AD-14) rather than dropping it silently.
`Mapper.mapInput` maps an untrusted body and **rejects unknown or
database-owned keys** — mass-assignment protection derived from the schema.
`MapBodyPipe` applies it globally, reading `metadata.metatype` so ordinary
`@Body() dto: CreateUserDto` works with no factory call and full DI.
`forRootAsync` lands here too.

`Mapper.reverseOf(dto)` reports the writable fields and why each of the rest
is refused. It returns names rather than a generated class, and that is a
limit rather than an omission: a DTO's static type has to exist at
declaration time, so a class built at seal could never be typed. Emitting a
typed write DTO needs the CLI codegen path.

### Phase 7 — OpenAPI ✅

`schemaOf(Dto)` from the descriptor. Promoted to MUST because `extend`
removes the syntactic declaration site `@ApiProperty` needs, so shipping
`extend` without it would ship a Swagger regression.

### Phase 8 — Graphs ✅

`nested()` and `collection()` lower to relation nodes; `seal()` closes over
the DTOs they reference so a nested pair never needs registering by hand
(CAP-6). Child plans are linked by value afterwards, and the `isAsync`
fixpoint runs in the same pass.

One identity map replaces AD-7's ancestor chain: the destination is inserted
before its fields are filled, so a back-edge finds the in-progress instance
and a shared reference maps once and is shared. Same guarantees, less
machinery.

### Phase 9 — Named mappers + CLI ✅

`getMapperToken(name)` and `InjectMapper(name)` for multi-context apps.
`automapper check <module>` boots the app context so CI validates the same
pair set the running app seals — completing CAP-3's second half.

**`isGetterOnly` refused.** Auto-mapping entity getters is unsafe under
projection: a getter's source columns cannot be inferred, so projecting one
fetches nothing and it computes from unfetched fields — the exact
under-fetch CAP-5 exists to prevent. Getters are supported through
`compute(['firstName','lastName'], u => u.fullName)`, where the deps are
declared.

---

> Full ecosystem coverage — all six `@automapper/*` packages, not just
> `core` — is in **`ECOSYSTEM.md`**, along with the gaps it surfaced.

## 2. Parity with `@automapper/*`

Lives in **[`ECOSYSTEM.md`](ECOSYSTEM.md) §2** — one table, not two. It was
duplicated here and drifted, which is the argument for keeping it in one place.

Summary: every in-scope surface of `core`, `classes`, and `nestjs` is covered,
replaced with something better, or refused with a reason.

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
| **Boot-time validation** (CAP-3) | An unresolved field fails `nest start`, and `automapper check` gives the same guarantee in CI. | ✅ Phase 5 · 9 |
| **Write-side drop list** (CAP-8) | Database-owned fields refused at boot and at the request boundary, from schema flags. Deleted from the incumbent because it had no schema to read. | ✅ Phase 6 |
| **OpenAPI generation** (CAP-9) | Schema from the descriptor — types, nullability, enums — with no `@ApiProperty`. | ✅ Phase 7 |
| **Cycle-safe graphs** (CAP-7) | Identity map, so shared references map once while true cycles terminate. | ✅ Phase 8 |
| **Mass-assignment protection** | A request body carrying a database-owned field is a 400, derived from the schema. | ✅ Phase 6 |
| **DTO-to-query compilation** | Skip entity hydration entirely. | ⬜ 3.0 — deliberately deferred |

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

### Phase 10 — Remaining core parity ✅

`defaultTo(inner, fallback)` covers `nullSubstitution` and
`undefinedSubstitution` in one helper and narrows the field to `NonNullable`.
Type converters answer `typeConverters`, keyed on the declared field type:
`{ date: v => v.toISOString() }` converts every date field with none of them
named — only expressible because each node carries its type.

Four items were refused rather than built; reasons in `ECOSYSTEM.md` §4.

### Phase 11 — Release surface ✅

READMEs for all three packages, checked against the built bundles rather than
written from memory. Root README replaced — it still documented the v1 API.
`LICENSE` filled in; it was a zero-byte file while every manifest declared
MIT. CI replaces the two v1 workflows and runs the development gate:
typecheck on both TypeScript lines, tests, dual build, dependency invariants.

---

### Phase 12 — The deferred work ✅

`defineSchema()` returns a token that stands in for a source with no runtime
class — Prisma models, Drizzle schemas, plain interfaces. It feeds the same
descriptor every back-end reads, so such a source gets projection, OpenAPI and
the write drop list, not just mapping. This unblocks the Prisma adapter.

Only the *source* side of the port widened. Destinations stay `ClassLike`
because they are constructed.

TypeORM lazy relations hold a `Promise`. The adapter reports `isLazy`, which
forces the plan async and makes the emitter await — otherwise the promise
object itself lands in the DTO.

Changesets with the three packages **fixed** to one version: they share an IR,
so a consumer must not be able to half-upgrade. The release workflow runs the
full gate before publishing and authenticates to npm through Trusted
Publishing (OIDC), so no npm token is stored anywhere.

---

## 5. Known gaps

All closed as of 2026-09-11:

| Was | Status |
|---|---|
| No live-`DataSource` test for `describe()` | ✅ 15 tests against a real TypeORM `DataSource` on sql.js (WASM — no native build) |
| No implicit primary key in projections | ✅ added in the adapter, not core: the neutral selection still reports only what the DTO consumes |
| No `automapper check` CLI | ✅ boots the app context so CI seals the same pair set |
| `forRootAsync` missing `useClass`/`useExisting` | ✅ both, via `AutomapperOptionsFactory` |
| Self-referencing DTO TS2506 | ⚠️ inherent to TypeScript — annotate the thunk `(): unknown => Dto`. Runtime unaffected. |
| Non-class sources (Prisma, Drizzle) | ✅ `defineSchema()` — Phase 12 |
| Proxy / lazy relation unwrapping | ✅ `isLazy` forces async and awaits — Phase 12 |
| Release workflow + changesets | ✅ publishes through Trusted Publishing |
| Stale v1 root README, empty LICENSE, v1 workflows | ✅ replaced in Phase 11 |
| npm org `@nestjs-automapper` | ✅ created; 2.0.1 published 2026-09-11 |

## 6. Release readiness

| | |
|---|---|
| Package manifests, `exports` maps, dual ESM/CJS | ✅ |
| Tests excluded from git and from the published tarball | ✅ — see `TESTING.md` |
| READMEs, LICENSE, `files` fields | ✅ |
| CI running the full gate | ✅ |
| npm org created | ✅ |
| Release workflow + changesets | ✅ Trusted Publishing, no npm token |
| Version | `2.0.1` across all three packages, on npm — see `CHANGELOG.md` |
| Docs | Root README, per-package READMEs, `CHANGELOG.md`, `docs/MIGRATION.md` |
| `custom-automapper` 1.x | superseded; npm deprecation pending |

## 7. After 2.0

| | Why it waits |
|---|---|
| Prisma adapter | 2.1 — `defineSchema()` and the widened port are in place, so this is now an adapter package rather than a port change |
| Mongoose, Drizzle adapters | 2.2+ |
| `mapper.query()` — DTO-to-query compiler | 3.0. Judged the strongest idea from design and deliberately deferred: it turns a mapper into a query builder. |
