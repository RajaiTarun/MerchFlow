const express = require('express');
const { Pool } = require('pg');
const { connectRabbitMQ } = require('./messaging/rabbitmq');
const Redis = require('ioredis'); // this is redis driver node -> ioredis -> Redis
// redis short notes are available in the gpt chat attached in the notes.md file
require('dotenv').config({ path: '../../.env' });
const jwt = require('jsonwebtoken');
const orderRoutes = require('./routes/orders');

const app = express();
const PORT = process.env.ORDER_SERVICE_PORT || 3003;

const internalAuthMiddleware = (req, res, next) => {
    if (req.headers['x-internal-service-key'] && req.headers['x-internal-service-key'] === process.env.INTERNAL_SERVICE_KEY) {
        return next();
    }

    res.status(403).json({
        error: 'forbidden'
    })
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    max: 10
})

// creating redis connection, unlike postgres and mongo we dont explicitly need to write connect
const redis = new Redis(process.env.VALKEY_URL);

// redis client maintanis state in redis.status, has states like : connecting, ready, close, reconnecting

app.use(express.json());
app.use(internalAuthMiddleware);
app.use('/', orderRoutes(pool, redis));

app.get('/health', async (req, res) => {
    let dbConnected = false;
    try {
        const client = await pool.connect();
        client.release();
        dbConnected = true;
    } catch (err) {
        dbConnected = false;
        console.log("error connecting to db in order-service", err);
    }

    const redisConnected = redis.status === "ready";

    const healthy = dbConnected && redisConnected;
    res.status(healthy ? 200 : 500).json({
        service: 'order-service',
        status: healthy ? 'OK' : 'ERROR',
        db: dbConnected ? 'connected' : 'disconnected',
        redis: redisConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
})

connectRabbitMQ()
    .catch(err => {
        console.error(
            '[RABBITMQ] Startup connection failed:',
            err.message
        );
    });

app.listen(PORT, () => {
    console.log(`[ORDER SERVICE] listening on port ${PORT}`);
})
