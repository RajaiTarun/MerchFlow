const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
})

const createTables = async () => {
    const query = `
    CREATE TABLE IF NOT EXISTS users(
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
    )
    `;

    try {
        await pool.query(query);
        console.log('[USER SERVICE] Users table setup done');
    } catch (err) {
        console.error('[USER SERVICE] Users table not created', err);
    } finally {
        await pool.end(); // closing the pool after we are done
    }
}

createTables(); // running the function to create users table