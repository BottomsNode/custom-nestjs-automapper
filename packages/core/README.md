# @nestjs-automapper/core

The mapping engine. Zero runtime dependencies.

You normally install an adapter and the NestJS integration rather than this
package directly — but everything here works standalone.

```bash
pnpm add @nestjs-automapper/core
```

## Why

Most mappers make you restate what your types already say, then fail quietly
when you forget. This one reads your schema, so it can check the mapping at
boot, tell you which columns a DTO actually needs, and refuse fields the
database owns.

## Defining a DTO

`Pick` and `extend` return real runtime classes — no decorators, no build
plugin.

```ts
import { Pick, extend, compute } from '@nestjs-automapper/core';

export class ReadUserDto extends extend(Pick(User, ['id', 'email', 'createdAt']), {
  fullName: compute(['firstName', 'lastName'], u => `${u.firstName} ${u.lastName}`),
}) {}
```

`fullName` is declared once. Its return type becomes the field's static type,
and its function becomes the runtime resolution.

> Use a class declaration, not `const X = extend(...)` plus
> `type X = InstanceType<typeof X>`. The self-referential alias makes
> TypeScript fall back to the key parameter's constraint, and the DTO silently
> regains every field of the source.

## Mapping

```ts
import { Mapper } from '@nestjs-automapper/core';

const mapper = new Mapper().use(adapter).register(ReadUserDto);
mapper.seal();                       // builds every plan; throws nothing, reports

mapper.map(row, ReadUserDto);
mapper.mapArray(rows, ReadUserDto);
await mapper.mapAsync(row, AvatarDto);
```

`map()` before `seal()` throws, and `register()` after it throws. Lazy
first-call planning is unreachable, so a broken mapping cannot reach a request.

## Resolvers

| | |
|---|---|
| `auto(name)` | copy by name |
| `from(path)` | rename, or read a nested path |
| `compute(deps, fn)` | derived value; `deps` are declared |
| `resolve(deps, asyncFn)` | async derived value |
| `constant(value)` | fixed value |
| `ignore()` | deliberately unmapped |
| `defaultTo(inner, fallback)` | substitute for `null`/`undefined`, and narrow the type |
| `visible(pred, inner)` | show only when the context predicate passes |
| `nested(() => Dto)` | to-one relation |
| `collection(() => Dto)` | to-many relation |

Dependencies are declared rather than inferred. A lambda is opaque: nothing
about `fullName` reveals that it needs `firstName` and `lastName`, so a
projector that guessed would under-fetch and the field would resolve to
`"undefined undefined"`.

Paths are typed, so a typo is a compile error — and TypeScript suggests the fix:

```ts
compute(['firstNmae'], …)   // Type '"firstNmae"' is not assignable to Path<User>.
                            // Did you mean '"firstName"'?
```

## Projection

Ask a DTO which columns it needs:

```ts
mapper.projectionFor(ReadUserDto);
// { fields: ['id','email','createdAt','firstName','lastName'], relations: {} }

mapper.nativeProjectionFor(ReadUserDto);   // your ORM's find options
```

`fields: []` means exactly none, never everything. A plan with context-gated
fields **throws** without a context rather than projecting the union — the
union silently over-fetches, which is the failure this exists to prevent.

## Write path

```ts
import { Write } from '@nestjs-automapper/core';

export class CreateUserDto extends Write(User, ['email', 'password']) {}

mapper.mapInput(body, CreateUserDto);
```

A write DTO declaring a database-owned field fails at `seal()`. A body carrying
one is rejected at runtime, listing what was refused and what is accepted —
mass-assignment protection derived from the schema.

`select: false` columns are deliberately *not* database-owned: `password` is
hidden on read and required on write.

## OpenAPI

```ts
mapper.schemaOf(ReadUserDto);                    // 3.0, `nullable: true`
mapper.schemaOf(ReadUserDto, { version: '3.1' }); // type union
```

Computed fields have no declaration site for `@ApiProperty`, so the schema is
generated instead. A nullable column is required and nullable; a gated field is
optional, because `undefined` never crosses the wire.

## Object graphs

`seal()` closes over the DTOs your relations reference, so nested pairs never
need registering by hand. Cycles terminate and shared references map once:

```ts
a.manager.manager === a     // the cycle closes
posts[0] === posts[1]       // one shared source, one mapped instance
```

Per-operation state is created per `map()` call and discarded on return.

## Type converters

```ts
new Mapper({ convert: { date: v => (v as Date).toISOString() } });
```

Every `date` field converted from one rule, none of them named. Only possible
because each node carries its declared type.

## Writing an adapter

```ts
interface SchemaAdapter {
  readonly name: string;
  supports(type: ClassLike): boolean;              // pure, must not throw
  describe(type: ClassLike): TypeDescriptor;       // everything, no policy
  toNativeProjection?(sel: FieldSelection, type: ClassLike): unknown;
}
```

`describe()` reports every field the schema declares and applies no filtering.
Policy belongs to the planner alone — an adapter that dropped `select: false`
columns would make `password` unmappable, and one with a private drop list
would leak a generated column.

Every provenance flag is required. `false` must mean "checked and no", never
"not looked at".

## License

MIT
