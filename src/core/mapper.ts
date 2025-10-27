import type {
    ClassType,
    MappingConfig,
    MappingRegistryEntry,
    MappingEntryOptions,
    MappingResult,
    ConditionalMapping,
    TransformOptions,
    ValidationRule,
    MapperConstructorOptions,
    CacheConfig,
    MappingContext
} from './types';

import { deepClone } from '../utils/deep-clone.util';
import { convertNamingConvention } from '../utils/naming-convention.util';
import {
    AUTO_MAP_METADATA_KEY,
    MAP_NESTED_METADATA_KEY,
    MAP_PROPERTY_METADATA_KEY,
    TRANSFORM_METADATA_KEY
} from '../decorators';

export class Mapper {
    private registry: MappingRegistryEntry<any, any>[] = [];
    private globalOptions: MappingEntryOptions = {};
    private validationRules: Map<string, ValidationRule[]> = new Map();
    private reverseRegistry: Map<string, MappingRegistryEntry<any, any>> = new Map();

    // Compiled mappings for performance: registryKey -> compiled sync mapper function
    private compiledMapFns: Map<string, (src: any, _ctx?: any) => any> = new Map();

    // Compiled async mapping functions
    private compiledAsyncMapFns: Map<string, (src: any, _ctx?: any) => Promise<any>> = new Map();

    // Instance-level cache: WeakMap<sourceObject, Map<destinationConstructor, mappedResult>>
    private instanceCache: WeakMap<object, Map<new (...args: any[]) => any, any>> = new WeakMap();

    // Configurable caching plumbing
    private cacheConfig: CacheConfig;

    constructor(
        options?: MapperConstructorOptions | (MappingEntryOptions & { cache?: CacheConfig })
    ) {
        if (!options) {
            this.globalOptions = {};
            this.cacheConfig = { enabled: false, strategy: 'memory' };
        } else {
            // Support both shapes: MapperConstructorOptions or MappingEntryOptions with cache
            const anyOpt = options as any;
            this.globalOptions = anyOpt.globalOptions ?? (anyOpt as MappingEntryOptions) ?? {};
            this.cacheConfig = anyOpt.cache ??
                (anyOpt as any).cache ?? { enabled: false, strategy: 'memory' };
        }
    }

    /** Dynamically enable or disable the global cache. */
    public setCacheEnabled(enabled: boolean): void {
        if (!this.cacheConfig) this.cacheConfig = {};
        this.cacheConfig.enabled = enabled;
    }

    /** Returns the current global cache state. */
    public isGlobalCacheEnabled(): boolean {
        return !!this.cacheConfig?.enabled;
    }

    /**
     * Determines if cache is active for a given mapping entry.
     * Gives priority to per-map config over global.
     */
    private isCacheEnabled(entry?: MappingRegistryEntry<any, any>): boolean {
        // 1️⃣ Per-map cache override takes precedence
        if (entry?.options?.cache?.enabled !== undefined) {
            return entry.options.cache.enabled;
        }
        // 2️⃣ Otherwise, fall back to global config
        return !!this.cacheConfig?.enabled;
    }

    /**
     * Helper method to create property mappings with source path metadata.
     * Enables automatic reverse mapping generation.
     */
    mapFrom<S, K extends keyof S>(sourcePath: K): (src: S) => S[K] {
        const fn = ((src: S) => src[sourcePath]) as (src: S) => S[K] & { __sourcePath?: keyof S };
        (fn as any).__sourcePath = sourcePath;
        return fn;
    }

    createMap<S extends object, D extends object>(
        source: ClassType<S>,
        destination: ClassType<D>,
        config?: MappingConfig<S, D>,
        options?: MappingEntryOptions<S, D>
    ): this {
        const entry: MappingRegistryEntry<S, D> = {
            source,
            destination,
            config,
            options: this.mergeOptions(this.globalOptions, options)
        };

        this.registry.push(entry);
        const key = this.getRegistryKey(source, destination);
        this.reverseRegistry.set(key, entry);

        // Compile function eagerly for better runtime perf
        this.compileMapFunction(entry);

        return this;
    }

