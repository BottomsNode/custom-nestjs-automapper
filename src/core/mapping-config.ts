import type { ClassType, MappingConfig } from './types';

export interface MappingOptions {
    defaultValues?: boolean;
    deepClone?: boolean;
}

export class MappingConfigurator {
    private configs = new Map<string, MappingConfig<any, any>>();

    register<S extends object, D extends object>(
        source: ClassType<S>,
        destination: ClassType<D>,
        config: MappingConfig<S, D>
    ) {
        const key = `${source.name}->${destination.name}`;
        this.configs.set(key, config);
    }

    get<S extends object, D extends object>(
        source: ClassType<S>,
        destination: ClassType<D>
    ): MappingConfig<S, D> | undefined {
        return this.configs.get(`${source.name}->${destination.name}`);
    }
}