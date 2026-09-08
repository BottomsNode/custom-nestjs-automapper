# Scope tiers

Companion to `SPEC.md`. The full MoSCoW as approved on 2026-09-08, including the tiers the kernel does not carry. Capabilities `CAP-1`–`CAP-10` in `SPEC.md` correspond one-to-one with the MUST tier.

## MUST — 2.0 commitment

| # | Item | Capability |
|---|------|-----------|
| 1 | Entity-derived DTO class, runtime-real, no decorators | CAP-1 |
| 2 | Single-declaration derived fields | CAP-2 |
| 3 | Error quality — did-you-mean, registered neighbours, file pointer | CAP-4 |
| 4 | Boot-time validation sweep + CI check command | CAP-3 |
| 5 | Projection push-down | CAP-5 |
| 6 | Typed dependency paths | CAP-10 |
| 7 | Auto-registered nested pairs | CAP-6 |
| 8 | Per-operation identity map | CAP-7 |
| 9 | Reverse mapping, scalar fields | CAP-8 |
| 10 | OpenAPI schema generation from the descriptor | CAP-9 |

Item 10 was promoted from COULD after review found that single-declaration derived fields (item 2, MUST) remove the syntactic declaration site that property decorators need. Shipping item 2 without item 10 would ship an OpenAPI regression for exactly the fields the feature exists to simplify.

## SHOULD — 2.0 if schedule allows

| # | Item | Note |
|---|------|------|
| 11 | Implicit registration — the DTO is the registration, no explicit `createMap` | Depends on items 1 and 4. Risk: implicit registration is harder to debug than explicit. |
| 12 | Context-gated fields, with the gate widening the field's static type to include `undefined` | A headline differentiator, but a large surface addition. |
| 13 | `class-validator` consumed as a schema adapter | Required for DTOs not derived from an entity. Partially mitigates the multi-source limitation. |
| 14 | Reverse mapping for relations → foreign keys | Highest-risk item in scope. See `automapper-gap-analysis.md`. |

If 2.0 slips, items 11–14 are the first to move. If the release needs a louder differentiator, item 12 is the stronger promotion candidate: "one DTO, role-aware fields" is legible to someone who has not yet adopted the library, whereas item 11 only becomes valuable after adoption.

## COULD — 2.1 and later

| # | Item |
|---|------|
| 15 | Async-branded DTOs, making a synchronous map of an async DTO a compile error rather than a runtime throw |
| 16 | Dependency declarations optional until projection is requested, so the cost is paid only where the benefit is collected |

## WON'T — this cycle

**DTO-to-query compilation.** Deriving SQL directly from the DTO and skipping entity hydration entirely.

Judged the strongest idea produced during design, and deliberately deferred. It converts the library from a mapper into a query builder, which brings dialect differences, join strategy, pagination, and predicate composition — an ORM's problem surface. Attempting it in 2.0 risks shipping neither the mapper nor the query layer well. Projection push-down (CAP-5) validates the same underlying claim — that the DTO knows what to fetch — at a fraction of the cost. Revisit as 3.0 once CAP-5 has real usage behind it.

## Cut during design — do not resurrect

**Mapper-lifetime result cache.** Keyed on the source object and living as long as the mapper, so it went stale the moment an entity changed, and returned a shared mutable instance. Superseded by the per-operation identity map (CAP-7), which additionally delivers cycle detection and resolver deduplication from the same structure. Staleness is a function of cache lifetime; scoping the lifetime to one operation makes staleness structurally impossible.

**Bespoke per-property validation.** Registered imperatively on the mapper and keyed by class name, so it carried both a name-collision hole and unbounded lifetime. It also duplicated `class-validator`, which every NestJS project already has. Superseded by consuming `class-validator` as a metadata source (item 13): its decorators already encode nullability, types, and enum values.
