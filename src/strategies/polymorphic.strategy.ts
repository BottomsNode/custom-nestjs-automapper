import type { Mapper } from '../core/mapper';

export class PolymorphicMappingStrategy {
    constructor(private mapper: Mapper) {}

    mapPolymorphic<S extends object, D extends object>(
        source: S,
        destinationClass: new () => D,
        typeDiscriminator: (src: S) => new () => D
    ): D {
        const actualClass = typeDiscriminator(source) || destinationClass;
        return this.mapper.map(source, actualClass);
    }

    async mapPolymorphicAsync<S extends object, D extends object>(
        source: S,
        destinationClass: new () => D,
        typeDiscriminator: (src: S) => new () => D
    ): Promise<D> {
        const actualClass = typeDiscriminator(source) || destinationClass;
        return this.mapper.mapAsync(source, actualClass);
    }
}
