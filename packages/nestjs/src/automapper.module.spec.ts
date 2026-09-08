import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Mapper,
  NO_PROVENANCE,
  Pick,
  compute,
  extend,
  from,
  type ClassLike,
  type SchemaAdapter,
  type TypeDescriptor,
} from '@nestjs-automapper/core';
import { AutomapperModule } from './automapper.module.js';
import { MAPPER, MAP_TO } from './automapper.constants.js';
import { MapTo } from './automapper.decorators.js';

class User {
  id!: string;
  email!: string;
  firstName!: string;
  lastName!: string;
}

const adapter: SchemaAdapter = {
  name: 'fake',
  supports: (t) => t === User,
  describe: (): TypeDescriptor => ({
    type: User,
    fields: ['id', 'email', 'firstName', 'lastName'].map((name) => ({
      name,
      type: 'string' as const,
      nullable: false,
      provenance: NO_PROVENANCE,
    })),
    relations: [],
    producedBy: 'fake',
  }),
};

class ReadUserDto extends extend(Pick(User, ['id', 'email']), {
  fullName: compute<User, string>(['firstName', 'lastName'], (u) => `${u.firstName} ${u.lastName}`),
}) {}

const boot = (dtos: ClassLike[]) =>
  Test.createTestingModule({
    imports: [AutomapperModule.forRoot({ adapters: [adapter], dtos, interceptor: false })],
  }).compile();

describe('AutomapperModule', () => {
  it('provides an injectable Mapper', async () => {
    const app = await boot([ReadUserDto]);
    expect(app.get<Mapper>(MAPPER)).toBeInstanceOf(Mapper);
  });

  it('seals on init so mapping works without an explicit seal call', async () => {
    const app = await boot([ReadUserDto]);
    await app.init();

    const mapper = app.get<Mapper>(MAPPER);
    expect(mapper.isSealed()).toBe(true);
    expect(mapper.map({ id: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B' }, ReadUserDto)).toMatchObject(
      { id: 'u1', fullName: 'A B' },
    );
  });

  it('fails boot on an unresolved mapping (CAP-3)', async () => {
    class Broken extends extend(Pick(User, ['id']), {
      bad: from<User, string>('nope' as never),
    }) {}

    // Sealing runs when the provider is instantiated, so the failure lands
    // during module construction — earlier than the first request, which is
    // the whole point of CAP-3.
    await expect(boot([Broken])).rejects.toThrow(/DEP_UNKNOWN/);
  });

  it('is a no-op on a second init', async () => {
    const app = await boot([ReadUserDto]);
    await app.init();
    await expect(app.init()).resolves.toBeDefined();
  });
});

describe('@MapTo', () => {
  it('records the destination on the handler', () => {
    @Controller()
    class UsersController {
      @Get()
      @MapTo(ReadUserDto)
      findAll(): User[] {
        return [];
      }
    }

    expect(Reflect.getMetadata(MAP_TO, UsersController.prototype.findAll)).toBe(ReadUserDto);
  });
});

describe('named mappers', () => {
  it('registers under a named token and leaves the default free', async () => {
    const { getMapperToken } = await import('./automapper.constants.js');
    const app = await Test.createTestingModule({
      imports: [
        AutomapperModule.forRoot({
          adapters: [adapter],
          dtos: [ReadUserDto],
          name: 'tenant-a',
          interceptor: false,
          bodyPipe: false,
        }),
      ],
    }).compile();

    expect(app.get<Mapper>(getMapperToken('tenant-a'))).toBeInstanceOf(Mapper);
    expect(getMapperToken('tenant-a')).not.toBe(getMapperToken());
  });
});

describe('forRootAsync', () => {
  it('resolves options through an imported provider', async () => {
    const CONFIG = 'AUTOMAPPER_TEST_CONFIG';

    @Module({
      providers: [{ provide: CONFIG, useValue: { dtos: [ReadUserDto] } }],
      exports: [CONFIG],
    })
    class ConfigModule {}

    const app = await Test.createTestingModule({
      imports: [
        AutomapperModule.forRootAsync({
          imports: [ConfigModule],
          inject: [CONFIG],
          useFactory: ((cfg: { dtos: ClassLike[] }) => ({
            adapters: [adapter],
            dtos: cfg.dtos,
            interceptor: false,
            bodyPipe: false,
          })) as never,
        }),
      ],
    }).compile();

    await app.init();
    expect(app.get<Mapper>(MAPPER).isSealed()).toBe(true);
  });
});
