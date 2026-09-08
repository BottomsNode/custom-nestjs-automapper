import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { AutomapperError, Mapper, isWriteDto } from '@nestjs-automapper/core';
import { InjectMapper } from './automapper.decorators.js';

/**
 * Maps a request body to a `Write` DTO and rejects fields the client may not
 * supply — unknown keys, and anything the database owns.
 *
 * Reads the destination from `metadata.metatype`, so it works as a global pipe
 * with ordinary `@Body() dto: CreateUserDto` and needs no factory call at the
 * parameter, which is what keeps it injectable rather than a service locator.
 * Bodies whose type is not a `Write` DTO pass through untouched.
 */
@Injectable()
export class MapBodyPipe implements PipeTransform {
  constructor(@InjectMapper() private readonly mapper: Mapper) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const target = metadata.metatype;
    if (metadata.type !== 'body' || !target || !isWriteDto(target)) return value;

    try {
      return this.mapper.mapInput(value, target);
    } catch (error) {
      // A rejected body is the client's fault; everything else is ours.
      if (error instanceof AutomapperError && error.is('INPUT_FIELDS_REJECTED')) {
        throw new BadRequestException({
          message: 'Request contains fields that are not accepted',
          rejected: error.payload.rejected,
          accepted: error.payload.accepted,
        });
      }
      throw error;
    }
  }
}
