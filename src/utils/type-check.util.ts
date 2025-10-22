export function isObject(value: any): value is object {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isArray(value: any): value is any[] {
    return Array.isArray(value);
}

export function isEnumValue<T extends object>(enumObj: T, value: any): boolean {
    return Object.values(enumObj).includes(value);
}
