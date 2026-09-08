---
type: reconciliation-review
subject: ARCHITECTURE-SPINE.md (architecture-custom-nestjs-automapper-2026-09-08)
driving-input: _bmad-output/specs/spec-nestjs-automapper-2/SPEC.md (+ api-surface.md, scope-tiers.md, automapper-gap-analysis.md, architecture-diagrams.md)
date: 2026-09-08
verdict: structurally sound, but leaks the SPEC's quiet layer
---

# Reconciliation review — SPEC → ARCHITECTURE-SPINE

**Reports only what did NOT land.** Everything not listed here was found to be governed and is not repeated.

The spine's compiler paradigm, AD-1..AD-11, and the CAP map carry the *loud* layer of the SPEC well: all ten capabilities are bound, the zero-dependency rule, the per-operation cache lifetime, the codegen-safety rules, and the no-plugin guarantee are all genuinely governed. What did not survive is the SPEC's quiet layer — the resolved decisions, the direction-asymmetric and boundary constraints, the SHOULD-tier headroom, and two obligations that the ADs, as literally written, actively obstruct.

Severity: **BLOCKING** = a builder following the spine produces something the SPEC rejects, or an AD makes a committed capability unimplementable. **MAJOR** = a stated SPEC rule has no governing text and will be re-litigated or silently violated. **MINOR** = traceability / hygiene.

---

## A. Contradictions — an AD obstructs a SPEC obligation

### A-1 (BLOCKING) — AD-1 forbids back-ends from seeing descriptor data that CAP-9, CAP-8 and CAP-4 structurally require

AD-1: *"Back-ends consume `MappingPlan` only and must not import an adapter or a descriptor type."* Structural Seed reinforces it: *"each depends on `plan/`, none on `descriptor/`."*

Three committed capabilities need descriptor facts at back-end time:

| Capability | Needs | Source in api-surface.md |
| --- | --- | --- |
| CAP-9 `schemaOf` | `type`, `nullable`, `enumValues`, array-ness, nested DTO reference | `FieldMeta` / `RelationMeta` on `TypeDescriptor` |
| CAP-8 reverse | `isPrimary`, `isGenerated`, `isCreateDate`, `isUpdateDate`, `isDeleteDate`, `hasDefault` | `FieldMeta` provenance block ("CAP-8 depends entirely on these") |
| CAP-4 errors | `producedBy` (`adapter: typeorm` in the error text) and the *set of source field names* that produces "did you mean 'display_name'?" | `TypeDescriptor.producedBy`, `fields[]` |

The spine never states that `MappingPlan` / `ResolutionNode` carries a lowered copy of these facts. As written, the schema emitter cannot know an enum's values, the explainer cannot name the adapter or compute a near-miss, and reverse mapping cannot read provenance. Either AD-1 is violated in practice, or the missing invariant — **the plan is descriptor-complete: lowering copies onto each node every descriptor fact any back-end will need, and back-ends never reach back** — must be stated. It is exactly the invariant AD-1 implies and never says. This is the single most consequential omission in the document.

Corollary the spine also owes: CAP-9's OpenAPI `$ref` to a nested DTO and CAP-8's write-DTO synthesis both need the *destination-side* descriptor of another type, i.e. plan-to-plan reachability. AD-1 + AD-2 leave that undefined.

### A-2 (BLOCKING) — AD-7's blanket "no module-level mutable state anywhere" collides with the boot sweep and pre-empts SHOULD item 11

AD-7's rule is stated absolutely. But:

- **CAP-3 / MUST item 4** requires `validateAll()` to sweep *every* plan at boot. Discovering the DTOs to sweep requires either explicit registration of all of them or a module-level registry populated at import time.
- **SHOULD item 11 ("the DTO *is* the registration, no explicit `createMap`")** is, by construction, a module-level registry that `Pick`/`extend` write into at import time. Under AD-7 as written it is illegal.

AD-7's intent is clearly *per-request/per-operation* state, and its own second sentence exempts the registry ("immutable after registration"). But the third sentence is unqualified and a builder will read it as a ban. The exemption needs to be stated as a rule rather than left as an aside — e.g. "append-only registration-time state keyed by constructor is permitted and must be frozen before the boot sweep runs; all other module-level mutable state is forbidden." Without that, either CAP-3's discovery mechanism or SHOULD-11 gets designed out.

