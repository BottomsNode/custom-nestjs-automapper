import {
  DynamicModule,
  Global,
  InjectionToken,
  Logger,
  Module,
  OnModuleInit,
  OptionalFactoryDependency,
  Provider,
} from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Mapper, type ClassLike, type SchemaAdapter } from '@nestjs-automapper/core';
import { MAPPER } from './automapper.constants.js';
import { InjectMapper } from './automapper.decorators.js';
import { MapToInterceptor } from './map-to.interceptor.js';
import { MapBodyPipe } from './map-body.pipe.js';

export interface AutomapperModuleOptions {
  adapters: SchemaAdapter[];
  /** DTOs to plan at boot. */
  dtos?: ClassLike[];
  /** Register MapToInterceptor globally. Default true. */
  interceptor?: boolean;
  /** Register MapBodyPipe globally. Default true. */
  bodyPipe?: boolean;
}

export interface AutomapperModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: never[]) => AutomapperModuleOptions | Promise<AutomapperModuleOptions>;
}

const OPTIONS = Symbol.for('@nestjs-automapper/options');

function build(options: AutomapperModuleOptions): Mapper {
  const mapper = new Mapper();
  for (const adapter of options.adapters) mapper.use(adapter);
  return mapper.register(...(options.dtos ?? []));
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

/**
 * Seals the mapper on init, so a broken mapping fails `nest start` rather than
 * the request that happens to hit it (AD-16). Only this module and the CLI
 * turn diagnostics into a failure — `core` never decides process lifetime.
 */
@Global()
@Module({})
export class AutomapperModule implements OnModuleInit {
  private static readonly logger = new Logger('Automapper');

  constructor(@InjectMapper() private readonly mapper: Mapper) {}

  static forRoot(options: AutomapperModuleOptions): DynamicModule {
    return {
      module: AutomapperModule,
      providers: [
        { provide: MAPPER, useFactory: () => build(options) },
        ...globals(options),
      ],
      exports: [MAPPER],
    };
  }

  /** Same, with options resolved from DI — typically ConfigService. */
  static forRootAsync(async: AutomapperModuleAsyncOptions): DynamicModule {
    return {
      module: AutomapperModule,
      imports: async.imports ?? [],
      providers: [
        { provide: OPTIONS, useFactory: async.useFactory, inject: async.inject ?? [] },
        {
          provide: MAPPER,
          useFactory: (options: AutomapperModuleOptions) => build(options),
          inject: [OPTIONS],
        },
        // Registered unconditionally: the flags live in options, which are not
        // known until the factory runs, and both no-op when unused.
        { provide: APP_INTERCEPTOR, useClass: MapToInterceptor },
        { provide: APP_PIPE, useClass: MapBodyPipe },
      ],
      exports: [MAPPER],
    };
  }

  onModuleInit(): void {
    if (this.mapper.isSealed()) return;

    const report = this.mapper.seal();
    if (report.ok) {
      AutomapperModule.logger.log(`sealed ${report.pairs.length} mapping(s)`);
      return;
    }

    for (const diagnostic of report.diagnostics) {
      AutomapperModule.logger.error(diagnostic.message);
    }
    throw report.diagnostics[0];
  }
}