    createReverseMap<S extends object, D extends object>(
        source: ClassType<S>,
        destination: ClassType<D>
    ): this {
        const forwardEntry = this.findEntry(source, destination);
        if (!forwardEntry) {
            throw new Error(`No forward mapping found for ${source.name} -> ${destination.name}`);
        }

        const reverseConfig: any = {};
        if (forwardEntry.config) {
            for (const [destKey, mapperFn] of Object.entries(forwardEntry.config)) {
                const sourcePath = (mapperFn as any).__sourcePath;
                if (sourcePath) {
                    reverseConfig[sourcePath] = (src: D) => (src as any)[destKey];
                } else {
                    reverseConfig[destKey] = (src: D) => (src as any)[destKey];
                }
            }
        }

        const reverseOptions = (forwardEntry.options ?? {}) as unknown as MappingEntryOptions<D, S>;
        return this.createMap(
            destination,
            source,
            reverseConfig as MappingConfig<D, S>,
            reverseOptions
        );
    }

    /** Safely merges two MappingEntryOptions while preserving typing. */
    private mergeOptions<S extends object, D extends object>(
        base?: MappingEntryOptions<S, D>,
        override?: MappingEntryOptions<S, D>
    ): MappingEntryOptions<S, D> {
        const merged: MappingEntryOptions<S, D> = { ...(base ?? {}), ...(override ?? {}) };

        if (base?.ignore || override?.ignore) {
            merged.ignore = Array.from(
                new Set([...(base?.ignore ?? []), ...(override?.ignore ?? [])])
            );
        }

        if (base?.include || override?.include) {
            merged.include = Array.from(
                new Set([...(base?.include ?? []), ...(override?.include ?? [])])
            );
        }

        if (base?.cache || override?.cache) {
            merged.cache = { ...(base?.cache ?? {}), ...(override?.cache ?? {}) };
        }

        return merged;
    }

    // ---------- SYNC MAP ----------
    map<S extends object, D extends object>(
        sourceObj: S,
        destinationClass: ClassType<D>,
        _options?: TransformOptions
    ): D {
        const entry = this.findEntry(sourceObj.constructor as ClassType<S>, destinationClass);
        if (!entry) {
            throw this.createMappingError(
                sourceObj.constructor.name,
                destinationClass.name,
                'Mapping not found'
            );
        }

        const key = this.getRegistryKey(entry.source, entry.destination);

        if (this.isCacheEnabled(entry)) {
            const mapForSource = this.instanceCache.get(sourceObj as any);
            if (mapForSource) {
                const cached = mapForSource.get(destinationClass);
                if (cached) return cached as D;
            }
        }

        try {
            const hooks = entry.options ?? {};
            let preProcessed = sourceObj;

            if (typeof hooks.beforeMap === 'function') {
                preProcessed = (hooks.beforeMap as (src: S) => S)(
                    hooks.deepCloneBeforeMap ? deepClone(sourceObj) : sourceObj
                );
            }

            let compiled = this.compiledMapFns.get(key);
            if (!compiled) compiled = this.compileMapFunction(entry);

            let result = compiled!(preProcessed);

            if (typeof hooks.afterMap === 'function') {
                result = (hooks.afterMap as (dest: D) => D)(result);
            }

            if (this.isCacheEnabled(entry)) {
                let mapForSource = this.instanceCache.get(sourceObj as any);
                if (!mapForSource) {
                    mapForSource = new Map<new (...args: any[]) => any, any>();
                    this.instanceCache.set(sourceObj as any, mapForSource);
                }
                mapForSource.set(destinationClass, result);
            }

            return result as D;
        } catch (error) {
            throw this.createMappingError(
                sourceObj.constructor.name,
                destinationClass.name,
                'Mapping failed',
                error as Error
            );
        }
    }

