# Gap analysis — why the incumbent fails

Companion to `SPEC.md`. The evidence behind the Why, and the specific reasoning that makes `CAP-8` tractable here and intractable there. Downstream should read this before questioning why a capability is scoped the way it is.

## Verified surface of `@automapper/core`

Enumerated from the published source tree on 2026-09-08.

**Mapping configuration:** `afterMap` · `afterMapArray` · `autoMap` · `beforeMap` · `beforeMapArray` · `constructUsing` · `extend` · `forMember` · `forSelf` · `namingConventions` · `typeConverters`

**Member map functions:** `condition` · `convertUsing` · `fromValue` · `ignore` · `mapDefer` · `mapFrom` · `mapInitialize` · `mapWithArguments` · `mapWith` · `nullSubstitution` · `preCondition` · `undefinedSubstitution`

No reverse-mapping construct exists. The library does precompile mappings.

## The five failures and their single cause

| Observed failure | Mechanism |
|---|---|
| Setup tax: four packages, a transformer plugin, a profile class, and a decorator on every property on both sides, before one field maps | The library cannot see the type, so the developer must restate it |
| `"Mapping is not found"` naming neither side nor a location | No registry of what *should* exist, so nothing to diff an error against |
| Nested relations silently resolving to `undefined` | Does not know a property's declared type, so cannot derive or auto-register the nested pair |
| `forMember` selector and generic friction | Infers from selector lambdas rather than from the destination's shape |
| `reverseMap()` present in the predecessor, deleted in the rewrite | See below |

All five reduce to: **no schema ground truth.**

## Why `reverseMap()` was deleted rather than fixed

Reverse mapping is not a mirror operation. The read and write directions differ structurally:

| Field | Read direction | Write direction |
|---|---|---|
| `id`, `createdAt`, `updatedAt` | present in output | database-owned; must be rejected if supplied |
| `password` | never present | required, then transformed before persistence |
| `address` | expands into a nested DTO | accepts a foreign key scalar |
| absent field | indicates a defect | means "apply the database default" |

The `address` row is decisive. A read mapping expands a relation into an object; the write mapping accepts a scalar key. Automatically inverting the read mapping produces something that compiles, executes, returns an object, and is wrong — valid-looking and semantically broken. Without schema metadata the library cannot distinguish these cases, so every auto-reversed map is a guess. Removing the feature was the correct call given that information deficit.

## Why it is tractable here

Every field the reverse direction must treat differently is already flagged in ORM metadata:

- **TypeORM** — `column.isGenerated`, `isPrimary`, `isCreateDate`, `isUpdateDate`, `isDeleteDate`; `relation.joinColumns` yields the foreign key name
- **Prisma DMMF** — `field.isGenerated`, `isUpdatedAt`, `hasDefaultValue`, `relationFromFields`

Reverse mapping therefore stops being inference and becomes derivation. This is why `CAP-8` is scoped to **scalar fields only** for 2.0: the scalar case is a direct read of provenance flags, while the relation-to-foreign-key case is precisely the one that defeated the incumbent and is held at SHOULD tier (`scope-tiers.md`, item 14) rather than committed.

## Consequence for positioning

The product is not a mapper with a longer feature list. It is **the mapper that knows your schema**, and every committed capability is a consequence of that one property. This matters downstream: a proposed feature that does not derive from schema knowledge is probably out of position, and a capability that appears expensive is often cheap once descriptors exist — `CAP-4` and `CAP-6` in particular are near-free given `CAP-1`.
