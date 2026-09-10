# Migrating from `custom-automapper` 1.x to 2.0

2.0 is a rebuild, not an upgrade. The package name, the API, and the model are
all different, so there is no codemod. This guide maps every 1.x concept to its
replacement.

## Why the change

1.x's decorator pipeline never ran. Metadata was written to
`prototype + propertyKey` and read from the constructor, so decorator-driven
mappings produced `{}`. Fixing that would still have left a mapper with no
knowledge of your schema. 2.0 reads the schema from your ORM instead, which is
what makes boot-time validation, projection and mass-assignment protection
possible.

## 1. Swap the packages

```bash
npm uninstall custom-automapper
npm install @nestjs-automapper/nestjs @nestjs-automapper/typeorm
```

| | 1.x | 2.0 |
|---|---|---|
| Node.js | ≥ 16 | **≥ 22.13** |
| NestJS | ^10 or ^11 | **^12.0.1** |
| TypeORM | — | ^1.1.1 (for the adapter) |
| Module format | CommonJS | ESM + CommonJS |

## 2. The model in one paragraph

In 1.x you described the destination with decorators and then registered a
`createMap(Source, Destination, config)`. In 2.0 the DTO *is* the mapping. You
derive it from the entity with `Pick`, add computed fields with `extend`, and
the mapper checks every DTO against the ORM schema once, at `seal()`.
`AutomapperModule` seals for you when the app starts.

## 3. Before and after

**1.x**

```ts
class UserDTO {
  @AutoMap() id: number;
  @AutoMap() name: string;
  @AutoMap() email: string;
}

const mapper = new Mapper({ cache: { enabled: true } });
mapper.createMap(UserEntity, UserDTO, {
  name: (src) => src.fullName,
});

const dto = mapper.map(entity, UserDTO);
```

**2.0, with a TypeORM entity**

```ts
import { Mapper, Pick, extend, from } from '@nestjs-automapper/core';
import { typeorm } from '@nestjs-automapper/typeorm';

export class UserDto extends extend(Pick(UserEntity, ['id', 'email']), {
  name: from<UserEntity, string>('fullName'),
}) {}

const mapper = new Mapper().use(typeorm(dataSource)).register(UserDto);
mapper.seal();

const dto = mapper.map(entity, UserDto);
```

**2.0, with a plain object and no ORM**

The mapper needs a schema. If the source is not an ORM entity, declare one:

```ts
import { Mapper, Pick, defineSchema, extend, from } from '@nestjs-automapper/core';

const UserEntity = defineSchema('UserEntity', {
  id:       { type: 'number', isPrimary: true },
  fullName: { type: 'string' },
  email:    { type: 'string' },
});
type UserRow = { id: number; fullName: string; email: string };

export class UserDto extends extend(Pick(UserEntity, ['id', 'email']), {
  name: from<UserRow, string>('fullName'),
}) {}

const mapper = new Mapper().register(UserDto);   // schema tokens need no adapter
mapper.seal();
```

## 4. API mapping

### Core

