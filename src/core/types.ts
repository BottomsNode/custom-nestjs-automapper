export type ClassType<T = any> = new (...args: any[]) => T;

/**
 * Defines a mapping function for a single destination property.
 */
export type MapperFunction<S, D, K extends keyof D = keyof D> = (
    source: S,
    context?: MappingContext
) => D[K] | any;

/**
 * Property-level mapping configuration.
 */
export type MappingConfig<S extends object, D extends object> = {
    [K in keyof D]?: MapperFunction<S, D, K>;
};

/**
 * Core registry entry for source-destination type mapping.
 */
export interface MappingRegistryEntry<S extends object, D extends object> {
    source: ClassType<S>;
    destination: ClassType<D>;
    config?: MappingConfig<S, D>;
    options?: MappingEntryOptions<S, D>;
}

/**
 * Mapping behavior configuration.
 */
export interface MappingEntryOptions<S = any, D = any> {
    /** Skip mapping if value is null */
    skipNulls?: boolean;
    /** Skip mapping if value is undefined */
    skipUndefined?: boolean;
    /** Deep clone nested objects */
    deepClone?: boolean;
    /** Enable strict mode (throw on missing mappings) */
    strict?: boolean;
    /** Custom naming convention handler */
    namingConvention?: NamingConvention;
    /** Lifecycle hooks */
    beforeMap?: (source: S) => S | Promise<S>;
    afterMap?: (destination: D, source: S) => D | Promise<D>;
    /** Per-map cache configuration override */
    cache?: Partial<CacheConfig>;
    /** Ignore specific properties during mapping */
    ignore?: Array<string | keyof D | symbol>;
    /** Include only specific properties during mapping */
    include?: Array<string | keyof D | symbol>;
    /** Deep clone nested objects before mapping */
    deepCloneBeforeMap?: boolean;
}

/**
 * Defines property naming convention logic.
 */
export interface NamingConvention {
    splittingExpression: RegExp;
    separatingCharacter: string;
    transformPropertyName: (name: string) => string;
}

/**
 * Context object passed during mapping execution.
 */
export interface MappingContext {
    source?: unknown;
    destination?: unknown;
    parent?: MappingContext;
    depth?: number;
    options?: Record<string, any>;
}

/**
 * Conditional mapping configuration.
 */
export interface ConditionalMapping<S, D> {
    condition: (source: S) => boolean;
    map: MapperFunction<S, D>;
}

/**
 * Transformation options for manual mapping calls.
 */
export interface TransformOptions {
    /** Ignore specific properties */
    ignore?: string[];
    /** Include only specific properties */
    include?: string[];
    /** Convert naming conventions */
    convertNaming?: {
        from: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
        to: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
    };
}

/**
 * Enhanced result of a mapping operation, with metadata.
 */
export interface MappingResult<D> {
    data: D;
    metadata: {
        mappedProperties: string[];
        skippedProperties: string[];
        errors: Array<{ property: string; error: string }>;
        executionTime: number;
    };
}

/**
 * Async version of MapperFunction.
 */
export type AsyncMapperFunction<S> = (source: S, context?: MappingContext) => Promise<any>;

/**
 * Validation rule structure.
 */
export interface ValidationRule<T = any> {
    validate: (value: T) => boolean | Promise<boolean>;
    message: string;
}

/**
 * Detailed mapping error object.
 */
export interface MappingError {
    sourceType: string;
    destinationType: string;
    property?: string;
    message: string;
    originalError?: Error;
}

/**
 * Cache configuration options for mappers.
 * Allows custom strategy implementations (e.g., Redis, LRU).
 */
export interface CacheConfig {
    enabled?: boolean;
    strategy?: 'memory' | 'lru' | 'redis';
    ttlMs?: number; // TTL in milliseconds
    [k: string]: any; // Adapter-specific configuration
}

/**
 * Mapper constructor options.
 */
export interface MapperConstructorOptions {
    globalOptions?: MappingEntryOptions;
    cache?: CacheConfig;
}
