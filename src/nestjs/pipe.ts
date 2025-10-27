import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import { Mapper } from '../core/mapper copy';

@Injectable()
export class AutoMapPipe implements PipeTransform {
    constructor(
        private mapper: Mapper,
        private destination: new () => any
    ) {}

    transform(value: any, _metadata: ArgumentMetadata): any {
        if (!value) return value;
        if (Array.isArray(value)) return this.mapper.mapArray(value, this.destination);
        return this.mapper.map(value, this.destination);
    }
}
