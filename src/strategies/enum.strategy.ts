export class EnumMappingStrategy {
    mapEnumValue<T extends object>(sourceValue: any, enumObj: T): T[keyof T] | undefined {
        if (Object.values(enumObj).includes(sourceValue)) {
            return sourceValue as T[keyof T];
        }
        return undefined;
    }
}
