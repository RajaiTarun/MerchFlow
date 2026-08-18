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

        // PostgreSQL doesn't support modifying a CHECK constraint in-place
        // Pattern: drop the old constraint, add the new one with expanded values
        // The auto-generated name for an inline CHECK is {table}_{column}_check
        await client.query(`
            ALTER TABLE orders
                DROP CONSTRAINT IF EXISTS orders_status_check;
        `);

        await client.query(`
            ALTER TABLE orders
                ADD CONSTRAINT orders_status_check
                CHECK (status IN ('PLACED', 'COMMITTED', 'CANCELLED', 'PAYMENT_FAILED'));
        `);

        await client.query('COMMIT');
        console.log('✅ Migration 3 complete: COMMITTED and PAYMENT_FAILED added to orders status');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration 3 failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
};

runMigration();
