# @nestjs-automapper/typeorm

TypeORM schema adapter. Lets a DTO derive its own `select` and `relations`.

```bash
pnpm add @nestjs-automapper/typeorm
```

Peer: `typeorm` ^1.1.1.

## Usage

```ts
import { typeorm } from '@nestjs-automapper/typeorm';

const mapper = new Mapper().use(typeorm(dataSource));
```

That is the whole setup. Entities need no mapping decorators — the adapter
reads the metadata TypeORM already has.

## Projection

```ts
const find = mapper.nativeProjectionFor(ReadUserDto) as FindManyOptions<User>;
// { select: { id: true, email: true, firstName: true, lastName: true } }

await repo.find(find);
```

A twenty-column entity behind a five-field DTO issues a five-column `SELECT`.
Relations the DTO never touches are not joined.

The primary key is added even when the DTO omits it — TypeORM needs it to
hydrate relations and dedupe rows. That happens here rather than in `core`, so
the neutral selection keeps reporting only what the DTO consumes.

## What it reads

| TypeORM | Used for |
|---|---|
| `column.propertyName` | the field name, verbatim |
| `column.databaseName` | translation and did-you-mean only |
| `column.type`, `enum` | JSON/OpenAPI types and enum values |
| `isNullable` | nullability, and OpenAPI `required` |
| `isPrimary`, `isGenerated` | write drop list, projection keys |
| `isCreateDate`, `isUpdateDate`, `isDeleteDate` | write drop list |
| `isVersion`, `isDiscriminator` | write drop list |
| `isSelect` | hidden on read — **not** a write drop reason |
| `relation.joinColumns`, `relationType` | relations and foreign keys |

`isSelect: false` is the `password` case: excluded from implicit expansion,
still nameable, and always writable. Treating it as database-owned would make
it impossible to ever set one.

## Notes

- `describe()` returns everything the schema declares and applies no policy.
  Filtering is the planner's job.
- `supports()` never throws, so adapter arbitration stays predictable.
- Entity schemas defined as plain objects (rather than classes) are not
  supported; relations need a class target.
- A `string | null` column needs an explicit `type` — TypeScript reflects the
  union as `Object`, which TypeORM cannot map. That is true of TypeORM
  generally, not something this adapter adds.

## License

MIT
