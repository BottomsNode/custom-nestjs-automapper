import type { ValidationRule } from '../core/types';

export async function validateProperty(value: any, rules: ValidationRule[]): Promise<void> {
    for (const rule of rules) {
        const isValid = await Promise.resolve(rule.validate(value));
        if (!isValid) {
            throw new Error(rule.message);
        }
    }
}
