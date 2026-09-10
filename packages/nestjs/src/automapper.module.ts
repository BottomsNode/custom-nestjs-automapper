import {
  DynamicModule,
  Global,
  InjectionToken,
  Logger,
  Module,
  OptionalFactoryDependency,
  Provider,
  Type,
} from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Mapper, type ClassLike, type SchemaAdapter } from '@nestjs-automapper/core';
import { getMapperToken } from './automapper.constants.js';
import { MapToInterceptor } from './map-to.interceptor.js';
import { MapBodyPipe } from './map-body.pipe.js';

export interface AutomapperModuleOptions {
  /** Schema adapters, such as `typeorm(dataSource)`. When several describe a type, the first wins. */
  adapters: SchemaAdapter[];
  /** DTOs to plan at boot. Nested relations are closed over automatically. */
  dtos?: ClassLike[];
  /** Register MapToInterceptor globally. Default true. */
  interceptor?: boolean;
  /** Register MapBodyPipe globally. Default true. */
  bodyPipe?: boolean;
  /** Registers under a named token instead of the default one. */
  name?: string;
}

/** Supplies options from DI. Implement on a provider for `useClass`/`useExisting`. */
export interface AutomapperOptionsFactory {
  createAutomapperOptions(): AutomapperModuleOptions | Promise<AutomapperModuleOptions>;
}

/** Provide exactly one of `useFactory`, `useClass` or `useExisting`. */
export interface AutomapperModuleAsyncOptions {
  /** Registers under a named token instead of the default one. */
  name?: string;
  /** Modules exporting the providers listed in `inject`. */
  imports?: DynamicModule['imports'];
  /** Providers passed to `useFactory`, in order. */
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  /** Builds the options from the injected providers. */
  useFactory?: (...args: never[]) => AutomapperModuleOptions | Promise<AutomapperModuleOptions>;
  /** Instantiated by this module. */
  useClass?: Type<AutomapperOptionsFactory>;
  /** Already provided elsewhere; reused rather than instantiated again. */
  useExisting?: Type<AutomapperOptionsFactory>;
}

const OPTIONS = Symbol.for('@nestjs-automapper/options');
const logger = new Logger('Automapper');

/**
 * Seals the mapper at boot, so a broken mapping fails `nest start` rather than
 * the request that happens to hit it (AD-16).
 *
 * Sealing runs in a provider factory rather than the module's own lifecycle
 * hook, because the mapper's token varies per registration and a class
 * constructor cannot inject a token chosen at call time.
 */
@Global()
@Module({})
export class AutomapperModule {
  /**
   * Registers a global `Mapper`, and seals it while the app boots. A broken
   * mapping fails startup. Also registers `MapToInterceptor` and `MapBodyPipe`
   * globally, unless disabled.
   *
   * Use `forRootAsync` when an adapter needs a provider, such as TypeORM's
   * `DataSource`.
   *
   * @example
   * ```ts
   * AutomapperModule.forRoot({ adapters: [typeorm(dataSource)], dtos: [UserDto] });
   * ```
   */
  static forRoot(options: AutomapperModuleOptions): DynamicModule {
    const token = getMapperToken(options.name);
    return {
      module: AutomapperModule,
      providers: [
        { provide: token, useFactory: () => build(options) },
        sealer(token),
        ...globals(options),
      ],
      exports: [token],
    };
  }

  /**
   * Like `forRoot`, with the options resolved from DI.
   *
   * `MapToInterceptor` and `MapBodyPipe` are always registered here, because
   * the options are not known until the factory runs. Both do nothing on
   * routes that don't use them.
   *
   * @example
   * ```ts
   * AutomapperModule.forRootAsync({
   *   inject: [DataSource],
   *   useFactory: (dataSource: DataSource) => ({
   *     adapters: [typeorm(dataSource)],
   *     dtos: [UserDto, CreateUserDto],
   *   }),
   * });
   * ```
   */
  static forRootAsync(options: AutomapperModuleAsyncOptions): DynamicModule {
    const token = getMapperToken(options.name);
    return {
      module: AutomapperModule,
      imports: options.imports ?? [],
      providers: [
        ...optionsProviders(options),
        {
          provide: token,
          useFactory: (resolved: AutomapperModuleOptions) => build(resolved),
          inject: [OPTIONS],
        },
        sealer(token),
        // Unconditional here: the flags live in options, which are not known
        // until the factory runs. Both no-op when unused.
        { provide: APP_INTERCEPTOR, useClass: MapToInterceptor },
        { provide: APP_PIPE, useClass: MapBodyPipe },
      ],
      exports: [token],
    };
  }
}

/** One of useFactory / useClass / useExisting, resolved to the OPTIONS token. */
function optionsProviders(options: AutomapperModuleAsyncOptions): Provider[] {
  if (options.useFactory) {
    return [{ provide: OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] }];
  }

  const factoryClass = options.useExisting ?? options.useClass;
  if (!factoryClass) {
    throw new Error('AutomapperModule.forRootAsync requires useFactory, useClass, or useExisting');
  }

  return [
    // useExisting reuses a provider the app already registered; useClass is
    // instantiated here, so only that case needs its own provider entry.
    ...(options.useClass ? [{ provide: options.useClass, useClass: options.useClass }] : []),
    {
      provide: OPTIONS,
      useFactory: (factory: AutomapperOptionsFactory) => factory.createAutomapperOptions(),
      inject: [factoryClass],
    },
  ];
}

function build(options: AutomapperModuleOptions): Mapper {
  const mapper = new Mapper();
  for (const adapter of options.adapters) mapper.use(adapter);
  return mapper.register(...(options.dtos ?? []));
}

/** Eager provider whose only job is to seal, and to fail the boot if it cannot. */
function sealer(token: symbol): Provider {
  return {
    provide: Symbol(`@nestjs-automapper/seal:${String(token.description)}`),
    inject: [token],
    useFactory: (mapper: Mapper) => {
      if (mapper.isSealed()) return true;

      const report = mapper.seal();
      if (report.ok) {
        logger.log(`sealed ${report.pairs.length} mapping(s)`);
        return true;
      }
      for (const diagnostic of report.diagnostics) logger.error(diagnostic.message);
      throw report.diagnostics[0];
    },
  };
}

function globals(options: AutomapperModuleOptions): Provider[] {
  const providers: Provider[] = [];
  if (options.interceptor !== false) {
    providers.push({ provide: APP_INTERCEPTOR, useClass: MapToInterceptor });
  }
  if (options.bodyPipe !== false) {
    providers.push({ provide: APP_PIPE, useClass: MapBodyPipe });
  }
  return providers;
}
