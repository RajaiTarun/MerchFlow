const { Pool } = require('pg');

// Used only to validate a Super-Admin-supplied clubId against the clubs table
// (owned by user-service's migrations, same shared Neon Postgres instance).
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    max: 5
});

pool.on('error', (err) => {
    console.error('[CATALOG SERVICE] Postgres pool error:', err.message);
});

module.exports = pool;