    // ---------- ASYNC MAP ----------
    async mapAsync<S extends object, D extends object>(
        sourceObj: S,
        destinationClass: ClassType<D>,
        _options?: TransformOptions
    ): Promise<D> {
        const entry = this.findEntry(sourceObj.constructor as ClassType<S>, destinationClass);
        if (!entry) {
            throw this.createMappingError(
                sourceObj.constructor.name,
                destinationClass.name,
                'Mapping not found'
            );
        }

        const key = this.getRegistryKey(entry.source, entry.destination);

        if (this.isCacheEnabled(entry)) {
            const mapForSource = this.instanceCache.get(sourceObj as any);
            if (mapForSource) {
                const cached = mapForSource.get(destinationClass);
                if (cached) return cached as D;
            }
        }

        const hooks = entry.options ?? {};
        let preProcessed = sourceObj;

        if (typeof hooks.beforeMap === 'function') {
            preProcessed = await Promise.resolve(
                (hooks.beforeMap as (src: S) => S | Promise<S>)(deepClone(sourceObj))
            );
        }

        let asyncFn = this.compiledAsyncMapFns.get(key);
        if (!asyncFn) asyncFn = this.compileAsyncMapFunction(entry);

        let result = await asyncFn(preProcessed);

        if (typeof hooks.afterMap === 'function') {
            result = await Promise.resolve((hooks.afterMap as (dest: D) => D | Promise<D>)(result));
        }

        if (this.isCacheEnabled(entry)) {
            let mapForSource = this.instanceCache.get(sourceObj as any);
            if (!mapForSource) {
                mapForSource = new Map<new (...args: any[]) => any, any>();
                this.instanceCache.set(sourceObj as any, mapForSource);
            }
            mapForSource.set(destinationClass, result);
        }

        return result as D;
    }

    // ---------- Utility Methods ----------
    mapWithMetadata<S extends object, D extends object>(
        sourceObj: S,
        destinationClass: ClassType<D>,
        options?: TransformOptions
    ): MappingResult<D> {
        const startTime = Date.now();
        const mappedProperties: string[] = [];
        const skippedProperties: string[] = [];
        const errors: Array<{ property: string; error: string }> = [];

        try {
            const data = this.map(sourceObj, destinationClass, options);
            for (const key in sourceObj) {
                if (key in data) mappedProperties.push(key);
                else skippedProperties.push(key);
            }

            return {
                data,
                metadata: {
                    mappedProperties,
                    skippedProperties,
                    errors,
                    executionTime: Date.now() - startTime
                }
            };
        } catch (error) {
            errors.push({ property: 'all', error: (error as Error).message });
            throw error;
        }
    }

    mapArray<S extends object, D extends object>(
        sourceArray: S[],
        destinationClass: ClassType<D>,
        options?: TransformOptions
    ): D[] {
        return sourceArray.map(item => this.map(item, destinationClass, options));
    }

    async mapArrayAsync<S extends object, D extends object>(
        sourceArray: S[],
        destinationClass: ClassType<D>,
        options?: TransformOptions
    ): Promise<D[]> {
        return Promise.all(sourceArray.map(item => this.mapAsync(item, destinationClass, options)));
    }

    mapConditional<S extends object, D extends object>(
        sourceObj: S,
        destinationClass: ClassType<D>,
        conditions: ConditionalMapping<S, D>[]
    ): D {
        const destObj = this.map(sourceObj, destinationClass);
        for (const { condition, map } of conditions) {
            if (condition(sourceObj)) {
                Object.assign(destObj, map(sourceObj));
            }
        }
        return destObj;
    }

    addValidation<T>(targetClass: ClassType<T>, property: string, rule: ValidationRule): this {
        const key = `${targetClass.name}.${property}`;
        const rules = this.validationRules.get(key) || [];
        rules.push(rule);
        this.validationRules.set(key, rules);
        return this;
    }

    async validate<T extends object>(obj: T): Promise<boolean> {
        const className = obj.constructor.name;

        for (const key in obj) {
            const ruleKey = `${className}.${key}`;
            const rules = this.validationRules.get(ruleKey);
            if (rules) {
                for (const rule of rules) {
                    const isValid = await Promise.resolve(rule.validate((obj as any)[key]));
                    if (!isValid) {
                        throw new Error(`Validation failed for ${key}: ${rule.message}`);
                    }
                }
            }
        }

        return true;
    }

