import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ClassLike, Mapper } from '@nestjs-automapper/core';
import { Observable, map } from 'rxjs';
import { MAP_TO } from './automapper.constants.js';
import { InjectMapper } from './automapper.decorators.js';

/**
 * Maps handler results for routes marked with `@MapTo`. Registered globally by
 * AutomapperModule, so an unmarked route passes through untouched.
 */
@Injectable()
export class MapToInterceptor implements NestInterceptor {
  constructor(
    @InjectMapper() private readonly mapper: Mapper,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const dto = this.reflector.getAllAndOverride<ClassLike | undefined>(MAP_TO, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!dto) return next.handle();

    return next.handle().pipe(
      map((value) =>
        value == null
          ? value
          : Array.isArray(value)
            ? this.mapper.mapArray(value, dto)
            : this.mapper.map(value, dto),
      ),
    );
  }
}
