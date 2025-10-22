module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: [
        '<rootDir>/src',
        '<rootDir>/__tests__'   // include your test folders
    ],
    testMatch: [
        '**/__tests__/**/*.ts',        // matches all tests inside __tests__
        '**/?(*.)+(spec|test).ts'     // matches *.spec.ts or *.test.ts anywhere
    ],
    transform: {
        '^.+\\.ts$': 'ts-jest'
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/*.spec.ts',
        '!src/**/__tests__/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
    },
    // Optional: make watch mode work even if you are not in a git repo
    watchPathIgnorePatterns: ['node_modules', 'dist', 'coverage']
};
