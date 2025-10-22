import type {
    ClassType,
    MappingConfig,
    MappingRegistryEntry,
    MappingEntryOptions,
    MappingResult,
    ConditionalMapping,
    TransformOptions,
    ValidationRule} from './types';
import { deepClone } from '../utils/deep-clone.util';
import { convertNamingConvention } from '../utils/naming-convention.util';

export class Mapper {
    private registry: MappingRegistryEntry<any, any>[] = [];
    private globalOptions: MappingEntryOptions = {};
    private validationRules: Map<string, ValidationRule[]> = new Map();
    private reverseRegistry: Map<string, MappingRegistryEntry<any, any>> = new Map();

    constructor(options?: MappingEntryOptions) {
        if (options) this.globalOptions = options;
    }

    createMap<S extends object, D extends object>(
        source: ClassType<S>,
        destination: ClassType<D>,
        config?: MappingConfig<S, D>,
        options?: MappingEntryOptions
    ): this {
        const entry: MappingRegistryEntry<S, D> = {
            source,
            destination,
            config,
            options: { ...this.globalOptions, ...options }
        };

        this.registry.push(entry);

        const key = this.getRegistryKey(source, destination);
        this.reverseRegistry.set(key, entry);

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

        const reverseConfig: Partial<MappingConfig<D, S>> = {};
        if (forwardEntry.config) {
            for (const key in forwardEntry.config) {
                (reverseConfig as any)[key] = (dest: D) => (dest as any)[key];
            }
        }

        return this.createMap(
            destination,
            source,
            reverseConfig as MappingConfig<D, S>,
            forwardEntry.options
        );
    }

    map<S extends object, D extends object>(
        sourceObj: S,
        destinationClass: ClassType<D>,
        options?: TransformOptions
    ): D {
        const entry = this.findEntry(sourceObj.constructor as ClassType<S>, destinationClass);
        if (!entry) {
            throw this.createMappingError(
                sourceObj.constructor.name,
                destinationClass.name,
                'Mapping not found'
            );
        }

        try {
            const destObj = new destinationClass();
            const mergedOptions = { ...entry.options, ...options };

            let processedSource = sourceObj;
            if (entry.options?.beforeMap) {
                processedSource = entry.options.beforeMap(sourceObj) as S;
            }

            this.copyProperties(processedSource, destObj, mergedOptions);

            if (entry.config) {
                this.applyCustomMappings(processedSource, destObj, entry.config, mergedOptions);
            }

            let finalDestObj = destObj;
            if (entry.options?.afterMap) {
                finalDestObj = entry.options.afterMap(destObj, processedSource) as D;
            }

            return finalDestObj;
        } catch (error) {
            throw this.createMappingError(
                sourceObj.constructor.name,
                destinationClass.name,
                'Mapping failed',
                error as Error
            );
        }
    }

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
                if (key in data) {
                    mappedProperties.push(key);
                } else {
                    skippedProperties.push(key);
                }
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
            errors.push({
                property: 'all',
                error: (error as Error).message
            });

            throw error;
        }
    }

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

        const destObj = new destinationClass();

        let processedSource = sourceObj;
        if (entry.options?.beforeMap) {
            const result = entry.options.beforeMap(sourceObj);
            processedSource = result instanceof Promise ? await result : result;
        }

        this.copyProperties(processedSource, destObj, entry.options);

        if (entry.config) {
            await this.applyAsyncCustomMappings(
                processedSource,
                destObj,
                entry.config,
                entry.options
            );
        }

        let finalDestObj = destObj;
        if (entry.options?.afterMap) {
            const result = entry.options.afterMap(destObj, processedSource);
            finalDestObj = result instanceof Promise ? await result : result;
        }

        return finalDestObj;
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
                const result = map(sourceObj);
                Object.assign(destObj, result);
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
    }

    getMappings(): Array<{ source: string; destination: string }> {
        return this.registry.map(entry => ({
            source: entry.source.name,
            destination: entry.destination.name
        }));
    }

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

    private copyProperties<S extends object, D extends object>(
        source: S,
        dest: D,
        options?: MappingEntryOptions & TransformOptions
    ): void {
        for (const key in source) {
            if (options?.ignore?.includes(key)) continue;

            if (options?.include && !options.include.includes(key)) continue;

            if (options?.skipNulls && source[key] === null) continue;

            if (options?.skipUndefined && source[key] === undefined) continue;

            let targetKey = key;

            if (options?.convertNaming) {
                targetKey = convertNamingConvention(
                    key,
                    options.convertNaming.from,
                    options.convertNaming.to
                ) as Extract<keyof S, string>;
            }

            if (targetKey in dest) {
                const value = source[key];
                (dest as any)[targetKey] = options?.deepClone ? deepClone(value) : value;
            }
        }
    }

    private applyCustomMappings<S extends object, D extends object>(
        source: S,
        dest: D,
        config: MappingConfig<S, D>,
        options?: MappingEntryOptions
    ): void {
        for (const destKey in config) {
            const mapperFn = config[destKey];
            if (typeof mapperFn === 'function') {
                try {
                    const value = mapperFn(source);

                    if (options?.skipNulls && value === null) continue;
                    if (options?.skipUndefined && value === undefined) continue;

                    (dest as any)[destKey] = value;
                } catch (error) {
                    if (options?.strict) {
                        throw error;
                    }
                }
            }
        }
    }

    private async applyAsyncCustomMappings<S extends object, D extends object>(
        source: S,
        dest: D,
        config: MappingConfig<S, D>,
        options?: MappingEntryOptions
    ): Promise<void> {
        for (const destKey in config) {
            const mapperFn = config[destKey];
            if (typeof mapperFn === 'function') {
                try {
                    const value = await Promise.resolve(mapperFn(source));

                    if (options?.skipNulls && value === null) continue;
                    if (options?.skipUndefined && value === undefined) continue;

                    (dest as any)[destKey] = value;
                } catch (error) {
                    if (options?.strict) {
                        throw error;
                    }
                }
            }
        }
    }

    private createMappingError(
        source: string,
        destination: string,
        message: string,
        originalError?: Error
    ): Error {
        const error = new Error(
            `Mapping Error: ${source} -> ${destination}: ${message}${
                originalError ? ` (${originalError.message})` : ''
            }`
        );
        (error as any).source = source;
        (error as any).destination = destination;
        (error as any).originalError = originalError;
        return error;
    }
}
