---
id: SPEC-nestjs-automapper-2
companions:
  - api-surface.md
  - scope-tiers.md
  - automapper-gap-analysis.md
  - architecture-diagrams.md
sources:
  - ../../brainstorming/brainstorm-automapper-differentiation-2026-09-08/brainstorm-intent.md
  - ../../../docs/DESIGN.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# @nestjs-automapper 2.0

## Why

An opportunity, on top of a pain. Every failure NestJS developers hit with `@automapper/core` — the setup tax of decorating both sides of every mapping, `"Mapping is not found"` errors that name nothing, nested objects that silently resolve to `undefined`, and selector-generic type friction — traces to a single root cause: the library has no schema ground truth. It cannot verify a mapping, cannot infer a nested pair, and cannot tell a database-generated column from a user-supplied one, so it makes the developer restate what the types already say and then fails quietly when they forget. The same deficit is why its predecessor's `reverseMap()` was deleted rather than fixed.

Modern TypeScript backends already carry that ground truth in the ORM: TypeORM entity metadata and Prisma's DMMF both describe every column's type, nullability, native name, and provenance. A mapper that reads that metadata can do things the incumbent structurally cannot — verify mappings at boot, derive what to `SELECT`, and reverse a mapping correctly. This spec covers 2.0, which proves the thesis on one adapter (TypeORM) and one framework integration (NestJS).

Predecessor context: v1 of this library shipped a decorator pipeline that never executed, because metadata was written to `prototype + propertyKey` and read from the constructor. It is archived on branch `v1-archive` and is not a migration target.

## Capabilities

- **CAP-1** — DTO definition without restating the entity
  - **intent:** A developer defines a DTO by naming which entity fields it carries, without per-property decorators and without a build-time transformer plugin, and the resulting class still exposes a runtime descriptor.
  - **success:** A DTO carrying twelve entity fields is defined with no decorators; `nest start` runs under plain `tsc` (no transformer plugin configured) and the mapped output contains all twelve fields populated. Renaming the underlying entity column makes the DTO fail to compile.

- **CAP-2** — A derived field is declared once
  - **intent:** A field computed from source values is declared in one place, and that single declaration supplies both its static type and its runtime resolution.
  - **success:** A computed `fullName` field appears exactly once in user code. `typeof dto.fullName` is `string` at compile time, and the mapped value is correct at runtime, with no second declaration of the field name anywhere.

- **CAP-3** — Broken mappings surface at boot
  - **intent:** A mapping that cannot be fully resolved fails when the application starts, not when a request hits it.
  - **success:** A DTO with one destination field that has no source and no explicit resolution causes application startup to fail. The same condition is detectable in CI without starting the application.

- **CAP-4** — Errors are diagnosable from their text
  - **intent:** A mapping failure names what failed, why, the nearest valid alternatives, and where to fix it, without the developer reading library source.
  - **success:** Requesting an unregistered mapping produces an error naming the source type, the destination type, the destination types that *are* registered for that source, and a nearest-match suggestion. A field with no resolution names the field, the source type searched, and a near-miss candidate when one exists.

- **CAP-5** — Fetch only what the DTO uses
  - **intent:** A DTO determines which columns and relations are retrieved, so a query fetches what will be mapped and nothing else.
  - **success:** Given a DTO consuming five of an entity's twenty columns, the issued SQL selects exactly those five plus any columns declared as dependencies of computed fields. Relations not consumed by the DTO are not joined.

- **CAP-6** — Nested relations map without per-pair registration
  - **intent:** Mapping a relation to a nested DTO requires no separate registration of the nested type pair.
  - **success:** A DTO with a nested relation DTO maps correctly with only the top-level mapping declared. If the nested pair cannot be derived, startup fails naming that pair — it never yields `undefined`.

- **CAP-7** — Cyclic and shared graphs map safely
  - **intent:** An object graph containing back-references or repeated references maps without unbounded recursion, and each distinct source object is mapped once per operation.
  - **success:** A self-referencing entity graph maps without stack overflow. Mapping an array of 100 items sharing 5 distinct related objects invokes the related mapping 5 times, not 100. State does not survive the operation.

- **CAP-8** — Write-side DTOs derived from read-side ones
  - **intent:** A write DTO is derived from an existing read mapping, with database-owned scalar fields excluded automatically rather than listed by hand.
  - **success:** Reversing a read mapping produces a write DTO in which primary keys, generated columns, and create/update/delete timestamps are absent, determined from schema metadata rather than field naming.

- **CAP-9** — OpenAPI schema for fields with no declaration site
  - **intent:** A DTO produces an accurate OpenAPI schema even where its fields have no syntactic declaration site to decorate.
  - **success:** A DTO combining entity-derived and computed fields yields an OpenAPI schema covering every field with correct type, nullability, enum values, arrays, and nested DTO references — matching what hand-written property decorators would have produced.

- **CAP-10** — Dependency path typos are compile errors
  - **intent:** A resolver's declared source dependencies are checked against the source type by the type system.
  - **success:** A computed field declaring a dependency path that does not exist on the source type fails `tsc`. Valid nested paths are accepted.

