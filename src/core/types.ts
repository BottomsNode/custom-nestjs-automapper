export type ClassType<T = any> = new (...args: any[]) => T;

export type MapperFunction<S, D, K extends keyof D = keyof D> = (source: S, context?: MappingContext) => D[K] | any;

export type MappingConfig<S extends object, D extends object> = {
    [K in keyof D]?: (source: S, context?: MappingContext) => D[K] | any;
};

export interface MappingRegistryEntry<S extends object, D extends object> {
    source: ClassType<S>;
    destination: ClassType<D>;
    config?: MappingConfig<S, D>;
    options?: MappingEntryOptions;
}

export interface MappingEntryOptions {
    // Skip null values during mapping
    skipNulls?: boolean;
    // Skip undefined values during mapping
    skipUndefined?: boolean;
    // Deep clone nested objects
    deepClone?: boolean;
    // Enable strict mode (throw on missing mappings)
    strict?: boolean;
    // Custom naming convention converter
    namingConvention?: NamingConvention;
    // Before/After hooks
    beforeMap?: <S, _D>(source: S) => S | Promise<S>;
    afterMap?: <S, D>(destination: D, source: S) => D | Promise<D>;
}

export interface NamingConvention {
    splittingExpression: RegExp;
    separatingCharacter: string;
    transformPropertyName: (name: string) => string;
}

export interface MappingContext {
    source?: unknown;
    destination?: unknown;
    parent?: MappingContext | undefined;
    depth?: number | undefined;
    options?: Record<string, any> | undefined;
}

export interface ConditionalMapping<S, D> {
    condition: (source: S) => boolean;
    map: MapperFunction<S, D>;
}

export interface TransformOptions {
    // Ignore specific properties
    ignore?: string[];
    // Only include specific properties
    include?: string[];
    // Convert naming conventions
    convertNaming?: {
        from: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
        to: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
    };
}

// Enhanced mapping result with metadata
export interface MappingResult<D> {
    data: D;
    metadata: {
        mappedProperties: string[];
        skippedProperties: string[];
        errors: Array<{ property: string; error: string }>;
        executionTime: number;
    };
}

export type AsyncMapperFunction<S, _D> = (source: S, context?: MappingContext) => Promise<any>;

export interface ValidationRule<T = any> {
    validate: (value: T) => boolean | Promise<boolean>;
    message: string;
}

export interface MappingError {
    sourceType: string;
    destinationType: string;
    property?: string;
    message: string;
    originalError?: Error;
}