| 1.x | 2.0 |
|---|---|
| `new Mapper(options)` | `new Mapper({ convert })`, then `.use(adapter)` for each ORM |
| `createMap(Src, Dest, config)` | declare the DTO with `Pick` / `extend`, then `register(Dto)` and `seal()` |
| `@AutoMap()` on each property | list the field in `Pick(Entity, [...])` |
| `@AutoMap(() => Nested)`, `@MapNested` | `nested<Src, NestedDto>(() => NestedDto)` |
| array of nested objects | `collection<Src, ItemDto>(() => ItemDto)` |
| `mapFrom('key')`, `@MapProperty` | `from<Src, T>('key')`, including nested paths (`'address.city'`) |
| `mapFrom(src => …)`, `transform`, `@Transform`, `concat`, `compute` | `compute<Src, T>(['dep', …], src => …)`. Dependencies are declared, so projection fetches them |
| async `mapFrom` | `resolve<Src, T>(['dep'], async src => …)`, then `mapAsync` |
| `ignore()`, `@Ignore` | `ignore()` |
| `nullToDefault`, `@Default` | `defaultTo(inner, fallback)` |
| `formatDate`, `@DateFormat` | `new Mapper({ convert: { date: v => … } })` for every date, or `compute` for one field |
| `condition`, `mapConditional` | `compute` with a branch, or `visible(pred, inner)` to gate on map-time context |
| `createReverseMap` | `Write(Entity, [...])` plus `mapInput(body, WriteDto)`. Database-owned fields are refused |
| `map` · `mapArray` · `mapAsync` · `mapArrayAsync` | same names; the mapper must be sealed first |
| `mapWithMetadata` | `seal()` returns `{ ok, pairs, diagnostics }`; `planOf(Dto)` and `sourceOf(Dto)` for introspection |
| `getMappings()` | `seal().pairs` |
| `clear()` | none. A mapper is immutable once sealed; build a new one |
| `cache` options, `setCacheEnabled` | none. Each mapping compiles to one function at seal |
| `addValidation`, `@Validate`, `validate` | none. Use `class-validator`, `zod`, or a `ValidationPipe` |
| `MappingProfile`, `@MapProfile`, `@Mappable` | none. The DTO class is the profile |
| `convertNamingConvention` | none. Property names come from the ORM verbatim |
| `deepClone` | `structuredClone` (built into Node) |
| `getPropertyByPath` / `setPropertyByPath` | `from('a.b.c')` for reading; no setter |
| `ArrayMappingStrategy` | `collection()` or `mapArray()` |
| `EnumMappingStrategy` | enums come from the schema (`enum` columns) and appear in OpenAPI |
| `PolymorphicMappingStrategy` | no equivalent in 2.0 |

### NestJS

| 1.x | 2.0 |
|---|---|
| `AutomapperModule` | `AutomapperModule.forRoot({ adapters, dtos })` or `forRootAsync(...)` |
| `@UseMapper`, injecting the mapper | `@InjectMapper()`, or `@InjectMapper('name')` for named mappers |
| `@MapTo`, `@MapFrom`, `AutoMapInterceptor` | `@MapTo(Dto)`; `MapToInterceptor` is registered globally |
| `@MapBody`, `AutoMapPipe` | plain `@Body() dto: CreateUserDto`, where the DTO is a `Write` DTO; `MapBodyPipe` is global |
| `@MapQuery` | no equivalent. Parse query parameters with Nest's pipes |

## 5. Behaviour you will notice

- **Mapping before `seal()` throws.** So does `register()` after it. With
  `AutomapperModule` you never call `seal()` yourself.
- **Nothing is mapped implicitly.** A DTO field comes from `Pick` or from an
  explicit resolver. A field with neither fails the boot.
- **Unknown request keys are rejected.** `MapBodyPipe` returns a 400 for any
  key the `Write` DTO does not declare. 1.x ignored them.
- **`select: false` columns are hidden on read but writable.** `password`
  belongs in `Write(User, ['email', 'password'])`, not in read DTOs.
- **Resolvers take explicit generics.** Write `compute<User, string>(…)`, not
  `compute(…)`. That's what makes the dependency paths type-checked.

## 6. Checklist

1. Swap the packages, and upgrade Node.js and NestJS if needed.
2. Replace each `@AutoMap` class and `createMap` call with a `Pick` / `extend` DTO.
3. Replace request-body mapping with `Write` DTOs.
4. Register the adapter and the top-level DTOs in `AutomapperModule`.
5. Replace hand-written `select` lists with `mapper.nativeProjectionFor(Dto)`.
6. Start the app. Any mapping that doesn't resolve is reported at boot, with a did-you-mean.
7. Add `npx automapper check dist/app.module.js` to CI.