    clear(): void {
        this.registry = [];
        this.reverseRegistry.clear();
        this.validationRules.clear();
        this.compiledMapFns.clear();
        this.compiledAsyncMapFns.clear();
        this.instanceCache = new WeakMap();
    }

    getMappings(): Array<{ source: string; destination: string }> {
        return this.registry.map(entry => ({
            source: entry.source.name,
            destination: entry.destination.name
        }));
    }

    // ---------- PRIVATE HELPERS ----------
    private findEntry<S extends object, D extends object>(
        source: ClassType<S>,
        destination: ClassType<D>
    ): MappingRegistryEntry<S, D> | undefined {
        const key = this.getRegistryKey(source, destination);
        return (
            this.reverseRegistry.get(key) ||
            this.registry.find(r => r.source === source && r.destination === destination)
        );
    }

    private getRegistryKey(source: ClassType<any>, destination: ClassType<any>): string {
        return `${source.name}->${destination.name}`;
    }

    private compileMapFunction<S extends object, D extends object>(
        entry: MappingRegistryEntry<S, D>
    ) {
        const key = this.getRegistryKey(entry.source, entry.destination);

        const compiledFn = (src: any, _ctx?: MappingContext) => {
            const dest = new (entry.destination as any)();

            // Copy primitives
            for (const k in src) {
                if (entry.options?.ignore?.includes?.(k)) continue;
                if (entry.options?.include && !entry.options.include.includes(k)) continue;
                if (entry.options?.skipNulls && src[k] === null) continue;
                if (entry.options?.skipUndefined && src[k] === undefined) continue;

                let targetKey = k;
                if ((entry.options as any)?.convertNaming) {
                    targetKey = convertNamingConvention(
                        k,
                        (entry.options as any).convertNaming.from,
                        (entry.options as any).convertNaming.to
                    ) as string;
                }

                if (targetKey in dest) {
                    dest[targetKey] = entry.options?.deepClone ? deepClone(src[k]) : src[k];
                }
            }

            // Apply configured mapping functions
            if (entry.config) {
                for (const destKey in entry.config) {
                    const mapperFn = (entry.config as any)[destKey];
                    try {
                        const value = mapperFn(src);
                        if (entry.options?.skipNulls && value === null) continue;
                        if (entry.options?.skipUndefined && value === undefined) continue;
                        dest[destKey] = value;
                    } catch (err) {
                        if (entry.options?.strict) throw err;
                    }
                }
            }

            // Decorator-driven mappings
            const autoMeta = (Reflect.getMetadata(AUTO_MAP_METADATA_KEY, entry.destination) ||
                {}) as Record<string, any>;

            for (const destKey of Object.keys(autoMeta)) {
                if ((entry.config && (entry.config as any)[destKey]) || dest[destKey] !== undefined)
                    continue;

                const nestedTypeFactory = Reflect.getMetadata(
                    MAP_NESTED_METADATA_KEY,
                    entry.destination.prototype,
                    destKey
                );

                const sourcePath = Reflect.getMetadata(
                    MAP_PROPERTY_METADATA_KEY,
                    entry.destination.prototype,
                    destKey
                );

                const transformer = Reflect.getMetadata(
                    TRANSFORM_METADATA_KEY,
                    entry.destination.prototype,
                    destKey
                );

                if (sourcePath) {
                    const parts = (sourcePath as string).split('.');
                    let val: any = src;
                    for (const p of parts) val = val?.[p];
                    dest[destKey] = transformer ? transformer(val, src) : val;
                } else if (nestedTypeFactory) {
                    const nestedType = nestedTypeFactory();
                    const nestedVal = src[destKey];

                    if (nestedVal === undefined || nestedVal === null) {
                        dest[destKey] = nestedVal;
                    } else if (Array.isArray(nestedVal)) {
                        dest[destKey] = nestedVal.map((it: any) => this.map(it, nestedType));
                    } else {
                        dest[destKey] = this.map(nestedVal, nestedType);
                    }
                } else {
                    if (destKey in src) {
                        const val = src[destKey];
                        dest[destKey] = transformer ? transformer(val, src) : val;
                    }
                }
            }

            return dest;
        };

        this.compiledMapFns.set(key, compiledFn);
        return compiledFn;
    }

