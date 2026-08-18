// imports
const express = require('express');
const { Pool } = require('pg'); // pg is postgresql driver for node basically node js -> pg -> postgres
// and basically the dependency pg will have a lot more other things than Pool also but we only need Pool so we do destructing and import only Pool
const authRoutes = require('./routes/auth');
require('dotenv').config({ path: '../../.env' });

const app = express();
const PORT = process.env.USER_SERVICE_PORT || 3001;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    // as of now we are not strict about the certificate so rejectUnauthorize is set to false
    max: 10 // our connection pool limit
});

const internalAuthMiddleware = (req, res, next) => {
    if (req.headers['x-internal-service-key'] && req.headers['x-internal-service-key'] === process.env.INTERNAL_SERVICE_KEY) {
        return next();
    }

    res.status(403).json({
        error: 'forbidden'
    })
}

app.use(express.json());
app.use(internalAuthMiddleware);
app.use('/', authRoutes(pool));

app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        client.release();

        res.status(200).json({
            service: 'user-service',
            status: 'OK',
            db: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        // 500 means internal server error
        res.status(500).json({
            service: 'user-service',
            status: 'ERROR',
            db: 'disconnected',
            error: error.message
        });
    }
})

app.listen(PORT, () => {
    console.log(`[USER SERVICE] listening on port ${PORT}`);
})