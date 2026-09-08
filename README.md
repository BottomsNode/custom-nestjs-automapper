# @nestjs-automapper

The mapper that knows your schema.

An object mapper for TypeScript and NestJS that reads your ORM's metadata, so
it can do things a mapper without schema knowledge structurally cannot: check
every mapping at boot, derive the `SELECT` from the DTO, and refuse fields the
database owns.

> **Status: 2.0 in development.** The engine is complete and tested; the
> packages are not published yet. An independent community project, not
> affiliated with NestJS or `@automapper`.

```bash
pnpm add @nestjs-automapper/nestjs @nestjs-automapper/typeorm
```

| Package | What it is |
|---|---|
| [`@nestjs-automapper/core`](packages/core) | The engine. Zero dependencies. |
| [`@nestjs-automapper/typeorm`](packages/typeorm) | TypeORM schema adapter |
| [`@nestjs-automapper/nestjs`](packages/nestjs) | Module, DI, interceptor, pipe, CLI |

## The whole read path

```ts
// app.module.ts
AutomapperModule.forRoot({
  adapters: [typeorm(dataSource)],
  dtos: [ReadUserDto],
});

// user.dto.ts — no decorators, no transformer plugin
export class ReadUserDto extends extend(Pick(User, ['id', 'email', 'createdAt']), {
  fullName: compute(['firstName', 'lastName'], u => `${u.firstName} ${u.lastName}`),
}) {}

// user.controller.ts
@Get()
@MapTo(ReadUserDto)
findAll() {
  return this.repo.find(this.mapper.nativeProjectionFor(ReadUserDto));
}
```

Twenty-column entity, five-field DTO, five-column `SELECT`.

## What it does that `@automapper` does not

**Projection push-down.** The DTO decides which columns are fetched. Declared
dependencies mean a computed field projects its *sources*, not its own name.

**Boot-time validation.** An unresolved field fails `nest start`, with the
field, the source, the adapter, and a did-you-mean. `npx automapper check`
gives the same guarantee in CI.

**Mass-assignment protection.** A `Write` DTO declaring `id` fails at boot; a
request body carrying it gets a 400. Both derived from schema flags, not a
hand-maintained list.

**No transformer plugin.** `@automapper/classes` needs one, and it is a
TypeScript compiler-API consumer. Nothing here requires a build plugin.

**Reverse mapping.** Deleted from the incumbent because it had no schema to
read. Database-owned fields come off the write side automatically —
`select: false` columns deliberately do not, since that is `password`.

**OpenAPI from the descriptor.** Computed fields have nowhere to hang
`@ApiProperty`, so the schema is generated instead.

**Type-level guarantees.** Mistyped dependency paths, unpicked fields, and
synchronously mapping an async DTO are all compile errors.

Full comparison, including what we deliberately refused and why:
[`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md).

## Documentation

| | |
|---|---|
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phase-by-phase status and parity matrix |
| [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) | Coverage against every `@automapper` package |
| `_bmad-output/specs/` | The capability contract (CAP-1…CAP-10) |
| `_bmad-output/planning-artifacts/` | Architecture spine (AD-1…AD-20) and its reviews |

## Development

```bash
pnpm install
pnpm verify        # typecheck on both TS lines, build, dependency invariants
```

Tests are kept local and are not committed — see [`TESTING.md`](TESTING.md).

Requires Node ≥ 22.13 and pnpm 12.

Emit runs on the TypeScript 6.x line via the `@typescript/typescript6` alias;
7.0 is the native port and ships no compiler API, which breaks `nest build`,
the Swagger CLI plugin, and `ts-jest`. CI type-checks the published `.d.ts`
under 7.x as well, because consumers will be there.

## About v1

v1 shipped a decorator pipeline that never executed: metadata was written to
`prototype + propertyKey` and read from the constructor, so the whole
decorator-driven branch was dead code. It is preserved on the `v1-archive`
branch. 2.0 is a rebuild and is not source-compatible.

## License

MIT
