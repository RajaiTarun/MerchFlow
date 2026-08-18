const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const createTables = async () => {
    const query = `
    CREATE TABLE IF NOT EXISTS orders(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
    user_id UUID NOT NULL,
    catalog_item_id VARCHAR(255) NOT NULL, --MongoDB ObjectId stored as string
    selected_size VARCHAR(10) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'PLACED' CHECK(status IN ('PLACED', 'CONFIRMED', 'CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT NOW()
    );
    `;

    try {
        await pool.query(query);
        console.log('✅ Orders table created successfully');
    } catch (err) {
        console.error('❌ Failed to create orders table:', err.message);
        console.log(err)
    } finally {
        await pool.end();
    }
}

createTables();