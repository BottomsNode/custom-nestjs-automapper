import { DynamicModule, Global, Logger, Module, OnModuleInit, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Mapper, type ClassLike, type SchemaAdapter } from '@nestjs-automapper/core';
import { MAPPER } from './automapper.constants.js';
import { InjectMapper } from './automapper.decorators.js';
import { MapToInterceptor } from './map-to.interceptor.js';

export interface AutomapperModuleOptions {
  adapters: SchemaAdapter[];
  /** DTOs to plan at boot. */
  dtos?: ClassLike[];
  /** Register MapToInterceptor globally. Default true. */
  interceptor?: boolean;
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
    const providers: Provider[] = [
      {
        provide: MAPPER,
        useFactory: (): Mapper => {
          const mapper = new Mapper();
          for (const adapter of options.adapters) mapper.use(adapter);
          return mapper.register(...(options.dtos ?? []));
        },
      },
    ];

    if (options.interceptor !== false) {
      providers.push({ provide: APP_INTERCEPTOR, useClass: MapToInterceptor });
    }

    return { module: AutomapperModule, providers, exports: [MAPPER] };
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
