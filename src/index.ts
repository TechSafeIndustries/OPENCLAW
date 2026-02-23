/**
 * OpenClaw Enterprise Gateway
 * Main application entry point
 */

import { BigQuery } from '@google-cloud/bigquery';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';

// Load environment variables first — must happen before any other imports
dotenv.config();

import { generateSessionToken } from './gateway/session';
import { startControlPlane } from './gateway/ws-control-plane';

const NODE_ENV = process.env['NODE_ENV'] || 'development';
const BIGQUERY_PROJECT_ID = process.env['BIGQUERY_PROJECT_ID'];
const GOOGLE_APPLICATION_CREDENTIALS = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
const REDIS_HOST = process.env['REDIS_HOST'] || 'localhost';
const REDIS_PORT = parseInt(process.env['REDIS_PORT'] || '6379', 10);
const REDIS_PASSWORD = process.env['REDIS_PASSWORD'];

console.log('🦅 OpenClaw Enterprise Gateway - Starting...');
console.log('Environment:', NODE_ENV);
console.log('Version: 0.1.0');
console.log('BigQuery Project:', BIGQUERY_PROJECT_ID);
console.log('Google Credentials Path:', GOOGLE_APPLICATION_CREDENTIALS);
console.log('Redis Host:', REDIS_HOST);

// Initialize BigQuery client
const bigquery = new BigQuery({
    projectId: BIGQUERY_PROJECT_ID,
    keyFilename: GOOGLE_APPLICATION_CREDENTIALS
});

// Initialize Redis client
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

// Handle Redis connection events
redis.on('connect', () => {
    console.log('✅ Connected to Redis');
});

redis.on('error', (err: Error) => {
    console.error('❌ Redis connection error:', err.message);
});

redis.on('ready', () => {
    console.log('✅ Redis client ready');
});

// Test BigQuery connection
async function testBigQueryConnection(): Promise<void> {
    try {
        const [datasets] = await bigquery.getDatasets();
        console.log('✅ BigQuery connection successful');
        console.log(`Found ${datasets.length} dataset(s) in project ${BIGQUERY_PROJECT_ID}`);
    } catch (error) {
        console.error('❌ BigQuery connection failed:', error instanceof Error ? error.message : error);
    }
}

// Heartbeat function to keep the process alive
let heartbeatCount = 0;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

function heartbeat(): void {
    heartbeatCount++;
    console.log(`💓 Heartbeat #${heartbeatCount} - ${new Date().toISOString()}`);

    // Optionally publish heartbeat to Redis for monitoring
    redis.publish('openclaw:heartbeat', JSON.stringify({
        timestamp: Date.now(),
        count: heartbeatCount,
        status: 'alive'
    })).catch((err: Error) => {
        console.error('Failed to publish heartbeat:', err.message);
    });
}

// Subscribe to Redis channels for task coordination
async function setupRedisSubscriber(): Promise<void> {
    const subscriber = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD
    });

    subscriber.on('message', (channel: string, message: string) => {
        console.log(`📨 Received message on channel "${channel}":`, message);

        try {
            const data = JSON.parse(message);
            handleIncomingMessage(channel, data);
        } catch (err) {
            console.warn('Failed to parse message:', message);
        }
    });

    // Subscribe to task channels
    await subscriber.subscribe('openclaw:tasks', 'openclaw:commands');
    console.log('✅ Subscribed to Redis channels: openclaw:tasks, openclaw:commands');
}

// Handle incoming messages from Redis
function handleIncomingMessage(channel: string, data: any): void {
    switch (channel) {
        case 'openclaw:tasks':
            console.log('📋 New task received:', data);
            // TODO: Process task
            break;
        case 'openclaw:commands':
            console.log('⚡ Command received:', data);
            // TODO: Execute command
            break;
        default:
            console.log('Unknown channel:', channel);
    }
}

// Graceful shutdown handler
function setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
        console.log(`\n🛑 ${signal} received, shutting down gracefully...`);

        // Stop heartbeat
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }

        // Close Redis connections
        try {
            await redis.quit();
            console.log('✅ Redis connection closed');
        } catch (err) {
            console.error('Error closing Redis:', err);
        }

        console.log('👋 OpenClaw Gateway stopped');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// Main initialization function
async function main(): Promise<void> {
    try {
        console.log('\n🚀 Initializing OpenClaw Gateway...\n');

        // Generate and log session token FIRST so it's visible at the top of logs
        generateSessionToken();

        // Test BigQuery connection
        await testBigQueryConnection();

        // Setup Redis subscriber
        await setupRedisSubscriber();

        // Setup graceful shutdown
        setupGracefulShutdown();

        // Start WebSocket control plane
        startControlPlane();

        // Start heartbeat to keep container alive
        console.log(`\n💓 Starting heartbeat (interval: ${HEARTBEAT_INTERVAL}ms)\n`);
        heartbeat(); // Send first heartbeat immediately

        console.log('✅ OpenClaw Gateway is running and ready to process tasks!\n');

    } catch (error) {
        console.error('❌ Failed to initialize OpenClaw Gateway:', error);
        process.exit(1);
    }
}

// Start heartbeat interval (declared globally so we can clear it on shutdown)
let heartbeatInterval: NodeJS.Timeout;

// Start the application
main().then(() => {
    heartbeatInterval = setInterval(heartbeat, HEARTBEAT_INTERVAL);
}).catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});

export { };
