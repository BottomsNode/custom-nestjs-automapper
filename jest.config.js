/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',

    // Define roots for test discovery
    roots: ['<rootDir>/src'],

    // Match common test patterns
    testMatch: [
        '**/__tests__/**/*.spec.ts',
        '**/?(*.)+(spec|test).ts',
    ],

    // TS transformation pipeline
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: 'tsconfig.json',
            },
        ],
    },

        // Coverage configuration
        collectCoverageFrom: [
            'src/**/*.ts',
            '!src/**/*.d.ts',
            '!src/**/__tests__/**',
        ],
        coverageDirectory: 'coverage',
        coverageReporters: ['text', 'lcov', 'html'],

        // Module aliases
        moduleNameMapper: {
            '^@/(.*)$': '<rootDir>/src/$1',
        },

        // Ignored paths for watch mode
        watchPathIgnorePatterns: ['node_modules', 'dist', 'coverage'],

        // More readable output
        verbose: true,
    };
