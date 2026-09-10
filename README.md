# nestjs-automapper

**The object mapper that knows your schema.**

[![npm](https://img.shields.io/npm/v/@nestjs-automapper/core?label=%40nestjs-automapper%2Fcore)](https://www.npmjs.com/package/@nestjs-automapper/core)
[![CI](https://github.com/nishit-shivdasani/nestjs-automapper/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/nishit-shivdasani/nestjs-automapper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An object mapper for TypeScript and NestJS that reads your ORM's metadata.
Because it knows the schema, it can check every mapping when the app starts,
build the `SELECT` from the DTO, and refuse request fields the database owns.
A mapper without schema knowledge can't do any of these.

> **Upgrading from `custom-automapper` 1.x?** 2.0 is a rebuild under a new
> name. Read the [migration guide](docs/MIGRATION.md).
>
> This is an independent community project. It is not affiliated with NestJS
> or `@automapper`.

## Why use it

- **Mappings fail at boot, not in production.** An unresolved field or a bad
  dependency path stops `nest start` with the field, the source and a
  did-you-mean. `npx automapper check` gives CI the same guarantee.
- **You fetch only what you map.** The DTO decides which columns are selected
  and which relations are joined. A computed field fetches its declared
  sources.
- **Clients cannot set what they shouldn't.** A body carrying `id`,
  `createdAt`, or any field the write DTO doesn't declare gets a 400. The
  rules come from the schema, not from a hand-maintained list.
- **It writes your OpenAPI.** Computed fields have nowhere to put
  `@ApiProperty`, so the schema is generated from the DTO instead.
- **No decorators, no build plugin.** DTOs are plain classes derived from the
  entity. Nothing hooks into the TypeScript compiler.

## Install

```bash
npm install @nestjs-automapper/nestjs @nestjs-automapper/typeorm
```

`@nestjs-automapper/core` is installed with them.

| Requirement | Version |
|---|---|
| Node.js | ≥ 22.13 |
| NestJS (`@nestjs/common`, `@nestjs/core`) | ^12.0.1 |
| TypeORM | ^1.1.1 |
| `reflect-metadata` | ^0.2.2 |
| `rxjs` | ^7.8.0 |
| TypeScript | 6.x or 7.x, `strict` recommended |

All packages ship ESM and CommonJS builds.

## Quick start: a users API

This is a complete NestJS + TypeORM module: reading with projection, a nested
collection, and a protected create endpoint.

### Entities

Plain TypeORM. Nothing mapper-specific.

```ts
// users/user.entity.ts
import {
  Column, CreateDateColumn, Entity, OneToMany,
  PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn,
} from 'typeorm';
import { Post } from '../posts/post.entity';

export enum Role {
  Admin = 'admin',
  Member = 'member',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', unique: true }) email!: string;
  @Column({ type: 'varchar', select: false }) password!: string;
  @Column({ type: 'varchar' }) firstName!: string;
  @Column({ type: 'varchar' }) lastName!: string;
  @Column({ type: 'enum', enum: Role, default: Role.Member }) role!: Role;
  @Column({ type: 'varchar', nullable: true }) avatarUrl!: string | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
  @VersionColumn() version!: number;

  @OneToMany(() => Post, (post) => post.author) posts!: Post[];
}
```

```ts
// posts/post.entity.ts
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) title!: string;
  @Column({ type: 'text' }) body!: string;
  @CreateDateColumn() createdAt!: Date;

  @ManyToOne(() => User, (user) => user.posts) author!: User;
}
```

### DTOs

Derived from the entity, never restated. Each resolver declares a field once:
its return type becomes the field's type, and its function does the mapping.

```ts
// users/user.dto.ts
import { Pick, Write, collection, compute, defaultTo, extend, from } from '@nestjs-automapper/core';
import { Post } from '../posts/post.entity';
import { User } from './user.entity';

export class PostSummaryDto extends Pick(Post, ['id', 'title', 'createdAt']) {}

export class UserDto extends extend(Pick(User, ['id', 'email', 'role', 'createdAt']), {
  fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
  avatarUrl: defaultTo(from<User, string | null>('avatarUrl'), '/static/default-avatar.png'),
}) {}

export class UserWithPostsDto extends extend(Pick(User, ['id', 'email']), {
  posts: collection<User, PostSummaryDto>(() => PostSummaryDto),
}) {}

// The write side. `id`, `createdAt`, `updatedAt` and `version` are owned by
// the database — declaring any of them here fails the boot.
export class CreateUserDto extends Write(User, ['email', 'password', 'firstName', 'lastName']) {}
```

Resolvers take their source and output types explicitly (`compute<User, string>`).
Because of that, the dependency paths are type-checked: `['firstNmae']` is a
compile error that suggests `'firstName'`.

### Module

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomapperModule } from '@nestjs-automapper/nestjs';
import { typeorm } from '@nestjs-automapper/typeorm';
import { DataSource } from 'typeorm';
import { Post } from './posts/post.entity';
import { CreateUserDto, UserDto, UserWithPostsDto } from './users/user.dto';
import { User } from './users/user.entity';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [User, Post],
    }),
    TypeOrmModule.forFeature([User]),
    AutomapperModule.forRootAsync({
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => ({
        adapters: [typeorm(dataSource)],
        // Top-level DTOs only; PostSummaryDto is reached through `posts`.
        dtos: [UserDto, UserWithPostsDto, CreateUserDto],
      }),
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class AppModule {}
```

`forRootAsync` with `inject: [DataSource]` lets the adapter read TypeORM's
metadata after the connection exists. The mapper is sealed while the app
boots. `MapToInterceptor` and `MapBodyPipe` are registered globally.

### Service

```ts
// users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Mapper } from '@nestjs-automapper/core';
import { InjectMapper } from '@nestjs-automapper/nestjs';
import { hash } from 'bcrypt';
import { FindManyOptions, Repository } from 'typeorm';
import { CreateUserDto, UserDto, UserWithPostsDto } from './user.dto';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectMapper() private readonly mapper: Mapper,
  ) {}

  /** Selects only the columns UserDto reads. */
  findAll(): Promise<User[]> {
    const projection = this.mapper.nativeProjectionFor(UserDto) as FindManyOptions<User>;
    return this.users.find({ ...projection, order: { createdAt: 'DESC' } });
  }

  /** Joins `posts` and selects only the post columns PostSummaryDto reads. */
  async findWithPosts(id: string): Promise<User> {
    const projection = this.mapper.nativeProjectionFor(UserWithPostsDto) as FindManyOptions<User>;
    const user = await this.users.findOne({ ...projection, where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  /** `input` has already been checked: it carries exactly the four declared fields. */
  async create(input: CreateUserDto): Promise<User> {
    const user = this.users.create({ ...input, password: await hash(input.password, 12) });
    return this.users.save(user);
  }
}
```

### Controller

```ts
// users/users.controller.ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { MapTo } from '@nestjs-automapper/nestjs';
import { CreateUserDto, UserDto, UserWithPostsDto } from './user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @MapTo(UserDto)
  findAll() {
    return this.users.findAll();
  }

  @Get(':id/posts')
  @MapTo(UserWithPostsDto)
  findWithPosts(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findWithPosts(id);
  }

  @Post()
  @MapTo(UserDto)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }
}
```

`@MapTo` maps whatever the handler returns: an entity, an array, or a promise
of either. `password` never reaches the response because `UserDto` doesn't
declare it.

## What you get

### Only the columns you map

`nativeProjectionFor(UserDto)` returns:

```ts
{
  select: {
    id: true, email: true, role: true, createdAt: true,
    firstName: true, lastName: true,   // fullName's declared dependencies
    avatarUrl: true,
  },
}
```

That's a 7-column `SELECT`. `password`, `updatedAt` and `version` are never
read. For `UserWithPostsDto`, the adapter adds `relations: { posts: true }`
and selects only `posts.id`, `posts.title` and `posts.createdAt`. The primary
key is always included, because TypeORM needs it to hydrate rows.

### Broken mappings stop the boot

Say a resolver depends on something that isn't a column, like a getter you
added to the entity:

```ts
fullName: compute<User, string>(['displayName'], (u) => u.displayName),
```

The compiler accepts it, because `displayName` exists on the class. The mapper
rejects it, because TypeORM has no such column, and a projection could never
fetch it:

```text
ERROR [Automapper] DEP_UNKNOWN: resolver declares a dependency that does not exist on the source

  UserDto.fullName declares dep 'displayName'
  no such path on User
```

`nest start` exits before serving a single request. Each of the 12 error codes
renders what failed, why, and what to do next.

### Clients can't set what they shouldn't

```bash
curl -X POST localhost:3000/users -H 'content-type: application/json' \
  -d '{"email":"a@b.co","password":"s3cret!","firstName":"Ada","lastName":"L","role":"admin"}'
```

```json
{
  "message": "Request contains fields that are not accepted",
  "rejected": ["role"],
  "accepted": ["email", "password", "firstName", "lastName"]
}
```

The request fails with `400 Bad Request`. Unknown keys are rejected rather
than silently dropped. The same happens to database-owned keys, so a client
cannot write `id`, `createdAt` or `version` through any `Write` DTO.

`MapBodyPipe` checks which fields are present. It does not validate their
values, so keep using `class-validator`, `zod`, or your usual `ValidationPipe`
for formats and lengths.

## OpenAPI / Swagger

`schemaOf` needs a sealed mapper, and a sealed mapper exists only after boot.
Decorators run earlier, when the class is defined, so they can't call it.
Register the generated schemas on the document instead, and reference them:

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Mapper } from '@nestjs-automapper/core';
import { getMapperToken } from '@nestjs-automapper/nestjs';
import { AppModule } from './app.module';
import { UserDto } from './users/user.dto';

const app = await NestFactory.create(AppModule);
const mapper = app.get<Mapper>(getMapperToken());

const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Users API').build());
document.components = {
  ...document.components,
  schemas: { ...document.components?.schemas, UserDto: mapper.schemaOf(UserDto) as object },
};
SwaggerModule.setup('docs', app, document);

await app.listen(3000);
```

```ts
@Get()
@MapTo(UserDto)
@ApiOkResponse({ schema: { type: 'array', items: { $ref: '#/components/schemas/UserDto' } } })
findAll() { … }
```

`schemaOf(Dto, { version: '3.1' })` emits OpenAPI 3.1 type unions instead of
`nullable: true`.

## Checking mappings in CI

```bash
nest build
npx automapper check dist/app.module.js AppModule
```

This boots the application context, the same way `nest start` does, so it
validates exactly the mappings the running app would. It exits with code 1
and prints the diagnostics if any mapping is broken. Because it really boots
the app, TypeORM connects to the database, so give the CI job one (a service
container works).

## Without NestJS

`@nestjs-automapper/core` works on its own:

```ts
import { Mapper } from '@nestjs-automapper/core';
import { typeorm } from '@nestjs-automapper/typeorm';
import { FindManyOptions } from 'typeorm';

await dataSource.initialize();   // the adapter reads metadata at seal

const mapper = new Mapper().use(typeorm(dataSource)).register(UserDto, UserWithPostsDto);

const report = mapper.seal();
if (!report.ok) {
  for (const diagnostic of report.diagnostics) console.error(diagnostic.message);
  process.exit(1);
}

const rows = await dataSource
  .getRepository(User)
  .find(mapper.nativeProjectionFor(UserDto) as FindManyOptions<User>);

const users = mapper.mapArray(rows, UserDto);
```

## Prisma, Drizzle, and plain objects

A source with no runtime class is declared once with `defineSchema`. It still
gets projection, OpenAPI and the write rules. Schema tokens need no adapter.

```ts
import { Mapper, Pick, defineSchema, defaultTo, extend, from } from '@nestjs-automapper/core';

export const UserRecord = defineSchema('UserRecord', {
  id:        { type: 'string', isPrimary: true, isGenerated: true },
  email:     { type: 'string' },
  name:      { type: 'string', nullable: true },
  createdAt: { type: 'date', isCreateDate: true },
});
type UserRow = { id: string; email: string; name: string | null; createdAt: Date };

export class UserDto extends extend(Pick(UserRecord, ['id', 'email']), {
  displayName: defaultTo(from<UserRow, string | null>('name'), 'Anonymous'),
}) {}

const mapper = new Mapper().register(UserDto);
mapper.seal();

// Build Prisma's `select` from the DTO: { id: true, email: true, name: true }
const select = Object.fromEntries(mapper.projectionFor(UserDto).fields.map((f) => [f, true]));
const user = mapper.map(await prisma.user.findUniqueOrThrow({ where: { id }, select }), UserDto);
```

## API at a glance

### Declaring DTOs

| | |
|---|---|
| `Pick(Entity, keys)` | read DTO carrying a subset of the entity's fields |
| `Write(Entity, keys)` | write DTO. Database-owned fields are refused at boot and at the request boundary |
| `extend(Base, resolvers)` | add derived fields to a `Pick` or `Write` DTO |

### Resolvers

| | |
|---|---|
| `from<S, T>(path)` | rename, or read a nested path (`'address.city'`) |
| `compute<S, T>(deps, fn)` | derived value; `deps` are declared so projection can fetch them |
| `resolve<S, T>(deps, asyncFn)` | async derived value. The DTO becomes async, and `map()` on it is a type error |
| `defaultTo(inner, fallback)` | substitute for `null`/`undefined`, and narrow the type |
| `visible<S, T, false>(pred, inner)` | include only when the map-time context passes |
| `nested<S, Dto>(() => Dto)` | to-one relation |
| `collection<S, Dto>(() => Dto)` | to-many relation |
| `constant(value)` / `ignore()` / `auto<S, T>(name)` | fixed value / deliberately unmapped / copy by name |

### `Mapper`

| | |
|---|---|
| `use(adapter)` · `register(...dtos)` · `seal()` | declare, then seal. `seal()` returns `{ ok, pairs, diagnostics }` |
| `map` · `mapArray` · `mapAsync` · `mapArrayAsync` | map trusted data, such as ORM rows |
| `mapInput(body, WriteDto)` | map untrusted data, rejecting unknown and database-owned keys |
| `projectionFor(Dto)` · `nativeProjectionFor(Dto)` | neutral field selection · ORM find options |
| `schemaOf(Dto, { version })` | OpenAPI 3.0 / 3.1 schema |
| `reverseOf(Dto)` | writable fields, and why the others are refused |
| `new Mapper({ convert: { date: v => … } })` | one converter for every field of a type |

### NestJS

| | |
|---|---|
| `AutomapperModule.forRoot` · `forRootAsync` | `adapters`, `dtos`, `interceptor`, `bodyPipe`, `name` |
| `@InjectMapper(name?)` · `getMapperToken(name?)` | inject the default mapper or a named one |
| `@MapTo(Dto)` | map the handler's return value |
| `MapBodyPipe` | global; maps and checks `@Body()` parameters typed as `Write` DTOs |
| `automapper check <module> [Export]` | CI check |

Full details are in each package's README.

## Packages

| Package | |
|---|---|
| [`@nestjs-automapper/core`](packages/core) | Mapping engine. Zero runtime dependencies. |
| [`@nestjs-automapper/typeorm`](packages/typeorm) | TypeORM schema adapter |
| [`@nestjs-automapper/nestjs`](packages/nestjs) | Module, DI, interceptor, pipe, CLI |

The three are versioned together.

## Documentation

| | |
|---|---|
| [`CHANGELOG.md`](CHANGELOG.md) | release notes |
| [`docs/MIGRATION.md`](docs/MIGRATION.md) | upgrading from `custom-automapper` 1.x |
| [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) | comparison with every `@automapper/*` package, including what we left out and why |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | build history and what comes after 2.0 |
| [`docs/DESIGN.md`](docs/DESIGN.md) | design decisions |

## Development

```bash
pnpm install
pnpm verify   # typecheck on TypeScript 6 and 7, dual build, dependency invariants
```

Requires Node ≥ 22.13 and pnpm 12. Tests are kept local and are not
committed; see [`TESTING.md`](TESTING.md). Releases go through
[Changesets](.changeset/README.md): run `pnpm changeset` to record a change.

Builds use TypeScript 6.x through the `@typescript/typescript6` alias. The
TypeScript 7 native port ships no compiler API, which breaks `nest build`,
the Swagger CLI plugin and `ts-jest`. CI still type-checks the published
`.d.ts` files under 7.x, because consumers will be on it.

## License

[MIT](LICENSE) © Nishit Shivdasani
