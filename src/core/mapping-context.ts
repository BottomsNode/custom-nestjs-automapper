import type { MappingContext } from './types';

/**
 * Factory function to create a new mapping context.
 */
export function createMappingContext(
    source?: unknown,
    destination?: unknown,
    parent?: MappingContext
): MappingContext {
    return {
        source,
        destination,
        parent,
        depth: parent ? (parent.depth ?? 0) + 1 : 0,
        options: {},
    };
}