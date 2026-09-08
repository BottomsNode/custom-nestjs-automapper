---
review: adversarial
target: ../ARCHITECTURE-SPINE.md
context:
  - ../../../../specs/spec-nestjs-automapper-2/SPEC.md
  - ../../../../specs/spec-nestjs-automapper-2/api-surface.md
date: '2026-09-08'
method: 'construct pairs of one-level-down units that obey every AD and still build incompatibly'
---

# Adversarial review — ARCHITECTURE-SPINE.md

## Verdict

The spine is structurally sound and the compiler framing is the right call — but it governs the **pipeline topology** and almost nothing about the **payload semantics** flowing through it. AD-1, AD-2 and AD-10 together guarantee that every back-end reads the same object; they do not guarantee that two back-ends reading the same object agree on what it *means*. That is where every hole below lives.

Worse, in two cases an AD **causes** the divergence rather than preventing it: AD-1 forbids the projector from consulting the descriptor, which is the only artifact that can disambiguate a dotted path or supply an implicit primary key; and AD-2 forbids a `default` arm but says nothing about descending into a node's children, so a back-end can pass the `never` check and still drop half the plan.

15 holes below. Holes 1–5 are release-blocking: each one produces a build that compiles, passes every stated AD, passes lint, and is wrong at runtime.

Notation: `A ⊗ B` means "unit A and unit B are individually compliant and mutually incompatible."

---

## HOLE-1 (blocking) — A dotted path is opaque, and AD-1 denies the projector the only thing that could disambiguate it

**Units**
- `core/plan/planner.ts` → `Planner.lowerCompute(node)`, which records `deps: string[]` on a `ComputeNode`
- `core/project/projector.ts` → `Projector.visit(node)`, which per AD-10 "unions their declared `deps`" into a `FieldSelection`

**The setup.** `FieldMeta.type` includes `'json'`. So this is legal user code against a TypeORM entity with a `jsonb` column `meta` and a to-one relation `address`:

```ts
export const ReadUserDto = extend(Pick(User, ['id']), {
  city:  compute(['address.city'], u => u.address.city),   // relation traversal
  theme: compute(['meta.prefs.theme'], u => u.meta.prefs.theme), // JSON column interior
});
```

Both dep strings are dotted. Both type-check against `Path<S>` (CAP-10 is satisfied — `Path<S>` descends into object-typed properties without caring whether the object is a relation or a JSON blob). Both are validated against the source descriptor at plan build, exactly as the Consistency Conventions require.

**How both units comply.** The planner emits `deps: ['address.city']` and `deps: ['meta.prefs.theme']` — opaque strings, per the convention "Source paths — dotted strings typed as `Path<S>`". The projector receives only `MappingPlan`. AD-1: *"Back-ends consume `MappingPlan` only and must not import an adapter or a descriptor type."* AD-10: *"It never inspects the destination class or adapter metadata."* So the projector's only available algorithm is: split on `.`, treat every non-terminal segment as a relation, terminal segment as a field. That yields:

```ts
{ fields: ['id'],
  relations: {
    address: { fields: ['city'], relations: {} },
    meta:    { fields: ['theme'], relations: { prefs: { fields: ['theme'], relations: {} } } } } }
```

**Incompatible outcome.** `typeorm/src/native-projection.ts` translates `relations.meta` into `relations: { meta: true }`. TypeORM throws `EntityPropertyNotFoundError: Property "meta" was not found in "User". Make sure your query is correct.` at the first request — or, on a version that tolerates it, silently emits a join against a table that does not exist. The correct behaviour was `select: { meta: true }` (fetch the whole JSON column, no join, no sub-selection — a JSON column cannot be partially selected in the general case). The projector is *structurally incapable* of knowing this, because the fact that distinguishes the two cases (`FieldMeta.type === 'json'` vs a `RelationMeta` entry) lives in the descriptor, and AD-1 forbids it.

Same class of failure, three more variants the spine leaves open:
- **Array index segments.** `compute(['tags[0].label'])` or `compute(['tags.0.label'])` — no syntax is pinned, so `path.ts` and `projector.ts` can legitimately choose different tokenizers.
- **Escaping.** A column literally named `a.b` (legal in Postgres, quoted) has no escape form. `Path<S>` will produce the string `a.b`, indistinguishable from a traversal.
- **Nullable intermediates.** `address.city` where `address` is nullable — codegen must emit a guard; the projector must not. Neither is told.

**Proposed AD (new) — AD-12, Paths are structured before they enter the IR.**

> No `MappingPlan` node carries a dotted string. The planner resolves every user-supplied path against the source `TypeDescriptor` at plan build and lowers it to `PathSegment[]`, where
> `type PathSegment = { kind: 'field'; name: string } | { kind: 'relation'; name: string; target: ClassLike } | { kind: 'index' } | { kind: 'json'; name: string; interior: readonly string[] }`.
> A `'json'` segment is terminal for projection purposes: the projector selects `name` and never descends into `interior`. Path resolution — including the decision of whether a segment is a relation, a JSON interior, or an array index — is the planner's exclusive responsibility and is performed exactly once. Back-ends never parse, split, or join a path string. The user-facing dotted string survives only inside `AutomapperError` render fields and `MappingExplanation`.

**Also tighten the Consistency Conventions row.** Replace *"Source paths — dotted strings typed as `Path<S>`"* with: *"Source paths — dotted strings at the **API surface** (`Path<S>`); `PathSegment[]` inside the IR (AD-12). `.` is the only separator, array elements use `.<n>`, and a source property whose name contains `.` is not addressable by path in 2.0 — the planner rejects it at plan build with `PATH_UNADDRESSABLE`."*

---

## HOLE-2 (blocking) — AD-2's closed node set and CAP-4's aggregate error report are mutually unsatisfiable as written

**Units**
- `core/plan/planner.ts` → `buildPlan(src, dest, config): MappingPlan`
- `core/plan/plan-validator.ts` → `validateAll(): PlanReport` (the CAP-3 boot sweep)

**The clash.** The api-surface fixes this required error text:

```
MappingPlanError: ReadUserDto has 1 unresolved field
  .displayName   no source 'displayName' on User (adapter: typeorm)
```

"has **1** unresolved field" is a count — it implies the validator aggregates *n* unresolved fields into one error. Aggregation requires that a plan with unresolved fields be **constructible**. But AD-2 closes the node union, and the spine says *"one `ResolutionNode` per destination field"*. So either:

