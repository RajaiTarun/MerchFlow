const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const createTables = async () => {
    const query = `
    CREATE TABLE IF NOT EXISTS notifications(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    order_id UUID,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
    );
    `;

    try {
        await pool.query(query);
        console.log('✅ Notifications table created successfully');
    } catch (err) {
        console.error('❌ Failed to create notifications table:', err.message);
        console.log(err)
    } finally {
        await pool.end();
    }
}

createTables();
