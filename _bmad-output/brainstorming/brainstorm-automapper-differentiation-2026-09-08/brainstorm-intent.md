# Intent: @nestjs-automapper 2.0 — "the mapper that knows your schema"

## Thesis

Every failure encountered with `@automapper/core` — setup tax, contentless "Mapping is not found" errors, silent `undefined` on nested objects, `forMember` selector type pain — plus its outright deletion of `reverseMap()`, traces to one root cause: it has no schema ground truth, so it forces the user to restate what the types already say and then fails silently when they forget. This product owns the schema: adapters supply real descriptors for entities (TypeORM `isGenerated`/`isPrimary`/`isCreateDate`/`isUpdateDate`, Prisma DMMF `@default`/`@updatedAt`) and for DTOs. Parity with automapper at far lower code cost, plus the features it structurally cannot ship — reverse mapping, boot-time verification, real error messages — are all consequences of that single capability.

## Scope — MUST (2.0)

1. `Pick(Entity, [...])` — returns a runtime-real DTO class (Nest `PickType`-style); inherits nullability + column names; renamed column = compile error.
2. `extend()` — the resolver IS the declaration; TS infers the field type from the compute return type; runtime gets field list and resolver from one object.
3. Error quality — did-you-mean, registered neighbours, file pointer.
4. Boot-time validation sweep — `AutomapperModule.forRoot({ validate: true })` builds every plan on `onModuleInit` and fails boot; plus `npx automapper check` for CI.
5. Projection push-down — `projectionFor` / `@Projection`.
6. Typed dep paths — `Path<S>` union, not `string[]`.
7. Auto-register nested pairs — derive the nested pair from entity relation + DTO descriptor; register it or error at boot naming it. Never silent undefined.
8. Per-operation identity map.
9. Reverse map for SCALAR fields only — drops id / timestamps / generated.
10. `schemaOf(Dto)` — OpenAPI schema generated from the descriptor (types, nullability, enums). Promoted from COULD because `extend()` removes the syntactic declaration site `@ApiProperty` needs; shipping `extend()` without it would ship a Swagger regression.

## Scope — SHOULD (2.0 if time)

11. No `createMap` — the DTO is the registration (`Pick` already names the source).
12. Context-gated fields — `visible()` with `T | undefined` return widening.
13. class-validator as a `SchemaAdapter` for non-`Pick` DTOs.
14. Reverse map for relations → foreign keys (the half that killed automapper's version).

## Scope — COULD (2.1+)

- `resolve()` async branding as a compile error on `mapper.map()`.
- Deps optional until `projectionFor` is called.

## Scope — WON'T (this time)

- `mapper.query(User, Dto, { where })` — the DTO-to-query compiler. Strongest idea of the session, but it turns a mapper into a query builder (dialects, joins, pagination). Projection push-down proves the same claim far cheaper. Revisit as 3.0.

## Cut during the session — do not resurrect

- **Mapper-lifetime result cache** — cache goes stale whenever the entity changes. Replaced by the per-operation identity map, which also delivers resolver batching and cycle detection from the same object.
- **Bespoke per-property validation system** — same lifetime defect (rules live on the mapper forever) and duplicates class-validator. Consume class-validator as a `SchemaAdapter` instead; its decorators already are schema metadata (nullability, types, enum values).

## Design constraints

- Strict by default; failures surface at **boot**, not per request. Errors are a headline feature, not a fallback.
- Core stays zero-dependency. ORM-native shapes (TypeORM, Prisma) arrive only through adapters.
- Resolver source dependencies are declared explicitly, as typed `Path<S>` values.
- Validation is direction-asymmetric: it belongs on the WRITE path (CreateDto → Entity). Entities read from your own DB do not need value validation.
- Cache lifetime is scoped to exactly one map operation — staleness becomes structurally impossible.
- Reverse mapping is correct only because of schema descriptors; it must never guess DB-owned vs user-supplied fields.
- Prefer compile errors over runtime throws where the type system can carry the rule (`visible()` widening, async branding).
- Recurring design test for any new feature: *what is the correct LIFETIME and DECLARATION SITE for this thing?*

## Open questions / risks

- **DTO-side descriptor gap** — adapters describe ENTITIES. What produces the descriptor for the DTO side, which strict mode requires? Candidates: class-validator adapter, decorator adapter, TS-type codegen. Unresolved.
- ~~**Swagger cost of `extend()`**~~ — RESOLVED. `schemaOf(Dto)` promoted to MUST (item 10), so the fix ships alongside the cost. Remaining risk is coverage: `schemaOf` must reach parity with hand-written `@ApiProperty` for enums, nested DTOs, arrays, and nullability, or teams will not trust it.
- **`extend()` blocks multi-source DTOs** — one DTO mapped from two different sources has no path through `extend()`; profiles survive only for that case.
- **Relation → foreign-key reversal (SHOULD 14)** is the exact thing that killed automapper's `reverseMap`: relations are not mirror images (read expands to a nested DTO, write takes a foreign key id). Highest-risk item in scope.
- `export const X` + `export type X` declaration merging must keep `extend()` results usable as classes across Nest DI, Swagger, and TS consumers.