## Constraints

- The `core` package has zero runtime dependencies. It computes a neutral field-selection tree; ORM-native `select`/`include` shapes are produced only by adapter packages. No ORM may be imported from `core`.
- Strict by default. An unresolved destination field is an error, and it surfaces at application boot. Lazy first-call validation is not sufficient on its own.
- Resolver source dependencies are declared explicitly as typed path values. Proxy tracing and `fn.toString()` parsing are excluded: both under-collect across branches and break under minification, reintroducing silent under-fetch.
- Prefer a compile error over a runtime throw wherever the type system can carry the rule.
- Validation is direction-asymmetric — it applies to the write path only. Entities read from the project's own database are not value-validated.
- Cache lifetime is scoped to exactly one map operation. No mapper-lifetime or cross-request result cache.
- Reverse mapping determines database-owned versus user-supplied fields from schema descriptors only. Naming heuristics are excluded.
- Mapping functions are generated per type pair at registration via `new Function`. This targets Node; CSP-restricted runtimes are out of scope.
- Distribution is an Nx monorepo under the npm scope `@nestjs-automapper/*`, with **pnpm** as the package manager — its strict `node_modules` is what makes the zero-dependency rule enforceable rather than aspirational. Package names verified available on the registry as of 2026-09-08; the org itself still requires creation.
- 2.0 ships exactly three packages: `core`, `typeorm`, `nestjs`.
- Cycle detection tracks the ancestor chain, not a global visited set — a repeated reference reachable by two independent paths is shared data, not a cycle, and must still map. A true back-edge on a non-optional field fails at boot; on an optional field the default is to omit it, with a reference-marker mode available per map. A depth ceiling backstops the runtime.
- Projection throws when the plan contains context-gated fields and no context is supplied. Projecting the union of all contexts is excluded: it silently over-fetches, which is the failure CAP-5 exists to prevent and which no code review would catch.
- Every stateful mechanism must declare its lifetime and every field must have exactly one declaration site. A design that leaves either implicit is rejected — this test is what eliminated the result cache, the bespoke validation registry, and the duplicated field declaration, and it applies to features proposed later.

## Non-goals

- **Query building.** A DTO-to-query compiler that issues its own SQL and bypasses entity hydration is out of scope. Projection push-down (CAP-5) proves the same claim at a fraction of the cost. Revisit at 3.0.
- **A validation framework.** No bespoke per-property validation system. `class-validator` is consumed as a metadata source, not replaced.
- **Result caching across operations.** Explicitly cut; see Constraints.
- **Prisma, Mongoose, and Drizzle adapters.** 2.1 and later.
- **Browser or CSP-restricted runtimes.**
- **Migration from v1.** v1 is archived, not upgraded.

## Success signal

A NestJS developer with an existing TypeORM entity produces a working read endpoint — DTO plus controller — in under ten lines of new code, with zero mapping decorators and no build-plugin configuration, and the issued SQL selects only the columns that DTO consumes. Deliberately breaking that mapping (removing a field's source) fails `nest start` with an error that names the field, the reason, and the fix.

## Assumptions

- Node is the only target runtime for 2.0, inferred from the `new Function` codegen decision and the absence of any browser requirement in the sources.
- `schemaOf` must reach full parity with hand-written property decorators. Partial parity was judged worse than none, since teams would then maintain both paths.
- Existing `@automapper/core` users are not a migration constituency for 2.0; the API is not source-compatible.

## Resolved

All six questions raised at spec creation are closed. Recorded here because the reasoning binds downstream work.

- **Package manager — pnpm.** The only one of the three whose resolution model actually enforces the `core` zero-dependency constraint and prevents an adapter relying on a hoisted package it never declared. Migration cost is nil: no `node_modules` is installed, so `yarn.lock` is simply removed.
- **Cycle policy** — see Constraints. Detection is static and boot-time; the ancestor-chain rule is what keeps shared references from being misread as cycles.
- **Projection without context** — throws. See Constraints.
- **Declaration-merging viability — proven by spike, not argument.** See `spike/`. Under TypeScript 5.9 `--strict` and Node 22: the technique yields a function with a prototype (satisfying NestJS DI), `instanceof` holds, the prototype chain survives composition, the runtime field registry equals picked-plus-computed keys, resolvers and their declared dependencies are reachable at runtime, and instances carry real own-properties. That last point is the direct fix for the v1 defect in which a presence check against the destination was always false. All six negative cases — misspelled dependency path, invalid nested path, picking a non-existent field, synchronously mapping an async DTO, treating a gated field as non-optional, and reading an unpicked field — fail to compile. CAP-1, CAP-2, CAP-9, and CAP-10 are cleared to build.
- **Multi-source DTOs** — accepted boundary for 2.0. A DTO mapped from two sources uses explicit profile registration rather than the single-declaration form. Documented as a limit, not a defect; the `class-validator` adapter (SHOULD tier) partially mitigates it.
- **`docs/DESIGN.md`** — retained with a superseded banner pointing here. Not deleted, since it is cited in `sources:` and removing it would break traceability.
