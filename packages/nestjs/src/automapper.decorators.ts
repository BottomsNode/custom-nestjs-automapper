import { Inject, SetMetadata } from '@nestjs/common';
import type { ClassLike } from '@nestjs-automapper/core';
import { MAPPER, MAP_TO } from './automapper.constants.js';

/** Injects the shared Mapper. */
export const InjectMapper = (): ParameterDecorator => Inject(MAPPER);

/** Maps a handler's return value to `dto`. Applied by MapToInterceptor. */
export const MapTo = (dto: ClassLike) => SetMetadata(MAP_TO, dto);
