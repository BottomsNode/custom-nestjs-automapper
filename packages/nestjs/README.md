# @nestjs-automapper/nestjs

NestJS integration: module, DI, response mapping, request-body mapping, and a
CI check.

```bash
pnpm add @nestjs-automapper/nestjs @nestjs-automapper/typeorm
```

Peers: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `rxjs`.

## Setup

```ts
@Module({
  imports: [
    AutomapperModule.forRoot({
      adapters: [typeorm(dataSource)],
      dtos: [ReadUserDto, CreateUserDto],
    }),
  ],
})
export class AppModule {}
```

The mapper seals at boot. A DTO with an unresolved field **fails `nest start`**
with the field, the source, the adapter, and a did-you-mean — not the request
that happens to hit it.

Nested relations are closed over automatically, so only top-level DTOs go in
`dtos`.

### Async configuration

With `@nestjs/typeorm`, inject the `DataSource` so the adapter reads metadata
from the live connection:

```ts
AutomapperModule.forRootAsync({
  inject: [DataSource],
  useFactory: (dataSource: DataSource) => ({
    adapters: [typeorm(dataSource)],
    dtos: [ReadUserDto, CreateUserDto],
  }),
});
```

`useClass` and `useExisting` also work, via `AutomapperOptionsFactory`.

## Reading

```ts
@Controller('users')
export class UsersController {
  constructor(@InjectMapper() private readonly mapper: Mapper) {}

  @Get()
  @MapTo(ReadUserDto)
  findAll() {
    return this.repo.find(this.mapper.nativeProjectionFor(ReadUserDto) as FindManyOptions<User>);
  }
}
```

`@MapTo` maps the handler's return value — single object or array. Routes
without it pass through untouched.

## Writing

```ts
export class CreateUserDto extends Write(User, ['email', 'password']) {}

@Post()
create(@Body() dto: CreateUserDto) {
  return this.service.create(dto);
}
```

Plain `@Body()`. `MapBodyPipe` is registered globally and reads the parameter's
type, so there is no factory call at the parameter and no service locator.

A client sending `id` or `createdAt` gets a **400** naming what was rejected and
what is accepted. `@automapper/nestjs`'s `MapPipe` maps whatever it is handed;
this knows which fields the client may not supply, because it read the schema.

Bodies whose type is not a `Write` DTO are left alone.

## CI

```bash
npx automapper check dist/app.module.js
```

Boots the application context, so CI validates the same pair set the running
app seals. Exit code 1 with the diagnostics if anything is unresolved.

## Multiple mappers

```ts
AutomapperModule.forRoot({ name: 'tenant-a', adapters: [...] });

constructor(@InjectMapper('tenant-a') private readonly mapper: Mapper) {}
```

## Swagger

Computed fields have no declaration site for `@ApiProperty`, so generate the
schema instead. The mapper is sealed during boot, after decorators have run,
so register the schema on the document in `main.ts` and reference it:

```ts
const mapper = app.get<Mapper>(getMapperToken());
const document = SwaggerModule.createDocument(app, config);
document.components = {
  ...document.components,
  schemas: { ...document.components?.schemas, ReadUserDto: mapper.schemaOf(ReadUserDto) as object },
};
SwaggerModule.setup('docs', app, document);
```

```ts
@ApiOkResponse({ schema: { $ref: '#/components/schemas/ReadUserDto' } })
```

## Options

| | |
|---|---|
| `adapters` | schema adapters, in arbitration order |
| `dtos` | top-level DTOs to plan |
| `interceptor` | register `MapToInterceptor` globally. Default `true` |
| `bodyPipe` | register `MapBodyPipe` globally. Default `true` |
| `name` | register under a named token |

## License

MIT
