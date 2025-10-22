import 'reflect-metadata';

export const AUTO_MAP_METADATA_KEY = Symbol('AUTO_MAP_METADATA');
export const MAP_PROPERTY_METADATA_KEY = Symbol('MAP_PROPERTY_METADATA');
export const MAP_NESTED_METADATA_KEY = Symbol('MAP_NESTED_METADATA');
export const TRANSFORM_METADATA_KEY = Symbol('TRANSFORM_METADATA');

export function AutoMap(options?: { name?: string; ignore?: boolean }) {
    return (target: any, propertyKey: string) => {
        const metadata = {
            propertyKey,
            name: options?.name || propertyKey,
            ignore: options?.ignore || false
        };
        Reflect.defineMetadata(AUTO_MAP_METADATA_KEY, metadata, target, propertyKey);
    };
}

export function MapProperty(sourcePath: string) {
    return (target: any, propertyKey: string) => {
        Reflect.defineMetadata(MAP_PROPERTY_METADATA_KEY, sourcePath, target, propertyKey);
    };
}

export function MapNested(type: () => any) {
    return (target: any, propertyKey: string) => {
        Reflect.defineMetadata(MAP_NESTED_METADATA_KEY, type, target, propertyKey);
    };
}

export function Transform(transformer: (value: any, obj: any) => any) {
    return (target: any, propertyKey: string) => {
        Reflect.defineMetadata(TRANSFORM_METADATA_KEY, transformer, target, propertyKey);
    };
}

export function Ignore() {
    return AutoMap({ ignore: true });
}

export function Default(defaultValue: any) {
    return Transform((value: any) => value ?? defaultValue);
}

export function DateFormat(format: 'ISO' | 'UTC' | 'locale' = 'ISO') {
    return Transform((value: any) => {
        if (!value) return undefined;
        const date = value instanceof Date ? value : new Date(value);

        switch (format) {
            case 'ISO':
                return date.toISOString();
            case 'UTC':
                return date.toUTCString();
            case 'locale':
                return date.toLocaleString();
            default:
                return date.toString();
        }
    });
}

export function Validate(validator: (value: any) => boolean, errorMessage?: string) {
    return (target: any, propertyKey: string) => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(target, propertyKey);

        Object.defineProperty(target, propertyKey, {
            get() {
                return originalDescriptor?.get ? originalDescriptor.get.call(this) : this[`_${propertyKey}`];
            },
            set(value: any) {
                if (!validator(value)) {
                    throw new Error(errorMessage || `Validation failed for ${propertyKey}`);
                }
                if (originalDescriptor?.set) {
                    originalDescriptor.set.call(this, value);
                } else {
                    this[`_${propertyKey}`] = value;
                }
            },
            enumerable: true,
            configurable: true
        });
    };
}