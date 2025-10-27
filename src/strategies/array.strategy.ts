import type { Mapper } from '../core/mapper copy';

export class ArrayMappingStrategy {
    constructor(private mapper: Mapper) {}

    mapArray<S extends object, D extends object>(
        sourceArray: S[],
        destinationClass: new () => D
    ): D[] {
        return sourceArray.map(item => this.mapper.map(item, destinationClass));
    }

    async mapArrayAsync<S extends object, D extends object>(
        sourceArray: S[],
        destinationClass: new () => D
    ): Promise<D[]> {
        return Promise.all(sourceArray.map(item => this.mapper.mapAsync(item, destinationClass)));
    }
}
