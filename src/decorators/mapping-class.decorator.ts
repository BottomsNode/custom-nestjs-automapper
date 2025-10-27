import 'reflect-metadata';

export const MAPPABLE_CLASS_METADATA_KEY = Symbol('MAPPABLE_CLASS_METADATA');

export interface MappableClassOptions {
    autoMapAll?: boolean;
    namingConvention?: {
        from: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
        to: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case';
    };
    skipNulls?: boolean;
    skipUndefined?: boolean;
}

export function Mappable(options?: MappableClassOptions) {
    return (target: any) => {
        Reflect.defineMetadata(MAPPABLE_CLASS_METADATA_KEY, options || {}, target);
    };
}

export function MapProfile(profiles: Array<new (...args: any[]) => any>) {
    return (target: any) => {
        const existingProfiles = Reflect.getMetadata('MAP_PROFILES', target) || [];
        Reflect.defineMetadata('MAP_PROFILES', [...existingProfiles, ...profiles], target);
    };
}
