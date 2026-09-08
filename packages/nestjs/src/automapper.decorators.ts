import { Inject, SetMetadata } from '@nestjs/common';
import type { ClassLike } from '@nestjs-automapper/core';
import { MAP_TO, getMapperToken } from './automapper.constants.js';

/** Injects a Mapper — the default one, or the mapper registered under `name`. */
export const InjectMapper = (name?: string): ParameterDecorator => Inject(getMapperToken(name));

/** Maps a handler's return value to `dto`. Applied by MapToInterceptor. */
export const MapTo = (dto: ClassLike) => SetMetadata(MAP_TO, dto);
