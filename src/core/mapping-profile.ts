import type { Mapper } from './mapper';
import type { ClassType, MappingConfig, MappingEntryOptions } from './types';

export class MappingBuilder<S extends object, D extends object> {
    private config: MappingConfig<S, D> = {};
    private options: MappingEntryOptions = {};

    constructor(
        private mapper: Mapper,
        private source: ClassType<S>,
        private destination: ClassType<D>
    ) {}

    forMember<K extends keyof D>(
        destinationKey: K,
        mapperFn: (source: S) => D[K]
    ): this {
        this.config[destinationKey] = mapperFn as any;
        return this;
    }

    forPath<K extends keyof D>(
        destinationKey: K,
        sourcePath: string
    ): this {
        this.config[destinationKey] = ((source: S) => {
            const path = sourcePath.split('.');
            let value: any = source;
            for (const key of path) {
                value = value?.[key];
            }
            return value;
        }) as any;
        return this;
    }

    ignore<K extends keyof D>(destinationKey: K): this {
        this.config[destinationKey] = (() => undefined) as any;
        return this;
    }

    forMemberIf<K extends keyof D>(
        destinationKey: K,
        condition: (source: S) => boolean,
        trueMapper: (source: S) => D[K],
        falseMapper?: (source: S) => D[K]
    ): this {
        this.config[destinationKey] = ((source: S) => {
            return condition(source) 
                ? trueMapper(source) 
                : (falseMapper ? falseMapper(source) : undefined);
        }) as any;
        return this;
    }

    forNestedObject<K extends keyof D>(
        destinationKey: K,
        sourceProperty: (source: S) => any,
        nestedDestClass: ClassType<any>
    ): this {
        this.config[destinationKey] = ((source: S) => {
            const value = sourceProperty(source);
            if (!value) return undefined;
            return this.mapper.map(value, nestedDestClass);
        }) as any;
        return this;
    }

    forNestedArray<K extends keyof D>(
        destinationKey: K,
        sourceProperty: (source: S) => any[],
        itemDestClass: ClassType<any>
    ): this {
        this.config[destinationKey] = ((source: S) => {
            const value = sourceProperty(source);
            if (!value || !Array.isArray(value)) return [];
            return this.mapper.mapArray(value, itemDestClass);
        }) as any;
        return this;
    }

    transform<K extends keyof D>(
        destinationKey: K,
        sourceProperty: (source: S) => any,
        transformer: (value: any) => D[K]
    ): this {
        this.config[destinationKey] = ((source: S) => {
            const value = sourceProperty(source);
            return transformer(value);
        }) as any;
        return this;
    }

    withDefault<K extends keyof D>(
        destinationKey: K,
        sourceProperty: (source: S) => any,
        defaultValue: D[K]
    ): this {
        this.config[destinationKey] = ((source: S) => {
            const value = sourceProperty(source);
            return value ?? defaultValue;
        }) as any;
        return this;
    }

    concat<K extends keyof D>(
        destinationKey: K,
        ...sourceProperties: Array<(source: S) => string>
    ): this {
        this.config[destinationKey] = ((source: S) => {
            return sourceProperties.map(fn => fn(source) || '').join(' ');
        }) as any;
        return this;
    }

    withOptions(options: MappingEntryOptions): this {
        this.options = { ...this.options, ...options };
        return this;
    }

    skipNulls(skip: boolean = true): this {
        this.options.skipNulls = skip;
        return this;
    }

    skipUndefined(skip: boolean = true): this {
        this.options.skipUndefined = skip;
        return this;
    }

    deepClone(enable: boolean = true): this {
        this.options.deepClone = enable;
        return this;
    }

    strict(enable: boolean = true): this {
        this.options.strict = enable;
        return this;
    }

    beforeMap(hook: (source: S) => S | Promise<S>): this {
        this.options.beforeMap = hook as any;
        return this;
    }

    afterMap(hook: (destination: D, source: S) => D | Promise<D>): this {
        this.options.afterMap = hook as any;
        return this;
    }

    register(): Mapper {
        this.mapper.createMap(this.source, this.destination, this.config, this.options);
        return this.mapper;
    }

    reverseMap(): Mapper {
        this.register();
        this.mapper.createReverseMap(this.source, this.destination);
        return this.mapper;
    }
}

export abstract class MappingProfile {
    constructor(protected mapper: Mapper) {
        this.configure();
    }

    protected abstract configure(): void;

    protected createMap<S extends object, D extends object>(
        source: ClassType<S>,
        destination: ClassType<D>
    ): MappingBuilder<S, D> {
        return new MappingBuilder(this.mapper, source, destination);
    }

    protected registerMap<S extends object, D extends object>(
        source: ClassType<S>,
        destination: ClassType<D>,
        config?: MappingConfig<S, D>,
        options?: MappingEntryOptions
    ): void {
        this.mapper.createMap(source, destination, config, options);
    }
}