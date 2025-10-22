import { getPropertyByPath } from './property-path.util';
import { deepClone } from './deep-clone.util';

/**
 * Resolve a nested value from an object by path, optionally deep cloning it
 */
export function resolveValue(obj: any, path: string, deepCloneValue: boolean = false) {
    const value = getPropertyByPath(obj, path);
    return deepCloneValue ? deepClone(value) : value;
}

/**
 * Maps a property from a source object to a destination property
 */
export function mapFrom<TSource>(sourcePath: keyof TSource | string): (source: TSource) => any {
    return (source: TSource) => resolveValue(source, sourcePath as string);
}

/**
 * Maps an array of objects from source to destination
 */
export function mapFromArray<TSource>(
    sourcePath: keyof TSource | string
): (source: TSource) => any[] {
    return (source: TSource) => {
        const arr = resolveValue(source, sourcePath as string);
        return Array.isArray(arr) ? [...arr] : [];
    };
}

/**
 * Conditional mapping: only map if condition is true
 */
export function condition<TSource>(predicate: (source: TSource) => boolean) {
    return (source: TSource, value: any) => (predicate(source) ? value : undefined);
}

/**
 * Ignore a property in mapping
 */
export function ignore() {
    return () => undefined;
}

/**
 * Transform a value during mapping
 */
export function transform<TSource, TValue>(transformFn: (value: TValue, source: TSource) => any) {
    return (source: TSource, value: TValue) => transformFn(value, source);
}

/**
 * Format a date value to string using Intl.DateTimeFormat
 */
export function formatDate(format?: Intl.DateTimeFormatOptions) {
    return (value: Date | string | number) => {
        if (!value) return value;
        const date = value instanceof Date ? value : new Date(value);
        return new Intl.DateTimeFormat(undefined, format).format(date);
    };
}

/**
 * Replace null or undefined with a default value
 */
export function nullToDefault<T>(defaultValue: T) {
    return (value: T | null | undefined) => (value == null ? defaultValue : value);
}

/**
 * Concatenate multiple values into a single string
 */
export function concat(...args: any[]) {
    return () => args.join('');
}

/**
 * Compute a value dynamically using a callback
 */
export function compute<TSource>(computeFn: (source: TSource) => any) {
    return (source: TSource) => computeFn(source);
}