    private compileAsyncMapFunction<S extends object, D extends object>(
        entry: MappingRegistryEntry<S, D>
    ) {
        const key = this.getRegistryKey(entry.source, entry.destination);

        const asyncFn = async (src: any, _ctx?: any) => {
            const dest = new (entry.destination as any)();

            // Copy primitives
            for (const k in src) {
                if (entry.options?.ignore?.includes?.(k)) continue;
                if (entry.options?.include && !entry.options.include.includes(k)) continue;
                if (entry.options?.skipNulls && src[k] === null) continue;
                if (entry.options?.skipUndefined && src[k] === undefined) continue;

                let targetKey = k;
                if ((entry.options as any)?.convertNaming) {
                    targetKey = convertNamingConvention(
                        k,
                        (entry.options as any).convertNaming.from,
                        (entry.options as any).convertNaming.to
                    ) as string;
                }

                if (targetKey in dest) {
                    dest[targetKey] = entry.options?.deepClone ? deepClone(src[k]) : src[k];
                }
            }

            // Config functions may be async
            if (entry.config) {
                for (const destKey in entry.config) {
                    const mapperFn = (entry.config as any)[destKey];
                    try {
                        const value = await Promise.resolve(mapperFn(src));
                        if (entry.options?.skipNulls && value === null) continue;
                        if (entry.options?.skipUndefined && value === undefined) continue;
                        dest[destKey] = value;
                    } catch (err) {
                        if (entry.options?.strict) throw err;
                    }
                }
            }

            // Decorator-driven mappings
            const autoMeta = (Reflect.getMetadata(AUTO_MAP_METADATA_KEY, entry.destination) ||
                {}) as Record<string, any>;

            for (const destKey of Object.keys(autoMeta)) {
                if ((entry.config && (entry.config as any)[destKey]) || dest[destKey] !== undefined)
                    continue;

                const nestedTypeFactory = Reflect.getMetadata(
                    MAP_NESTED_METADATA_KEY,
                    entry.destination.prototype,
                    destKey
                );

                const sourcePath = Reflect.getMetadata(
                    MAP_PROPERTY_METADATA_KEY,
                    entry.destination.prototype,
                    destKey
                );

                const transformer = Reflect.getMetadata(
                    TRANSFORM_METADATA_KEY,
                    entry.destination.prototype,
                    destKey
                );

                if (sourcePath) {
                    const parts = (sourcePath as string).split('.');
                    let val: any = src;
                    for (const p of parts) val = val?.[p];
                    dest[destKey] = transformer ? transformer(val, src) : val;
                } else if (nestedTypeFactory) {
                    const nestedType = nestedTypeFactory();
                    const nestedVal = src[destKey];

                    if (nestedVal === undefined || nestedVal === null) {
                        dest[destKey] = nestedVal;
                    } else if (Array.isArray(nestedVal)) {
                        dest[destKey] = await Promise.all(
                            nestedVal.map(async (it: any) => this.mapAsync(it, nestedType))
                        );
                    } else {
                        dest[destKey] = await this.mapAsync(nestedVal, nestedType);
                    }
                } else {
                    if (destKey in src) {
                        const val = src[destKey];
                        dest[destKey] = transformer ? transformer(val, src) : val;
                    }
                }
            }

            return dest;
        };

        this.compiledAsyncMapFns.set(key, asyncFn);
        return asyncFn;
    }

    // ---------- Error Builder ----------
    private createMappingError(
        sourceType: string,
        destinationType: string,
        message: string,
        originalError?: Error
    ): Error {
        const err = new Error(
            `Mapping Error [${sourceType} → ${destinationType}]: ${message}${
                originalError ? ` | Cause: ${originalError.message}` : ''
            }`
        );
        (err as any).originalError = originalError;
        return err;
    }
}