### A-3 (BLOCKING) — SHOULD item 13 (`class-validator` as a schema adapter) has no legal home under AD-6 + the three-package constraint

SPEC Constraint: *"2.0 ships exactly three packages: `core`, `typeorm`, `nestjs`."* AD-6: *"`core` imports nothing. `typeorm` and `nestjs` import `core` only."*

A `class-validator` schema adapter must import `class-validator`. It cannot live in `core` (zero deps), it cannot live in `typeorm` (unrelated peer, and "an adapter never imports another adapter"), and putting it in `nestjs` gives the framework package an adapter role AD-6's own diagram assigns to adapter packages. Scope-tiers marks it SHOULD *for 2.0*, and calls it "required for DTOs not derived from an entity" and the partial mitigation for the multi-source limit (see B-4). The spine neither reserves a fourth package slot nor states which of the three would host it nor declares it a 2.1 package. As it stands the SHOULD item is unimplementable without amending an AD.

Related and also unaddressed: `SchemaAdapter.supports()` implies **multiple adapters may claim the same type** (a DTO carrying both TypeORM and `class-validator` metadata is the motivating case). The spine defines no resolution order, no merge/precedence rule, and no conflict error. AD-1 says adapters produce descriptors and the planner consumes them — but not what happens when two produce one for the same class.

### A-4 (MAJOR) — AD-6's `nestjs ↛ typeorm` ban vs. the Success signal's own hello-world

The reference hello-world that the Success signal is measured against is:

```ts
@Get() @MapTo(ReadUserDto)
findAll(@Projection(ReadUserDto) find: FindManyOptions<User>) { return this.repo.find(find); }
```

