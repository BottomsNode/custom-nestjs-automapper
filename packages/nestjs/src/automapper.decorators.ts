import { Inject, SetMetadata } from '@nestjs/common';
import type { ClassLike } from '@nestjs-automapper/core';
import { MAP_TO, getMapperToken } from './automapper.constants.js';

/** Injects a Mapper — the default one, or the mapper registered under `name`. */
export const InjectMapper = (name?: string): ParameterDecorator => Inject(getMapperToken(name));

/**
 * Maps the handler's return value (an object, an array, or a promise of
 * either) to `dto`. `null` and `undefined` pass through unchanged. Applied by
 * the global `MapToInterceptor`.
 *
 * The interceptor maps without a context, so `visible()` fields come out
 * `undefined`, and async DTOs are not supported. For either, call
 * `mapper.map()` or `mapper.mapAsync()` in the handler instead.
 *
 * @example
 * ```ts
 * @Get()
 * @MapTo(UserDto)
 * findAll() {
 *   return this.users.findAll();
 * }
 * ```
 */
export const MapTo = (dto: ClassLike) => SetMetadata(MAP_TO, dto);
