const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const runMigration = async () => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Nullable - existing orders (placed before this migration) won't have
        // this yet; db/backfillItemName.js fills those in separately.
        // Denormalized here for the same reason student_email was in
        // migrate7.js: the checkout handler already has the item's name in
        // hand at insert time (it's already used to build the RabbitMQ event),
        // so this avoids a cross-service lookup on every future read.
        await client.query(`
            ALTER TABLE orders
                ADD COLUMN IF NOT EXISTS item_name TEXT;
        `);
        console.log('✅ Column item_name added');

        await client.query('COMMIT');
        console.log('✅ Migration 8 complete: item_name column added to orders');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration 8 failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
};

runMigration();