`@Projection` ships in `nestjs`; `FindManyOptions<User>` is a TypeORM type. The runtime path is fine (resolve through the registered adapter's `toNativeProjection`, typed `unknown`), but the spine never says so, and the *typing* of the decorated parameter — the thing that makes the ten-line example ergonomic — is left as an unowned collision with AD-6. Needs an explicit carve-out (type-only import? generic pass-through? consumer casts?) or the example does not compile as written.

### A-5 (MAJOR) — AD-10 tilts toward precisely the behaviour the SPEC excludes

SPEC Constraint: *"Projection throws when the plan contains context-gated fields and no context is supplied. Projecting the union of all contexts is excluded: it silently over-fetches, which is the failure CAP-5 exists to prevent and which no code review would catch."* Also in **Resolved**.

AD-10 says the projector *"walks `MappingPlan` nodes and unions their declared `deps`"* — an unconditional union, with no mention of context, gating, or a throw. `projectionFor(..., { ctx })` in api-surface.md exists specifically because "context-gated fields change what must be fetched," and the spine's projector contract has no context parameter at all. A builder implementing AD-10 literally ships the excluded behaviour. This is the clearest case of an AD-shaped structure losing a resolved decision.

---

## B. Resolved decisions that did not carry

### B-1 (BLOCKING) — Cycle policy: four of five sub-rules dropped, and the boot/runtime split is inverted

The SPEC constraint has five distinct parts:

| Sub-rule | In spine? |
| --- | --- |
| Ancestor chain, not a global visited set | Yes — named in AD-7's state list |
| A repeated reference reachable by two independent paths is **shared data, not a cycle, and must still map** | **Dropped** |
| A true back-edge on a **non-optional** field **fails at boot** | **Dropped** |
| A back-edge on an optional field is **omitted by default**, with a **reference-marker mode available per map** | **Dropped** |
| A **depth ceiling** backstops the runtime | **Dropped** |

Only the mechanism survived; the policy did not. The two dropped rules that will actually be got wrong are the shared-vs-cycle distinction (the exact bug the ancestor-chain choice exists to prevent — CAP-7's "100 items sharing 5 distinct objects" success test depends on it) and the per-map reference-marker mode, which is an API-surface option (`MapOptions`) that nothing in the spine reserves room for.

Worse, the **Resolved** section states cycle detection is *"static and boot-time"*, while the Capability Map assigns CAP-7 entirely to `core/runtime` governed by AD-7 (an operation-lifetime rule) with no plan-validator involvement. The boot-time half of the policy has no home and no binding AD.

### B-2 (MAJOR) — Projection without context

See A-5. The resolved "throws" decision appears nowhere in the spine.

### B-3 (MAJOR) — Declaration-merging spike: both carry-forward findings dropped, and `spike/` has no home

**Resolved** cleared CAP-1/2/9/10 on the spike, and api-surface.md flags *"Two findings worth carrying into implementation"*:

1. **"The helper's constructor must assign each key (even as `undefined`) so instances carry real own-properties. Omitting this reproduces the v1 defect, where a presence check against the destination object was always false and every mapping silently produced an empty result."** This is an invariant of exactly the shape and provenance as AD-4 (a named v1 defect, mechanically checkable, silently catastrophic if violated) — and it is absent from the ADs, from Consistency Conventions, and from the `core/dto/` seed note. It is the highest-value single line missing from the document.
2. The `Pick` value/type namespace non-shadowing finding — absent (minor, but it is what makes the naming convention safe).

Also: `spike/` is cited by both SPEC and api-surface as the executable proof, and the Structural Seed does not include it. A layout that omits it invites its deletion.

### B-4 (MAJOR) — The multi-source DTO boundary, and profiles/`forFeature`, have no architectural home

**Resolved**: *"A DTO mapped from two sources uses explicit profile registration rather than the single-declaration form. Documented as a limit, not a defect."* api-surface.md gives it a surface: `AutomapperModule.forFeature([UserProfile])`, and CAP-4's error format references *"Nearest profile: src/mapping/user.profile.ts:14"*.

The spine mentions neither profiles nor `forFeature` anywhere. The `nestjs/src/` seed lists "module, ALS context, `@MapTo`, `@Projection`, boot sweep" — no profile concept. Consequences: (a) the profile as a registration unit has no owning namespace; (b) the accepted 2.0 *limit* is unrecorded, so a builder may attempt to generalise the single-declaration form to multi-source and blow the boundary; (c) CAP-4's file-pointer to a profile has nothing to point at.

### B-5 (MINOR) — pnpm rationale: carried; the open action was not

The rationale itself **did land** (AD-6, *"Enforced by lint rule and pnpm's strict resolution"*) — this is the one resolved decision that survived cleanly. Two attached facts did not: *"the org itself still requires creation"* (a release blocker, absent from Deferred and from any note), and the workspace plumbing that AD-6 leans on — `pnpm-workspace.yaml`, `nx.json`, an `.npmrc` pinning strict resolution — is absent from the Structural Seed, which shows only `packages/` and `docs/`.

### B-6 (MINOR) — `docs/DESIGN.md` superseded banner

Resolved requires retention with a banner for traceability. The seed has a bare `docs/`; no note.

---

## C. Constraints with no governing AD or convention

Walking all 13. Constraints 1, 4, 6, 8, 9, 10 are governed (AD-6/AD-10, AD-8, AD-7, AD-3/AD-4 + Deferred, Stack + AD-6, scope line). The rest:

### C-1 (MAJOR) — Constraint 5, direction-asymmetric validation, is dropped entirely

*"Validation is direction-asymmetric — it applies to the write path only. Entities read from the project's own database are not value-validated."*

Nothing in the spine — no AD, no convention, no capability row — mentions this. It is load-bearing twice over: it is what keeps the read path fast and what scopes the `class-validator` adapter (SHOULD-13) to the write direction only. Without it, a builder wiring `class-validator` in as a schema adapter has no stated reason not to run validation on every read map, and the non-goal "**A validation framework**" is the only thing standing between the library and a per-read validation pass.

### C-2 (MAJOR) — Constraint 13's design-acceptance test is halved

*"Every stateful mechanism must declare its lifetime **and every field must have exactly one declaration site**. A design that leaves either implicit is rejected — this test is what eliminated the result cache, the bespoke validation registry, and the duplicated field declaration, and **it applies to features proposed later**."*

AD-7 carries the first half, and only for map-operation state. Missing: (a) the *single declaration site* half — which is the entire point of CAP-2 and the reason MUST item 10 (OpenAPI) was promoted from COULD, and which nothing in the spine protects against a future "just add an `@ApiProperty` too" fix; (b) the forward-applying character of the test — the spine records ADs but no acceptance gate for features proposed after it, which is what the SPEC explicitly asked to be carried.

Note the same constraint indicts an omission of the spine's own: **request-context lifetime is undeclared**. `contextFactory`, `Mapper<Ctx>`, and the `AsyncLocalStorage` mentioned only as a seed comment are a stateful mechanism whose lifetime (request-scoped, established where, torn down where, what happens on a background job with no request) is nowhere stated — while AD-7 simultaneously declares no module-level mutable state, which an ALS instance nominally is.

### C-3 (MAJOR) — Constraint 2's "strict by default" posture is weaker in the spine than in the SPEC

*"Strict by default. An unresolved destination field is an error, and it surfaces at application boot. **Lazy first-call validation is not sufficient on its own.**"*

AD-8's ladder legitimises "first call" as a rung and asks only for the "leftmost feasible" one — which is defensible, but it never states that boot validation is *mandatory and on by default* for the unresolved-field case specifically. `validate: true` appears only in api-surface.md; the spine never says the default is on, nor that turning it off is not a supported way to ship. A builder reading AD-8 alone could ship first-call validation and claim compliance.

### C-4 (MAJOR) — Constraint 3's exclusions are not carried as prohibitions

*"Proxy tracing and `fn.toString()` parsing are excluded: both under-collect across branches and break under minification, reintroducing silent under-fetch."*

AD-3 forbids stringifying resolvers *into generated code* — a different rule, for a different reason. Nothing forbids a future contributor from adding proxy-based or `toString`-based **dependency inference** to remove the ergonomic cost of declaring `deps` (COULD item 16 makes that pressure explicit). This is the classic "convenience feature that silently defeats CAP-5" and the SPEC pre-emptively banned it; the spine did not.

### C-5 (MINOR) — Constraint 11 (cycles) — see B-1. Constraint 12 (projection/context) — see A-5. Constraint 7 (schema-descriptors-only reverse, no naming heuristics) — the *prohibition* on naming heuristics is not restated; the CAP-8 row cites AD-1/AD-2, which as shown in A-1 actually obstruct provenance access.

---

## D. Non-goals — the spine has no non-goals section

All six SPEC non-goals are absent from the spine. The `Deferred` section contains five items, none of which are the SPEC's non-goals, so a reader of the spine alone has no record of what is deliberately out.

| Non-goal | Consequence of the drop |
| --- | --- |
| **Query building** (the WON'T tier; *"judged the strongest idea produced during design, and deliberately deferred"*) | Highest risk. `core/project` + adapter `toNativeProjection` is exactly where a query compiler grows. Nothing in the spine says "the projector emits field selection only, never predicates, joins strategy, or pagination — revisit at 3.0." |
| **A validation framework** | See C-1. |
| Result caching across operations | Governed by AD-7 (the only non-goal that landed). |
| Prisma / Mongoose / Drizzle adapters | Partly implied by Deferred's capability-negotiation item; the "2.1 and later" boundary itself is unstated. |
| Browser / CSP runtimes | Governed by Deferred. |
| Migration from v1 | Unstated. The spine cites "the v1 defect" twice as a thing to prevent but never records that v1 is archived and is not a migration target — nor SPEC's assumption that `@automapper/core` users are not a migration constituency and the API is not source-compatible. A builder could reasonably design for compatibility. |

Also dropped from `scope-tiers.md`: the **"Cut during design — do not resurrect"** list (mapper-lifetime result cache, bespoke per-property validation). AD-7 blocks the first mechanically; the second has no guard at all (see C-1) and is the one whose replacement is a SHOULD item, so the resurrection risk is live.

---

## E. SHOULD-tier headroom

| # | Item | Room left? |
| --- | --- | --- |
| 11 | Implicit registration | **Blocked as written** — see A-2. Also unaddressed: AD-8's ladder and CAP-3's sweep both assume a knowable set of plans; implicit registration changes *when* that set is complete, which interacts with "immutable after registration" in AD-7. |
| 12 | Context-gated fields | **No room reserved.** Context appears nowhere in the IR, in AD-2's node set, or in AD-10's projector contract. Because AD-2 declares that adding a node kind is "a breaking change to `core` [that] must update every back-end in the same commit," landing the SPEC's *headline differentiator* — and the promotion candidate if 2.0 needs a louder one — is now a breaking change by construction. Additionally, `visible(pred, inner?)` composes by **wrapping another resolver**, so `ResolutionNode` must admit child nodes; a flat closed union with exhaustive switches does not obviously accommodate that, and the spine does not say whether nodes nest. |
| 13 | `class-validator` adapter | **Blocked as written** — see A-3 (no legal package, no multi-adapter precedence rule). |
| 14 | Relation reversal → foreign keys | **Room, but unmarked.** `RelationMeta.joinColumns` (annotated in api-surface as "CAP-8 relation reversal (SHOULD tier)") is never mentioned; scope-tiers calls this "the highest-risk item in scope"; the gap analysis's decisive `address` row — a read mapping expands a relation, a write mapping accepts a scalar key — is the reasoning that makes this hard and is nowhere recorded. Under A-1's unresolved descriptor question, the reversal has no stated route to `joinColumns` at all. |

COULD item 16 ("dependency declarations optional until projection is requested") deserves a note: it is in direct tension with AD-10's plan-only projector and with C-4. Not a gap in itself, but the spine gives a future implementer no warning.

---

## F. Success signal — achievable, with two holes

> *"…a working read endpoint — DTO plus controller — in under ten lines of new code, with zero mapping decorators and no build-plugin configuration, and the issued SQL selects only the columns that DTO consumes. Deliberately breaking that mapping (removing a field's source) fails `nest start` with an error that names the field, the reason, and the fix."*

Structurally the spine supports it: AD-11's no-plugin guarantee is the strongest single thing in the document and the memlog's TS 7 finding genuinely strengthens CAP-1. Two clauses are not carried:

### F-1 (MAJOR) — "the fix" and "where to fix it" are missing from AD-5's field list

AD-5 fixes the structured fields as `sourceType`, `destType`, `field`, `candidates`, `adapter`. The SPEC's CAP-4 requires *"names what failed, why, the nearest valid alternatives, **and where to fix it**"*; the illustrated format carries a remediation line (`Register it: createMap(User, ReadUserDto)`, `Resolve it, or mark it ignore().`) and a **source location** (`Nearest profile: src/mapping/user.profile.ts:14`); `scope-tiers.md` MUST item 3 names the **file pointer** explicitly. Neither remediation nor location is in AD-5's enumerated fields, and AD-5 forbids per-package string assembly — so as governed, the fix and the file pointer have nowhere to live. Add `remediation` and `location` to the taxonomy, and state how a location is captured (registration-site capture is a design decision with cost; it needs to be made, not assumed).

### F-2 (MAJOR) — The CI check command has no package, and its no-running-app requirement is unexamined

CAP-3's success clause: *"The same condition is detectable in CI **without starting the application**."* `scope-tiers.md` MUST item 4: "Boot-time validation sweep **+ CI check command**." api-surface.md: `npx automapper check`.

The Structural Seed has no `bin/`, no CLI entry, and the SPEC's "exactly three packages" leaves no room for a fourth. Which package publishes the binary, how it discovers the consumer's DTOs and profiles, and — the substantive question — how it builds descriptors without an initialised `DataSource` (TypeORM's `getMetadata` needs one) are all unaddressed. This is a MUST-tier deliverable with no architectural home.

---

## G. Smaller drops and internal inconsistencies

- **G-1 (MAJOR, spine-internal).** The memlog records a decision from TypeORM 1.1.1 verification that never reached the spine: `ColumnMetadata.isSelect` (*"`select:false` columns such as `password` must never be projected or mapped by default"*), `isVersion` (another DB-owned field for the CAP-8 drop list), and `isDiscriminator`. The `isSelect` item is a **data-exposure** rule for CAP-5, and the gap analysis's `password` row makes it concrete. Note the SPEC's own `FieldMeta` also lacks `isSelect`/`isVersion`, so this needs to flow both ways.
- **G-2 (MINOR).** CAP-1's success clause *"Renaming the underlying entity column makes the DTO fail to compile"* is a type-level obligation; its Capability-Map row cites AD-1 and AD-11, neither of which governs compile-time behaviour. AD-8 is the natural binder and is not listed.
- **G-3 (MINOR).** CAP-6's row cites AD-2 and AD-4, covering auto-registration but not the *"startup fails naming that pair — it never yields `undefined`"* half, which is AD-8 + plan-validator territory. Same shape of gap as CAP-7 (B-1).
- **G-4 (MINOR).** The Design Paradigm table lists back-ends as "Codegen, projector, explainer, plan validator, schema emitter" with namespaces `core/emit/`, `core/project/`, `core/diagnose/` — omitting `core/schema/`, which the seed does contain. The Structural Seed then says "the four `core` back-ends," which does not reconcile with the five roles listed. Cosmetic, but the OpenAPI back-end is the one A-1 most endangers, so under-listing it is unhelpful.
- **G-5 (MINOR).** The Stack table pins TypeScript, Nx, pnpm, Vitest, Nest, TypeORM and `reflect-metadata` — but **no Node version and no `engines` floor**, despite Node being the SPEC's only target runtime, `new Function` codegen depending on it, and the spike being validated on Node 22.
- **G-6 (MINOR).** SPEC assumption *"`schemaOf` must reach **full parity** with hand-written property decorators. Partial parity was judged worse than none, since teams would then maintain both paths."* CAP-9 has a row but the parity bar — the acceptance criterion that decides when CAP-9 is done — is recorded nowhere.
- **G-7 (MINOR).** `architecture-diagrams.md`'s pipeline shows three inputs converging on `TypeDescriptor`: schema adapters, **decorator overrides (optional)**, and **explicit map config**. The spine's paradigm table admits only schema adapters as front-ends (config is mentioned once, at lowering; decorator overrides not at all). AD-1's "adapters produce `TypeDescriptor` only" gives an optional decorator-override channel no legal producer.
- **G-8 (MINOR).** `Mapper<Ctx>`'s context type parameter, `MapperOptions`, `MapOptions`, and `mapper.use(adapter)` (the adapter registration/ordering path — see A-3) have no architectural mention.

---

## Recommended minimum set of amendments

Ordered by consequence, not by effort:

1. **State the plan-completeness invariant** (A-1) — lowering copies every descriptor fact the back-ends need onto plan nodes; define plan-to-plan reachability for nested types. Without it CAP-8, CAP-9 and half of CAP-4 are blocked by AD-1.
2. **Restore the cycle policy in full** (B-1) — all five sub-rules, with the boot-time half bound to the plan validator, not to `core/runtime`.
3. **Add a projection-context rule** (A-5) — projector takes context; throws when the plan has gated fields and none is supplied; union-of-all-contexts explicitly forbidden.
4. **Extend AD-5** with `remediation` and `location`, and decide how a registration site is captured (F-1).
5. **Qualify AD-7** to permit registration-time, constructor-keyed, frozen-before-boot state (A-2), unblocking the boot sweep and SHOULD-11.
6. **Add an AD or convention for the DTO runtime contract** carrying the spike's own-property rule verbatim (B-3).
7. **Add a Non-Goals / Out-of-Bounds section** carrying all six SPEC non-goals plus the two "do not resurrect" cuts, with query building called out against `core/project` (D).
8. **Add the direction-asymmetric validation rule** (C-1) and Constraint 13's single-declaration-site half plus its forward-applying acceptance test (C-2).
9. **Decide the `class-validator` adapter's package** and the multi-adapter precedence rule (A-3), and the `@Projection` typing carve-out against AD-6 (A-4).
10. **Give `npx automapper check` a home** and answer descriptor-building without a live `DataSource` (F-2).
11. Fold in the memlog's `isSelect` / `isVersion` / `isDiscriminator` decision (G-1); pin Node in Stack (G-5); add `spike/`, `pnpm-workspace.yaml`, `nx.json`, `.npmrc` to the Structural Seed (B-3, B-5).
