/**
 * Global test setup file
 * This file is executed once before all tests run
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Increase timeout for integration tests
jest.setTimeout(10000);

// Global test utilities
global.console = {
    ...console,
    // Suppress console output during tests (uncomment if needed)
    // log: jest.fn(),
    // debug: jest.fn(),
    // info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

// Mock environment variables for tests
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.REDIS_PASSWORD = 'test-redis-password';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.VAULT_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!';

beforeAll(() => {
    // Global setup before all tests
    console.log('Starting test suite...');
});

afterAll(() => {
    // Global cleanup after all tests
    console.log('Test suite completed.');
});
