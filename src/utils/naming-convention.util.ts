export function convertNamingConvention(
    propertyName: string,
    from: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case',
    to: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case'
): string {
    let words: string[] = [];

    switch (from) {
        case 'camelCase':
            words = propertyName.replace(/([A-Z])/g, ' $1').split(/[\s_]+/);
            break;
        case 'PascalCase':
            words = propertyName
                .replace(/([A-Z])/g, ' $1')
                .trim()
                .split(/[\s_]+/);
            break;
        case 'snake_case':
            words = propertyName.split('_');
            break;
        case 'kebab-case':
            words = propertyName.split('-');
            break;
    }

    words = words.map(w => w.toLowerCase());

    switch (to) {
        case 'camelCase':
            return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
        case 'PascalCase':
            return words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
        case 'snake_case':
            return words.join('_');
        case 'kebab-case':
            return words.join('-');
    }
}
