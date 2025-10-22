import 'reflect-metadata';
import type { ClassType } from '../core/types';

/**
 * Metadata keys
 */
export const USE_MAPPER = Symbol('USE_MAPPER');
export const MAPPER_SOURCE = Symbol('MAPPER_SOURCE');
export const MAPPER_DESTINATION = Symbol('MAPPER_DESTINATION');

/**
 * @UseMapper decorator
 * Marks a class to use a specific mapper for transformation
 * @param mapperClass The Mapper class to use
 */
export function UseMapper(mapperClass: ClassType<any>): ClassDecorator {
    return target => {
        Reflect.defineMetadata(USE_MAPPER, mapperClass, target);
    };
}

/**
 * @MapFrom decorator
 * Maps a property from a source property or type
 * @param sourcePropertyOrType string | class constructor
 */
export function MapFrom(sourcePropertyOrType: string | ClassType<any>): PropertyDecorator {
    return (target, propertyKey) => {
        const existing = Reflect.getMetadata(MAPPER_SOURCE, target.constructor) || {};
        existing[propertyKey] = sourcePropertyOrType;
        Reflect.defineMetadata(MAPPER_SOURCE, existing, target.constructor);
    };
}

/**
 * @MapTo decorator
 * Maps a property to a destination property or type
 * @param destinationPropertyOrType string | class constructor
 */
export function MapTo(destinationPropertyOrType: string | ClassType<any>): PropertyDecorator {
    return (target, propertyKey) => {
        const existing = Reflect.getMetadata(MAPPER_DESTINATION, target.constructor) || {};
        existing[propertyKey] = destinationPropertyOrType;
        Reflect.defineMetadata(MAPPER_DESTINATION, existing, target.constructor);
    };
}

/**
 * @AutoMap decorator (for simple automatic mapping)
 * Optionally accepts a class type for nested mapping
 */
export function AutoMap(destination?: ClassType<any>): PropertyDecorator & ClassDecorator {
    return (target: object, propertyKey?: string | symbol) => {
        const METADATA_KEY = Symbol.for('AUTO_MAP_METADATA');
        if (propertyKey) {
            // Property decorator
            const existingProps: Record<string | symbol, ClassType<any> | undefined> =
                Reflect.getMetadata(METADATA_KEY, target.constructor) || {};
            existingProps[propertyKey] = destination;
            Reflect.defineMetadata(METADATA_KEY, existingProps, target.constructor);
        } else {
            // Class decorator
            Reflect.defineMetadata(METADATA_KEY, { __class__: destination || target }, target);
        }
    };
}

/**
 * Helpers to get metadata
 */
export function getMapperMetadata(target: Function) {
    return {
        useMapper: Reflect.getMetadata(USE_MAPPER, target),
        sources: Reflect.getMetadata(MAPPER_SOURCE, target) || {},
        destinations: Reflect.getMetadata(MAPPER_DESTINATION, target) || {}
    };
}

export function getAutoMapMetadata(target: Function) {
    const METADATA_KEY = Symbol.for('AUTO_MAP_METADATA');
    return Reflect.getMetadata(METADATA_KEY, target) || {};
}
