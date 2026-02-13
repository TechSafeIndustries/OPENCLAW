/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/*.test.ts',
        '!src/**/*.spec.ts',
        '!src/index.ts',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    coverageThresholds: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80,
        },
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@cli/(.*)$': '<rootDir>/src/cli/$1',
        '^@gateway/(.*)$': '<rootDir>/src/gateway/$1',
        '^@connectors/(.*)$': '<rootDir>/src/connectors/$1',
        '^@intelligence/(.*)$': '<rootDir>/src/intelligence/$1',
        '^@security/(.*)$': '<rootDir>/src/security/$1',
        '^@storage/(.*)$': '<rootDir>/src/storage/$1',
        '^@web-ui/(.*)$': '<rootDir>/src/web-ui/$1',
        '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    },
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
    testTimeout: 10000,
    verbose: true,
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true,
};
