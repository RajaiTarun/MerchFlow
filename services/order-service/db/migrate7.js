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
        // this yet; db/backfillStudentEmail.js fills those in separately.
        // Denormalized here (rather than joining to user-service at read time)
        // for the same reason club_id was denormalized in migrate6.js: it's
        // already known at checkout time (from the caller's own JWT), and
        // avoids a cross-service lookup on every GET /orders/club read.
        await client.query(`
            ALTER TABLE orders
                ADD COLUMN IF NOT EXISTS student_email TEXT;
        `);
        console.log('✅ Column student_email added');

        await client.query('COMMIT');
        console.log('✅ Migration 7 complete: student_email column added to orders');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration 7 failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
};

runMigration();