- **Unit A** — the planner throws `FieldUnresolvedError` on the first field it cannot resolve. Fully AD-5 compliant, fully AD-8 compliant (fails at boot). But then `validateAll()` can only ever surface one field per pair, and the required aggregate text ("has 3 unresolved fields") is unbuildable. Also `PlanReport` becomes near-pointless — `validateAll()` is declared to *return* a report, not throw, and a throwing planner makes the return type a lie.
- **Unit B** — the planner adds `kind: 'unresolved'` to the union and returns a plan containing those nodes. Now `validateAll()` aggregates beautifully. But AD-2 forces **every** back-end to grow an exhaustive arm for `'unresolved'`, and each back-end can legitimately choose a different arm:
  - `codegen.emitter.ts` — throws at emit time (fine), **or** emits `throw new FieldUnresolvedError(...)` into the generated body (violates AD-8's "never at request time" — but AD-8 says "must be enforced at the leftmost *feasible* rung", and if `validate:false` this genuinely is the leftmost rung reached), **or** emits nothing and leaves the field `undefined` (the exact v1 defect).
  - `openapi.emitter.ts` — must emit *something*. `{}`? Omit the property? Throw? A thrown `schemaOf` breaks the Swagger document for a DTO that maps fine at runtime under `validate:false`.
  - `projector.ts` — an unresolved field has no deps, so it contributes nothing and projection succeeds, producing a query that under-fetches without complaint.

Both A and B satisfy AD-1, AD-2, AD-5, AD-8, AD-9, AD-10. They produce incompatible packages: under A, `validateAll()` returns `PlanReport` and never throws but is useless; under B, the same call site gets a report with *n* entries but every other back-end has independently decided what a partial plan means.

**Proposed AD (new) — AD-13, A plan is total or it is a report.**

> `buildPlan` never throws for a *mapping-content* defect. It returns `PlanResult = { ok: true; plan: MappingPlan } | { ok: false; diagnostics: AutomapperError[] }`. `MappingPlan` is by construction **total**: every destination field has a resolvable node, and there is no `'unresolved'` node kind. Back-ends therefore never encounter an unresolved field and need no arm for one. Only the plan validator and the boot sweep consume the `ok: false` branch, and only `AutomapperModule` (`validate: true`) and `automapper check` convert a non-empty diagnostic list into a thrown/exit-code failure. `buildPlan` still throws — immediately — for *structural* defects that make planning impossible at all: no adapter supports the source type, or the destination is not a runtime-real class.

**Proposed AD (tighten) — AD-8, add the throw/report rung split.**

> Append: *"AD-8 fixes where a rule is **enforced**; it also fixes **who converts a diagnostic into a failure**. `core` produces diagnostics and never decides process lifetime. Exactly one unit per host converts diagnostics to a failure: `AutomapperModule.onModuleInit` when `validate: true`, and the `automapper check` CLI. Any other unit that throws on a diagnostic is a violation."*

---

## HOLE-3 (blocking) — "the disjunction over plan nodes" does not say *which* nodes, and the wrong reading is the floating promise AD-9 exists to prevent

**Units**
- `core/plan/planner.ts` → the line that computes `plan.isAsync`
- `core/emit/codegen.emitter.ts` → `emitPair(plan)`, which per AD-9 emits *either* a sync *or* an async function

**The setup.**

```ts
export const AddressDto = extend(Pick(Address, ['id']), {
  geo: resolve(['lat', 'lng'], async (a) => geocode(a.lat, a.lng)),   // async
});
export const ReadUserDto = extend(Pick(User, ['id', 'email']), {
  address: nested(() => AddressDto),                                   // no async node of its own
});
```

**How both readings comply.** AD-9: *"`isAsync` is the disjunction over plan nodes, computed during plan build and immutable thereafter."*

- **Unit A (own-nodes disjunction).** `plan.isAsync = plan.nodes.some(n => n.kind === 'resolve')`. `ReadUserDto`'s own nodes are `auto`, `auto`, `nested` — none async. `isAsync = false`. Computed at plan build, immutable. **Compliant.**
- **Unit B (transitive disjunction).** `isAsync = own || childPlans.some(p => p.isAsync)`. Also computed at plan build, also immutable. **Compliant.**

**Incompatible outcome under A.** Codegen emits a *sync* mapper for `(User, ReadUserDto)`. It reaches the `nested` node and must call the child mapper, which AD-9 forced to be `async`. The generated sync function assigns a `Promise<AddressDto>` to `d["address"]`. `mapper.map(user, ReadUserDto).address` is a pending promise typed as `AddressDto`. That is a floating promise inside a value the type system asserts is resolved — precisely the failure AD-9's "Prevents" clause names, produced by an implementation that obeys AD-9 to the letter.

**Unit B is not free either — it introduces two problems the spine does not resolve.**
1. **Ordering.** Transitive `isAsync` requires the child plan at parent build time. CAP-6 auto-registers nested pairs; if that registration is lazy (see HOLE-7), the child plan does not exist when the parent's `isAsync` is computed and "immutable thereafter" makes it unfixable.
2. **Cycles.** `User → AddressDto → UserSummaryDto → AddressDto`. Transitive `isAsync` over a cyclic plan graph is a **fixpoint**, not a fold. A naive recursive disjunction infinite-loops. The correct answer is least-fixpoint over the strongly connected components — a real algorithm nobody has been assigned.
3. **The type level.** AD-9's last sentence — *"The sync entry point is type-rejected for an async-branded destination"* — requires the async brand to propagate through `nested(() => AddressDto)` into `ReadUserDto`'s inferred type. `nested()` takes a thunk (`() => Dto`) precisely to tolerate circular imports, and a thunk's return type is still inspectable, so brand propagation is *possible* — but for a genuinely circular DTO pair TypeScript will hit a circular type reference and infer `any`, silently dropping the brand. No unit owns this.

**Proposed AD (tighten) — AD-9.**

> Replace the first sentence with: *"`plan.isAsync` is the **least fixpoint** of the disjunction over (a) the plan's own nodes and (b) the plans of every `nested`/`collection` child, computed over the whole strongly-connected plan graph. It is therefore computable only after the transitive closure of nested pairs is registered (AD-14), and the planner computes it as a distinct pass over the closed set of plans, not during the lowering of any single pair. A cyclic plan group shares one `isAsync` value. `isAsync` is immutable once the closure pass completes; a plan registered after the closure pass triggers a re-run over its own new SCC only, and re-running must never flip an already-emitted pair from sync to async — if it would, that is a `PLAN_ASYNC_ESCALATION` error at registration."*
>
> Add: *"The static async brand propagates through `nested`/`collection` by construction. Where TypeScript cannot compute it — a circularly-referencing DTO pair — the planner emits `PLAN_ASYNC_UNBRANDED` at boot rather than relying on the type system, because AD-8's ladder permits the boot rung when the type rung is provably unreachable."*

---

## HOLE-4 (blocking) — Two owners of "is this field mappable": the adapter's `describe()` and the planner's policy

**Units**
- `typeorm/src/typeorm.adapter.ts` → `describe(type): TypeDescriptor`
- `core/plan/reverse.plan.ts` → the CAP-8 drop rules, and `core/plan/planner.ts` for the read direction

**The setup.** The architecture memlog records a decision the spine never encoded: *"ColumnMetadata also exposes `isSelect` (`select:false` columns such as password must never be projected or mapped by default), `isVersion` (another DB-owned field for the CAP-8 drop list), and `isDiscriminator`. Fold all three into the adapter **and** the reverse-map drop rules."* But `FieldMeta` in `api-surface.md` has no `isSelect`, `isVersion`, or `isDiscriminator` field. "Fold into the adapter and the drop rules" names two owners and assigns the decision to neither.

**How both units comply.**
- **Unit A (adapter filters).** *"Adapters produce `TypeDescriptor` only"* (AD-1) — nothing says a descriptor must be exhaustive. The adapter reads `describe()` as "describe what is mappable" and omits `select:false` columns and the discriminator from `descriptor.fields`. Zero AD violated.
- **Unit B (adapter reports, planner filters).** The adapter reads `describe()` as "normalise the source of truth" (the compiler-front-end framing in the spine's own table: *"normalise a source of truth into `TypeDescriptor`"*) and emits every column with provenance flags; the planner applies policy. Also zero ADs violated — and this is the reading the paradigm table actually implies.

**Incompatible outcome — and it cuts both ways, so neither unit is simply "the right one".**

| | Unit A (adapter filters) | Unit B (planner filters) |
|---|---|---|
| `password` (`select: false`) on a read DTO | not in descriptor → `Pick(User, ['password'])` is a compile error. Good. | in descriptor → `Pick(User, ['password'])` compiles, and the projector emits `select: { password: true }` by default. **Security regression.** |
| `password` on the **write** DTO (CAP-8 requires it: gap-analysis says password is *"required, then transformed before persistence"*) | **unreachable** — the reverse planner cannot emit a field the descriptor never contained. **CAP-8 broken.** | reachable. Good. |
| `version` column | absent from `schemaOf()` output → CAP-9's "matching what hand-written property decorators would have produced" fails | present, and the reverse planner drops it |
| `@TableInheritance` discriminator | absent → subclass DTOs lose the type column | present, must be dropped on write, kept on read |

There is no configuration of *one* unit that gets every row right. The descriptor must be exhaustive **and** the flags must reach the planner **and** the read-side default must differ from the write-side default.

**Proposed AD (new) — AD-14, Descriptors are exhaustive; policy is the planner's alone.**

> `describe()` returns every field and relation the schema declares, with no filtering, ordering, or policy applied. Filtering is exclusively the planner's, driven by provenance flags on `FieldMeta`. `FieldMeta` therefore carries the **complete** provenance set — `isPrimary`, `isGenerated`, `isCreateDate`, `isUpdateDate`, `isDeleteDate`, `isVersion`, `isDiscriminator`, `hasDefault`, `isSelectByDefault` — and every flag is **required, not optional**: an adapter that cannot determine one must set it explicitly to `false`, so that "unknown" can never be silently read as "no". The planner applies two published policy tables, one per direction:
> - **Read**: a field with `isSelectByDefault === false` is excluded from `auto()` and from implicit `Pick` expansion, and is reachable only by naming it explicitly; naming it explicitly is permitted.
> - **Write (CAP-8 drop list)**: `isPrimary || isGenerated || isCreateDate || isUpdateDate || isDeleteDate || isVersion || isDiscriminator` are dropped. `isSelectByDefault === false` is **not** a drop reason — it is the `password` case and must survive.
>
> A change to either table is a `core` change and updates the published policy table in the same commit. No adapter encodes a policy.

*(Note: `isSelectByDefault` rather than `isSelect` — the TypeORM name is a double negative in this context and will be misread. And making the flags required rather than `?:` is what stops a Prisma adapter in 2.1 from silently under-populating the drop list.)*

---

## HOLE-5 (blocking) — `FieldSelection` has no vocabulary for "all", "none", or "join without columns", and no owner for the implicit primary key

**Units**
- `core/project/projector.ts` → builds `FieldSelection { fields: string[]; relations: Record<string, FieldSelection> }`
- `typeorm/src/native-projection.ts` → `toNativeProjection(sel, type): { select, relations }`

**Clash 5a — `fields: []` is ambiguous, and the two readings are opposites.**

A nested DTO consisting only of computed fields with no scalar deps produces `{ fields: [], relations: {} }` for that relation. The projector emits it (correctly — nothing is needed but the join). The adapter must translate it. `select: {}` in TypeORM means **select all columns**. `select: undefined` means **select all columns**. There is no way to express "join this relation and select nothing", and nothing in the spine tells the adapter that `fields: []` means "none". Two compliant readings:
- Adapter reads `[]` as "no constraint" → emits `relations: { address: true }` with no `select` → **selects all 20 columns of `address`**, the exact failure CAP-5 exists to prevent, silently.
- Adapter reads `[]` as "none" → emits `select: { address: {} }` → TypeORM selects all anyway. Same outcome, different intent.

The union merge makes it worse. Two nodes touch the same relation:

```ts
address: nested(() => AddressDto),          // → address: { fields: ['id','city'] }
zip:     compute(['address.zip'], u => …),  // → address: { fields: ['zip'] }
```

Merge is "union" per AD-10. Union of `['id','city']` and `['zip']` is `['id','city','zip']` — correct here. But union of `[]` (meaning "all") and `['city']` is `['city']` under set union, and "all" under intent. AD-10 says "unions their declared `deps`" and stops there. Merge of the `relations` maps — deep or shallow — is likewise unstated; a shallow merge silently drops one branch of a two-level relation path.

**Clash 5b — the implicit primary key, and AD-1 again forbids the fix.**

TypeORM cannot hydrate an entity or attach a relation without the owning side's key columns. `find({ select: { email: true }, relations: { address: true } })` returns `User` objects with no `id` and unreliable relation attachment. So the primary key and the relation's join columns must be added to the selection. Who adds them?

- **Projector** — needs `FieldMeta.isPrimary` and `RelationMeta.joinColumns`. **AD-1 and AD-10 both forbid it** (*"never inspects the destination class or adapter metadata"*).
- **Adapter** — has the metadata and is allowed to use it. But then the adapter is *adding* to a selection `core` computed, and the `FieldSelection` returned by `projectionFor()` (a public API method, per api-surface) no longer matches what is actually fetched. CAP-5's success criterion — *"the issued SQL selects exactly those five plus any columns declared as dependencies of computed fields"* — is then measured against something `core` never produced, and any test asserting on `projectionFor()` output tests the wrong artifact.

Both units are compliant. The adapter-adds reading is the only one AD-1 permits, and it makes CAP-5's own acceptance test unwritable at the `core` level.

**Proposed AD (tighten) — AD-10, and a shape change to `FieldSelection`.**

> `FieldSelection` gains explicit vocabulary and loses the empty-array ambiguity:
> ```ts
> interface FieldSelection {
>   fields: readonly string[];                     // property names (AD-15); [] means EXACTLY NONE
>   relations: Readonly<Record<string, FieldSelection>>;  // presence = join required
>   all?: true;                                    // explicit escape hatch; absent means "fields is exhaustive"
> }
> ```
> Merge semantics are pinned as: `fields` = set union; `relations` = **deep, recursive** merge keyed by relation name; `all: true` on either side absorbs the other side's `fields` at that level and propagates to no other level. Merge is a published `core` function (`mergeSelection`), and both the projector and any adapter that composes selections call it — nobody re-implements it.
>
> **Selection is a two-stage artifact.** `core` produces the *semantic* selection: exactly what the DTO consumes, nothing more. `toNativeProjection()` produces the *physical* selection and is **required** to add whatever the ORM needs to make that semantic selection retrievable — primary keys, relation join columns, discriminators, inheritance keys. This augmentation is the adapter's exclusive responsibility and must be documented per adapter. CAP-5's acceptance test asserts against the **issued SQL**, not against `projectionFor()`; `projectionFor()` is asserted separately as the semantic selection.

---

## HOLE-6 — `FieldSelection.fields` — property names or native column names?

**Units:** `core/project/projector.ts` ⊗ `typeorm/src/native-projection.ts`

**How both comply.** `FieldMeta` carries both `name` (`createdAt`) and `nativeName` (`created_at`). AD-10 says *"`core` emits a neutral `FieldSelection`"*. "Neutral" is ambiguous between "ORM-agnostic" and "database-level". Two readings, both defensible:
- Property names — the descriptor's `name` is the DTO-facing identity, and the projector never touched `nativeName`.
- Native names — CAP-5's success criterion is written at the SQL level (*"the issued SQL selects exactly those five"*), and api-surface's reference hello-world says explicitly: *"The issued query selects `id`, `email`, `created_at`, `first_name`, `last_name`"*. That sentence actively invites the native-name reading.

**Incompatible outcome.** TypeORM's `FindOptionsSelect` is keyed on **property names**. An adapter fed `created_at` produces `select: { created_at: true }`, which TypeORM either rejects (`EntityPropertyNotFoundError`) or ignores, degrading to select-all. And once `nativeName` is in the IR, a future adapter (Prisma, 2.1) whose native shape is also property-keyed has to reverse the mapping, which is only possible if `nativeName → name` is injective — it is not, once two entities share a table or a column is aliased.

**Second owner problem in the same pair — naming-convention conversion.** Who decides that DTO field `createdAt` corresponds to entity property `createdAt` corresponds to column `created_at`? The incumbent had `namingConventions` as a mapper-level concern. Here the api-surface error text implies the *planner* sees snake_case candidates:

```
.displayName   no source 'displayName' on User (adapter: typeorm)
               did you mean 'display_name'?
```

That did-you-mean is only producible if the candidate set contains `display_name` — i.e. the planner is matching against a set that mixes property and native names. If the adapter *also* normalises (setting `name` to a camelised `databaseName` rather than to `propertyName`), the two conversions compose and `api_key` → `apiKey` → `apiKey` works, while `APIKey` → `apiKey` → `aPIKey` does not, non-deterministically depending on which unit ran.

**Proposed AD (new) — AD-15, One name space in the IR.**

> Every string identifying a source or destination member anywhere in `MappingPlan`, `FieldSelection`, `PathSegment`, or `MappingExplanation` is a **property name** as declared on the class — never a native/database name. `FieldMeta.nativeName` exists solely so that (a) adapters can translate a property-keyed selection into a native shape, and (b) `core/diagnose` can offer it as a did-you-mean candidate in error text. `nativeName` never enters a plan node or a `FieldSelection`.
>
> **Naming-convention conversion has exactly one owner: the adapter.** `FieldMeta.name` is always the class property name verbatim (TypeORM `propertyName`, never a transform of `databaseName`). The planner performs no convention conversion of any kind; `auto()` matches on exact property-name equality. Fuzzy matching exists only in `core/diagnose` for did-you-mean candidates, where its candidate pool is `name ∪ nativeName`, and it never affects resolution.

---

## HOLE-7 — Three plausible plan-build moments, and the boot sweep and the CI check enumerate different pair sets

**Units:** `nestjs/src/automapper.module.ts` → `onModuleInit()` ⊗ `core/plan/plan-cache.ts` → `getOrBuild(srcCtor, destCtor)`; and secondarily `bin/automapper-check.ts` ⊗ `AutomapperModule`.

**Clash 7a — when is a plan built?** AD-8's ladder is *"type system → registration/boot → first call"*. `createMap()` is registration. AD-7 says the compiled-function cache is *"immutable after registration"*. Three compliant readings:
1. **Eager at `createMap`.** But `Mapper` is chainable — `mapper.use(adapter).createMap(...)` and `mapper.createMap(...).use(adapter)` are both legal per the api-surface signatures, and under eager building the second ordering throws "no adapter supports `User`" for a program that is perfectly correct.
2. **At the boot sweep** (`validateAll()` / `onModuleInit`). Then `validate: false` — whose default the spine never states — means no plan is ever built until first call, and CAP-3 silently does not ship.
3. **Lazily at first `map`.** Compliant with AD-8 ("first call" is a listed rung) and with AD-7 (cache is immutable *after* it is populated). But this is the rung CAP-3 exists to eliminate.

**Clash 7b — CAP-6 auto-registration mutates the registry at request time.** `nested(() => AddressDto)` requires the `(Address, AddressDto)` pair. Two compliant implementations: the planner computes the transitive closure of nested pairs at parent build time (visited-set-terminated for cycles), or codegen resolves `getOrCompile(child)` lazily on first call. The lazy one mutates the registry during a `map` operation — arguably breaching AD-7's *"immutable after registration"* — and turns CAP-6's *"If the nested pair cannot be derived, startup fails naming that pair"* into a first-request 500.

**Clash 7c — the CI check and the boot sweep discover different pairs.** api-surface commits to `npx automapper check` as the CI equivalent. `AutomapperModule.forRoot` pairs and `forFeature([UserProfile])` pairs are registered by *different Nest modules at different times*; a lazily-loaded feature module's pairs are not registered until that module initialises. A CLI that boots a bare `Mapper` from a config file sees only the `forRoot` set. Green CI, red boot — and CAP-3's own success criterion is *"The same condition is detectable in CI without starting the application."*

**Clash 7d — the ordering AD-7 makes hard.** SHOULD-tier item 11 (implicit registration — "the DTO is the registration") requires *some* enumerable list of every `Pick`-produced DTO. `Pick()` runs at module import. The only place to record it is module-level state, which AD-7 bans outright (*"No module-level mutable state anywhere"*). The ban is right, but nothing was put in its place, and item 11 is currently unimplementable.

**Clash 7e — `Pick(User, [...])` runs before `dataSource.initialize()`.** `export const ReadUserDto = extend(Pick(User, [...]))` executes at import time. TypeORM entity metadata exists only after `DataSource.initialize()`, which happens inside `TypeOrmModule`'s own `onModuleInit`. Whether Nest initialises `TypeOrmModule` before `AutomapperModule` depends on the import graph and is not pinned anywhere. If `Pick` snapshots a descriptor eagerly it snapshots nothing; if it defers, `schemaOf()` and CAP-9 must also defer.

**Proposed AD (new) — AD-16, One plan lifecycle.**

> Plan build has exactly three phases, in this order, and no unit may build a plan outside them:
> 1. **Declare** — `createMap`, `Pick`, `extend`, and `reverse` record configuration only. They resolve no descriptor, build no plan, and throw only for arity/shape errors detectable without schema. `Pick(Entity, keys)` stores `(entityCtor, keys)` and resolves its descriptor lazily; it is never a snapshot.
> 2. **Seal** — one call, `mapper.seal()`, invoked by `AutomapperModule.onModuleInit` and by `automapper check`. It resolves descriptors, computes the **transitive closure** of nested pairs (CAP-6 auto-registration happens here and nowhere else), runs the `isAsync` fixpoint (AD-9), builds every plan, and returns `PlanReport`. After `seal()` the registry is frozen — `use()` and `createMap()` throw `REGISTRY_SEALED`.
> 3. **Serve** — `map`/`mapArray`/`projectionFor` read only sealed artifacts. Compilation of a plan into a function may be lazy for latency, but a lazily compiled function may not consult the registry for anything not already in the sealed closure.
>
> `validate` defaults to `true`. `validate: false` skips only the *failure* conversion, never the seal — an unsealed mapper throws `REGISTRY_UNSEALED` on first `map`, so lazy first-call plan-building is not reachable at all and CAP-3 cannot be silently opted out of.
>
> `automapper check` and `AutomapperModule` must enumerate the **same** pair set. The CLI achieves this by booting the application's Nest context with a null transport, not by constructing a bare `Mapper` — and `forFeature` modules are eagerly instantiated during a check run. Any pair reachable only through a lazily-loaded module is reported as `PAIR_UNSWEPT` rather than silently skipped.

---

## HOLE-8 — AD-2's exhaustiveness check does not force recursion, so a back-end can pass `never` and still drop half the plan

**Units:** `core/emit/codegen.emitter.ts` ⊗ `core/schema/openapi.emitter.ts`

**The setup.** `visible(pred, inner?)` is composable: `email: visible(c => c.role === 'admin', from('emailAddress'))`. Its IR representation is a design fork the spine does not close:
- **Wrapper node.** `{ kind: 'gated', pred, child: ResolutionNode }` — codegen wants this (emit `if (gate(ctx)) { … }` around the child's emission).
- **Flag on the inner node.** `{ kind: 'from', path, gate?: Predicate }` — the OpenAPI emitter wants this (it only needs to mark the field optional and then type it from the inner node).

**How both comply.** AD-2 requires *"a `never` exhaustiveness check and no `default` arm"* on the `kind` discriminator. Under the wrapper reading, the OpenAPI emitter is forced to have a `case 'gated':` arm — and `case 'gated': return {};` **satisfies AD-2 completely**. The exhaustiveness check verifies that every `kind` is *mentioned*; it cannot verify that the arm *descends into `node.child`*. So:

```ts
case 'gated': return { };   // AD-2 compliant. never-check passes. Type-correct.
```

**Incompatible outcome.** Codegen emits a correct gated assignment producing `string | undefined`. The OpenAPI emitter emits `{ email: {} }` — an untyped, non-nullable, non-optional property. A generated TypeScript client from that schema declares `email: unknown` and required; the runtime omits it for non-admins. Contract drift between two back-ends reading the same node, with every AD satisfied and every test that asserts "the switch is exhaustive" passing green. The same trap applies to `nested`, `collection`, and any future composable resolver.

**Proposed AD (tighten) — AD-2.**

> Append: *"`ResolutionNode` is closed **and its recursion is explicit**. Any node kind carrying a child node exposes it through a single well-known accessor (`children(node): readonly ResolutionNode[]`, defined once in `core/plan/`). Every back-end that produces per-field output must reach a leaf for every destination field: back-ends are written as a fold over `children()` rather than a flat switch, and each back-end ships a test asserting that its output covers `plan.nodes.length` destination fields with no `{}`/`undefined`/no-op result. Exhaustiveness over `kind` is necessary and not sufficient; the leaf-coverage test is the other half of AD-2."*
>
> Also pin the representation: *"A gate is a **wrapper node** (`kind: 'gated'`, with `child`), never a flag on another node — so that `visible(pred, visible(pred2, from(p)))` has one representation and the plan-node count still equals the destination-field count at the top level."*

---

## HOLE-9 — What `deps` means on a `nested` vs a `collection` node

**Units:** `core/plan/planner.ts` ⊗ `core/project/projector.ts`

**How both comply.** AD-10 says only *"unions their declared `deps`"*. For `address: nested(() => AddressDto)` there are two legitimate `deps` populations:
- **Root-only** — `deps: ['address']`. The projector must then *recurse into the child plan* to learn what `address` needs.
- **Flattened transitive** — `deps: ['address.id', 'address.city']`. The projector unions and un-flattens.

Both satisfy AD-10. Under root-only, a projector that does not recurse emits `relations: { address: {} }` → select-all on the relation (HOLE-5a). Under flattened, the deps set is computed at parent plan build and goes **stale** if the child DTO changes — which cannot happen after seal, but does happen across the `reverse()` path where a second plan is derived from the first. Worse, the flattened form is *infinite* for a cyclic DTO graph, which CAP-7 explicitly supports.

**And the recursion itself needs a cycle guard the spine never grants it.** The ancestor-chain cycle rule lives in Constraints and is described as runtime behaviour; AD-7 scopes the ancestor chain to *"a context created per top-level `map` call"*. `projectionFor()` is not a `map` call. A self-referencing DTO (`EmployeeDto` with `manager: nested(() => EmployeeDto)`) therefore maps fine and **stack-overflows in the projector**, with every AD satisfied — AD-7 in particular, because the projector correctly declined to create module-level state and was never told to create any other kind.

**Proposed AD (tighten) — AD-10.**

> Append: *"A `nested`/`collection` node declares `deps` covering **only** the relation root plus any source values the node itself reads (e.g. a discriminator). The child's contribution is obtained by the projector **recursing into the child plan**, reachable from the node as `node.childPlan` — plans are linked by value in the sealed closure (AD-16), not looked up in the registry, so the projector never touches the registry and AD-1 is preserved. Deps are never flattened across a relation boundary."*
>
> *"Projection is subject to the same cycle rule as mapping. The projector threads an ancestor chain and a depth ceiling, in a projection context created per `projectionFor` call and discarded on return (AD-7). A back-edge terminates the recursion: the relation appears in `FieldSelection.relations` with the child's non-recursive fields only. Projection depth and mapping depth use the same ceiling constant, exported once from `core`."*

---

## HOLE-10 — AD-5 fixes the error shape but the shape cannot carry what CAP-4 requires, and `candidates` is two different types

**Units:** `core/diagnose/error.render.ts` ⊗ `nestjs/src/profile.registrar.ts`; and `core/diagnose/mapping-not-found.error.ts` ⊗ `core/diagnose/field-unresolved.error.ts`

**Clash 10a — the required error text contains a field AD-5 does not list.** CAP-4's committed output includes:

```
Nearest profile: src/mapping/user.profile.ts:14
```

AD-5 enumerates the structured fields as `sourceType`, `destType`, `field`, `candidates`, `adapter`. No `location`. The list reads as closed (*"carrying a machine-readable `code` and structured fields (…)"*), and AD-5 forbids the alternative outright: *"Message rendering is a `core` function, never per-package string assembly."* So the `nestjs` package that alone knows where the profile class was declared has two compliant-looking options and both are wrong: append the line itself (banned by AD-5) or add a field to the taxonomy (an undeclared extension of a closed-looking set). Meanwhile `core` cannot capture the location itself without a stack capture at `createMap` time, which nothing assigns to it.

**Clash 10b — `candidates` carries two incompatible types.** AD-4 says `.name` appears **only in rendered error text**, so a candidate *type* must be carried as a constructor. But `candidates` is also the did-you-mean pool for **field names**, which are genuinely strings:

| Error | What `candidates` holds |
|---|---|
| `MappingNotFoundError` — "Maps registered from User: AdminUserDto, UserSummaryDto" | `ClassLike[]` (AD-4 forces this) |
| `FieldUnresolvedError` — "did you mean 'display_name'?" | `string[]` |

Two error classes, one declared field name, two types. Both AD-5 compliant. Any machine consumer of `error.candidates` — the exact audience AD-5's "machine-readable" clause exists for — must type-test at runtime, and a `PlanReport` serialiser will emit `[{},{}]` for the constructor case.

**Proposed AD (tighten) — AD-5.**

> Replace the field clause with: *"`AutomapperError` carries `code` plus a structured payload whose per-`code` shape is declared in one place (`core/diagnose/error-codes.ts`) as a discriminated union on `code`. The payload set is **open by code, closed per code** — adding a code adds a payload shape; no package invents a field for an existing code. The common fields are `sourceType?: ClassLike`, `destType?: ClassLike`, `field?: string`, `adapter?: string`, and `origin?: { file: string; line: number }`. Candidate lists are **never** a single polymorphic field: `typeCandidates?: readonly ClassLike[]` and `nameCandidates?: readonly string[]` are separate, and rendering resolves `.name` from the former (AD-4)."*
>
> *"`origin` is captured by `core` at declaration time — `createMap`, `Pick`, and `extend` each capture one stack frame above the library boundary and store it on the registration record. No host package assembles or appends message text; a host that wants richer provenance contributes structured data through the registration record, and `core` renders it."*

---

## HOLE-11 — Two adapters both `supports()` a type, and there are three compliant tie-breaks

**Units:** `core/descriptor/adapter-registry.ts` → `resolve(type)` ⊗ `nestjs/src/automapper.module.ts` → `forRoot({ adapters })` / `forFeature`

**The setup.** SHOULD-tier item 13 puts a `class-validator` adapter in scope. A TypeORM entity decorated with both `@Entity()` and `@IsOptional()` is `supports()`-ed by both. `SchemaAdapter.supports()` returns `boolean` with no priority, no exclusivity claim, and no arbitration rule anywhere in the spine.

**How each complies.** `Mapper.use(adapter): this` is chainable and therefore ordered; `forRoot({ adapters: [a, b] })` is an ordered array; `forFeature` can add more later. Three compliant registries: first-match-wins (array order), last-registered-wins (keyed by `adapter.name`, later `use()` overwrites), merge-all (union the descriptors).

**Incompatible outcomes.**
- `nullable` for `email` comes from `column.isNullable` (typeorm) or from the absence of `@IsOptional()` (class-validator). Under first-wins vs last-wins these differ, and `nullable` feeds CAP-9's OpenAPI output and CAP-8's drop logic.
- `producedBy` differs, and CAP-4 asserts on it (*"(adapter: typeorm)"*), so an error-text test passes or fails on registration order.
- Under merge-all, no rule says which side wins per *field*, and the merge itself is a fourth unowned algorithm.

**Second failure in the same pair — multi-DataSource.** `typeorm(dsA)` and `typeorm(dsB)` both have `name: 'typeorm'`. A registry that dedupes on `adapter.name` silently drops one — a name-keyed collision, structurally the same bug AD-4 exists to prevent, one level up from where AD-4 is scoped. And `supports()` on `dsA` for an entity owned by `dsB` requires `dataSource.hasMetadata(type)`, not a try/catch around `getMetadata` — an adapter written with try/catch is compliant with AD-5 (it wraps and rethrows) and turns a routine miss into a thrown error.

**Third failure — zero adapters support the type.** Nothing says what happens. A plain DTO-to-DTO map (`reverse()`'s write DTO, or `nested()` between two DTOs) has no ORM behind it. Is there a built-in descriptor source for `Pick`/`extend`-produced classes, and is it an adapter (in which case AD-6's "no adapter imports another adapter" and AD-1's "`core` never knows an ORM exists" need it stated) or a planner special case?

**Proposed AD (new) — AD-17, Adapter arbitration is explicit and total.**

> The adapter set is an **ordered list**; the first adapter whose `supports(type)` returns `true` describes it, and no descriptor is ever merged from two adapters. Adapters are identified by **instance identity**, never by `adapter.name`; `name` is display-only and duplicates are legal (multi-DataSource). `supports()` is a **pure, non-throwing predicate** — it must not perform I/O and must not throw; an adapter that cannot answer returns `false`. Registration order is the app's explicit responsibility: `forRoot({ adapters })` array order is the total order, `forFeature` may not append adapters (only pairs), and `use()` after `seal()` throws (AD-16).
>
> `core` ships a built-in terminal adapter, `dtoAdapter`, which supports any class produced by `Pick`/`extend` and describes it from the runtime field registry. It is always last in the order, is not an ORM adapter, and is exempt from AD-6's adapter-to-adapter rule since it imports nothing. If no adapter — including `dtoAdapter` — supports a type, the planner throws `NO_ADAPTER` at seal, naming the type and every registered adapter's `name` and index.

---

## HOLE-12 — Is an `ignore()`d field in the plan?

**Units:** `core/plan/planner.ts` ⊗ `core/schema/openapi.emitter.ts` (and `core/diagnose/explainer.ts`)

**How both comply.** The spine says *"one `ResolutionNode` per destination field"*, but an `ignore()`d field is arguably not a destination field at all. So: emit `{ kind: 'ignore' }`, or omit the entry entirely. AD-2 is satisfied either way (a closed union does not mandate that a node exists for every declared field).

**Incompatible outcome.** If omitted: the OpenAPI emitter, which iterates `plan.nodes`, drops the property from the schema — while `Pick`'s constructor assigned the key, so the runtime object *has* the property with value `undefined` and `JSON.stringify` omits it. Schema and payload agree by accident. But the explainer now cannot distinguish "ignored on purpose" from "never declared", and the plan validator cannot either — so a typo'd `ignroe` key that silently drops a field reads identically to a deliberate ignore, which is precisely the CAP-4 failure mode. If emitted: the OpenAPI emitter must decide whether to emit the property (as what type?) and the projector must be told the node contributes zero deps.

Adjacent: `constant(value)` — `deps: []` is clear, but the OpenAPI emitter must type it. `typeof value` at emit time is a back-end inferring a type from a runtime value; the declared TS type is the truth and the emitter cannot see it.

**Proposed AD (tighten) — AD-2 / the Consistency Conventions.**

> *"`MappingPlan.nodes` contains exactly one node per **declared destination field**, including `ignore()`d ones (`kind: 'ignore'`). `plan.nodes.length === Object.keys(destFieldRegistry).length` is an invariant checked at seal. Back-end obligations for `'ignore'` are fixed, not chosen: codegen emits no assignment; the projector contributes no deps; the OpenAPI emitter **omits** the property; the explainer renders it as explicitly ignored, with its `origin`. A destination field with no declared resolution is a diagnostic (AD-13), never an implicit ignore."*
>
> *"A `constant` node carries a declared `schema` alongside its value; the OpenAPI emitter never infers a type by inspecting a runtime value."*

---

## HOLE-13 — Null vs absent vs omitted, and the cycle policy contradicts the spike's own finding

**Units:** `core/runtime/cycle.ts` ⊗ `core/dto/pick.ts`; and `core/emit/codegen.emitter.ts` ⊗ `core/schema/openapi.emitter.ts`

**The direct contradiction.** api-surface records as a *load-bearing spike finding*: *"The helper's constructor must assign each key (even as `undefined`) so instances carry real own-properties. Omitting this reproduces the v1 defect."* The SPEC's cycle constraint says: *"on an optional field the default is to **omit** it, with a reference-marker mode available per map."* These cannot both hold. `Pick`'s constructor has already assigned the key; "omit" therefore means one of three incompatible things, all AD-compliant:
- never assign (impossible — the constructor already did)
- `delete d[k]` (defeats the own-property invariant the spike exists to protect, and de-optimises the object shape)
- assign `undefined` (present-as-undefined; `'manager' in dto` is `true`, `JSON.stringify` omits it)

A `core/runtime` author picks one, a `core/dto` author assumes another, and `'field' in dto` — the exact check the v1 defect turned on — silently changes meaning.

**The three-way ambiguity across back-ends.** Three distinct conditions all reach the wire as a missing key:

| Condition | Codegen writes | OpenAPI should say |
|---|---|---|
| nullable column, DB value `NULL` | `null` | `nullable: true`, required |
| `visible()` gate false | `undefined` | `required: false` |
| cycle back-edge omitted | `undefined` or deleted | `required: false`? `nullable`? |
| to-one relation not loaded (projection excluded it) | `undefined` | — should be unreachable, but isn't under HOLE-5b |

Nothing pins the mapping. Codegen and the OpenAPI emitter can each pick a consistent story and the two stories differ, producing generated-client drift that only shows up in a consumer's codebase.

**Proposed AD (new) — AD-18, One null model.**

> Every destination key declared by `Pick`/`extend` is an own-property of every mapped instance, always, without exception — "omit" never means `delete` and never means "unassigned". The three absence conditions have distinct, pinned encodings:
> - **DB null** → `null`. OpenAPI: `nullable: true`, property required.
> - **Gate false** (`visible()`) → `undefined`. OpenAPI: property not in `required`.
> - **Cycle back-edge, omit mode** → `undefined`. OpenAPI: property not in `required`. In reference-marker mode → the marker object, and OpenAPI emits the marker schema as a `oneOf` branch.
>
> `undefined` never crosses the wire (JSON omits it) and `null` always does; that difference is the entire contract, and any back-end reading a node must produce output consistent with the table above. The table lives in `core` and is the single source both codegen and the OpenAPI emitter compile against.

---

## HOLE-14 — Who decides context is missing, and who throws

**Units:** `core/project/projector.ts` ⊗ `nestjs/src/projection.decorator.ts` (`@Projection`, backed by `AsyncLocalStorage`)

**How both comply.** The SPEC constraint: *"Projection throws when the plan contains context-gated fields and no context is supplied."* `projectionFor(s, d, { ctx })` takes an optional ctx. In `nestjs`, ctx comes from ALS via `contextFactory`. Outside an HTTP request — a `@Cron` handler, a BullMQ consumer, a Nest lifecycle hook, a `forFeature` provider constructed at boot — the ALS store is `undefined`. Two compliant behaviours in `projection.decorator.ts`:
- Pass `ctx: undefined` through → `core` throws, at **request time**, for a plan that is perfectly valid. AD-8 violated in effect, though not in letter (the leftmost *feasible* rung was arguably reached).
- Substitute a default ctx (e.g. `{ role: 'anonymous' }`) → projection silently under-fetches for a job that legitimately needs admin columns; the map then produces `undefined` for fields the caller expected. The silent-under-fetch failure CAP-5 exists to prevent.

**Also unowned:** does `map()` (not `projectionFor`) throw when ctx is missing but the plan is gated? The constraint names projection only. Codegen can legitimately evaluate `pred(undefined)` and let the user predicate throw a `TypeError` — an error that is not an `AutomapperError` and therefore breaches AD-5 by omission, since nothing said user predicates run inside a wrapping boundary.

**Proposed AD (tighten) — AD-8 / AD-5.**

> *"Context requirement is a plan property computed at seal: `plan.requiresContext = plan.nodes.some(isGated)`. A mapper whose sealed set contains any context-requiring plan and whose `MapperOptions` declares no `contextFactory` fails at **seal**, not at request time (`CONTEXT_UNCONFIGURED`). At request time a missing context is never silently defaulted: `core` throws `CONTEXT_REQUIRED` naming the plan and the gated fields, and the `nestjs` package never substitutes a fallback context — the host must supply one explicitly, including in non-HTTP execution contexts."*
>
> *"Every user-supplied function invoked by generated code — gate predicates, `compute`/`resolve` bodies, `constant` thunks — runs inside a `core` boundary that wraps any thrown value in `ResolverThrewError` carrying the field, the pair, and the original as `cause`. AD-5's 'adapters never throw a raw Error' extends to: no raw error ever escapes `core`."*

---

## HOLE-15 — `reverse()` takes the write DTO as a parameter, so "excluded automatically" has no owner

**Units:** `core/plan/reverse.plan.ts` ⊗ `core/plan/plan-validator.ts`

**The setup.** The signature is `reverse<S, D, W>(s: ClassLike<S>, d: ClassLike<D>, write: ClassLike<W>): this` — the user *declares* `W`. But CAP-8 says reversing *"produces a write DTO in which primary keys, generated columns, and create/update/delete timestamps are absent"*. If the user writes `const WriteUserDto = Pick(User, ['id', 'email'])` — including `id` — three compliant behaviours:
- The reverse planner drops `id` per the CAP-8 drop list, and `W`'s static type still declares `id: string` while the runtime never populates it. Type lies.
- The reverse planner maps `id` (it is resolvable — `D` has `id`, `W` wants `id`, nothing is unresolved, so the **plan validator raises nothing**), and CAP-8's own success criterion is violated by a build that passes every check.
- The reverse planner errors — but the "drop list" framing says *excluded automatically*, not *rejected*, so erroring is arguably non-compliant with CAP-8's wording.

The plan validator and the reverse planner are looking at the same field with opposite defaults: the validator's job is "every destination field must resolve" and `id` resolves fine; the reverse planner's job is "DB-owned fields must not appear" and `id` is DB-owned. Neither is wrong. Both ship.

**Proposed AD (tighten) — AD-14 (or a new clause on the reverse path).**

> *"On the reverse path the drop list is a **rejection**, not a silent exclusion. If `W` declares a field the write drop list covers (AD-14's write table), `reverse()` fails at seal with `WRITE_FIELD_DB_OWNED`, naming the field and the provenance flag that made it DB-owned. The plan validator's totality rule is suspended for `W`'s dropped fields only — a field dropped by the write policy is not an unresolved field. Where `W` is derived rather than declared (`reverse(s, d)` with a generated `W`), the drop list is applied at derivation and the resulting static type omits the dropped keys, so the runtime and the type agree."*

---

## Summary table

| # | Sev | Units | Clash | Closes with |
|---|---|---|---|---|
| 1 | blocking | `planner.ts` ⊗ `projector.ts` | dotted dep string: relation traversal vs JSON-column interior; AD-1 denies the projector the descriptor that disambiguates | **new AD-12** paths structured to `PathSegment[]` before entering the IR |
| 2 | blocking | `planner.ts` ⊗ `plan-validator.ts` | throw-on-first vs `'unresolved'` node kind; AD-2 vs CAP-4's aggregate report | **new AD-13** plan is total or it is a report; tighten AD-8 |
| 3 | blocking | `planner.ts` ⊗ `codegen.emitter.ts` | `isAsync` own-nodes vs transitive; sync parent + async child = floating promise | **tighten AD-9** least fixpoint over the SCC plan graph |
| 4 | blocking | `typeorm.adapter.ts` ⊗ `reverse.plan.ts` | who filters `isSelect`/`isVersion`/`isDiscriminator`; password unreachable vs password leaked | **new AD-14** descriptors exhaustive, policy is the planner's, flags required |
| 5 | blocking | `projector.ts` ⊗ `native-projection.ts` | `fields: []` = none or all; deep vs shallow relation merge; who adds the implicit PK | **tighten AD-10** + `FieldSelection` shape; two-stage semantic/physical selection |
| 6 | high | `projector.ts` ⊗ `native-projection.ts` | property names vs native column names; who owns naming-convention conversion | **new AD-15** one name space in the IR; conversion is the adapter's alone |
| 7 | high | `automapper.module.ts` ⊗ `plan-cache.ts` ⊗ `automapper-check` | three plan-build moments; CI and boot enumerate different pair sets; `Pick` runs before `dataSource.initialize()` | **new AD-16** declare / seal / serve |
| 8 | high | `codegen.emitter.ts` ⊗ `openapi.emitter.ts` | `case 'gated': return {}` passes the `never` check and drops the field's type | **tighten AD-2** explicit `children()` + leaf-coverage test |
| 9 | high | `planner.ts` ⊗ `projector.ts` | `deps` root-only vs flattened on `nested`/`collection`; projector has no cycle guard | **tighten AD-10** root-only deps, child by value, projection ancestor chain |
| 10 | high | `error.render.ts` ⊗ `profile.registrar.ts` | AD-5's field list can't carry CAP-4's file:line; `candidates` is `ClassLike[]` and `string[]` | **tighten AD-5** payload union by code; split `typeCandidates`/`nameCandidates`; `origin` |
| 11 | med | `adapter-registry.ts` ⊗ `automapper.module.ts` | two adapters `supports()`; name-keyed dedupe breaks multi-DataSource; zero-adapter case unowned | **new AD-17** ordered list, identity not name, `supports()` pure, built-in `dtoAdapter` |
| 12 | med | `planner.ts` ⊗ `openapi.emitter.ts` | is an `ignore()`d field a node; deliberate ignore indistinguishable from a typo | **tighten AD-2** one node per declared field incl. `'ignore'`, fixed per-back-end obligations |
| 13 | med | `cycle.ts` ⊗ `pick.ts` | SPEC "omit" contradicts the spike's assign-every-key finding; null/undefined/deleted all reach the wire the same | **new AD-18** one null model table |
| 14 | med | `projector.ts` ⊗ `projection.decorator.ts` | missing ALS context outside HTTP: throw at request time vs silently default | **tighten AD-8** `requiresContext` checked at seal; no fallback ctx; wrap user fns |
| 15 | med | `reverse.plan.ts` ⊗ `plan-validator.ts` | user-declared `W` containing `id`: drop, map, or reject — validator sees no defect either way | **tighten AD-14** write drop list is a rejection, not a silent exclusion |

## What this adds up to

The spine has 11 ADs and needs roughly 18. The seven missing ones cluster into three themes, and each theme is a place where the compiler metaphor was adopted structurally but not semantically:

1. **The IR is under-specified as a data structure** (HOLE-1, 5, 6, 9, 12, 13). A real compiler IR pins the representation of every operand — segment kinds, name spaces, the empty-set encoding, the null model. This one pins the node *kinds* and leaves the *payloads* to whoever writes the first back-end. AD-12, AD-15, AD-18 and the AD-10 tightenings close this.
2. **Lifecycle has no phase boundary** (HOLE-2, 3, 7, 11, 14). "Registration" appears in AD-7, AD-8 and AD-16's absence as if it were a moment; it is currently three moments spread across two packages. `seal()` gives it one name and makes AD-7's "immutable after registration" and AD-9's "immutable thereafter" checkable rather than aspirational.
3. **Two ADs are load-bearing in the wrong direction.** AD-1's purity is what makes HOLE-1 and HOLE-5b unfixable inside the unit that hits them, and AD-2's `never` check is what makes HOLE-8 *feel* covered when it is not. Neither AD should be weakened — but each needs the compensating clause that says where the denied information is supposed to come from instead. That is the single highest-value edit in this review: an AD that removes a capability must name its replacement.
